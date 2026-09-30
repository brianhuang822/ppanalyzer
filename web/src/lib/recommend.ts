import { gainFromPlay, weightedTotal } from './pp'
import type { Bucket, MapInfo, Meta, PlayerProfile, PlayScore } from './types'

export type WindowMode = 'around' | 'above'
export type SortMode = 'gain' | 'popular' | 'specific' | 'pp'

export interface PeerWindow {
  /** Requested rank range. */
  lo: number
  hi: number
  buckets: number[]
  /** Set when the requested rank is outside the snapshot and was clamped. */
  clampedFrom?: number
}

/**
 * Which ranks count as "players near you". `around` is symmetric; `above` looks only at players
 * ranked better than you, i.e. what the people you are trying to pass have been playing.
 */
export function peerWindow(meta: Meta, rank: number, width: number, mode: WindowMode): PeerWindow {
  const size = meta.bucketSize
  const first = Math.max(1, meta.minRank || 1)
  const last = Math.max(first, meta.maxRank || meta.bucketCount * size)
  const anchor = Math.min(Math.max(Math.round(rank), first), last)
  const clampedFrom = anchor !== rank ? rank : undefined

  let lo: number
  let hi: number
  if (mode === 'above' && anchor - first >= width / 2) {
    lo = Math.max(first, anchor - 2 * width)
    hi = anchor - 1
  } else {
    lo = Math.max(first, anchor - width)
    hi = Math.min(last, anchor + width)
  }
  const firstBucket = Math.max(0, Math.floor((lo - 1) / size))
  const lastBucket = Math.min(meta.bucketCount - 1, Math.floor((hi - 1) / size))
  const buckets: number[] = []
  for (let b = firstBucket; b <= lastBucket; b++) buckets.push(b)
  return { lo, hi, buckets, clampedFrom }
}

export interface MapStats {
  count: number
  weight: number
  ppSum: number
  accSum: number
}

export interface PeerStats {
  players: number
  minRank: number
  maxRank: number
  maps: Map<number, MapStats>
}

export function aggregate(buckets: Bucket[]): PeerStats {
  const maps = new Map<number, MapStats>()
  let players = 0
  let minRank = Infinity
  let maxRank = 0
  for (const bucket of buckets) {
    if (!bucket.players) continue
    players += bucket.players
    minRank = Math.min(minRank, bucket.minRank)
    maxRank = Math.max(maxRank, bucket.maxRank)
    for (const [index, count, weight, ppSum, accSum] of bucket.rows) {
      const stats = maps.get(index)
      if (stats) {
        stats.count += count
        stats.weight += weight
        stats.ppSum += ppSum
        stats.accSum += accSum
      } else {
        maps.set(index, { count, weight, ppSum, accSum })
      }
    }
  }
  return { players, minRank: Number.isFinite(minRank) ? minRank : 0, maxRank, maps }
}

/**
 * A bilinear skill model in the spirit of BiRating (Casanova 2025, arXiv:2502.19742):
 * score(player, map) ~ skill(player) * value(map). The peers' mean pp on a map estimates its
 * value at this rank; the player's skill is the median ratio of their pp to that mean on maps
 * both have played. Medians keep one lucky or bad play from skewing the estimate.
 */
export interface SkillModel {
  ppRatio: number
  accRatio: number
  sharedMaps: number
}

const MIN_SHARED = 3

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function fitSkill(profile: PlayerProfile, stats: PeerStats, indexById: Map<string, number>): SkillModel {
  const ppRatios: number[] = []
  const accRatios: number[] = []
  for (const play of profile.scores) {
    const index = indexById.get(play.mapId)
    const peer = index === undefined ? undefined : stats.maps.get(index)
    if (!peer || peer.count < 2) continue
    const avgPP = peer.ppSum / peer.count
    const avgAcc = peer.accSum / peer.count
    if (avgPP > 0) ppRatios.push(play.pp / avgPP)
    if (avgAcc > 0 && play.acc > 0) accRatios.push(play.acc / avgAcc)
  }
  if (ppRatios.length < MIN_SHARED) return { ppRatio: 1, accRatio: 1, sharedMaps: ppRatios.length }
  return {
    ppRatio: Math.min(1.4, Math.max(0.6, median(ppRatios))),
    accRatio: accRatios.length ? Math.min(1.05, Math.max(0.95, median(accRatios))) : 1,
    sharedMaps: ppRatios.length,
  }
}

export interface Recommendation {
  map: MapInfo
  /** Peers with this map in their top plays. */
  count: number
  share: number
  /** The 2021 score: decay-weighted appearances per peer. */
  popularity: number
  avgPP: number
  avgAcc: number
  /** How much more common the map is at this rank than across all ranks (>1 = rank-specific). */
  lift: number
  specificity: number
  mine?: PlayScore
  predictedPP?: number
  predictedAcc?: number
  gain?: number
}

export interface RecommendOptions {
  maps: MapInfo[]
  stats: PeerStats
  meta: Meta
  sort: SortMode
  profile?: PlayerProfile | null
  skill?: SkillModel | null
  hidePlayed?: boolean
  minStars?: number | null
  maxStars?: number | null
  minCount?: number
}

export function defaultMinCount(players: number): number {
  return players >= 300 ? 3 : 2
}

export function recommend(options: RecommendOptions): Recommendation[] {
  const { maps, stats, meta, profile, skill } = options
  const sort: SortMode = options.sort === 'gain' && !profile ? 'popular' : options.sort
  const minCount = options.minCount ?? defaultMinCount(stats.players)
  const totalPlayers = Math.max(1, meta.playerCount)
  const n = Math.max(1, stats.players)

  const mine = new Map<string, PlayScore>()
  for (const play of profile?.scores ?? []) {
    const existing = mine.get(play.mapId)
    if (!existing || existing.pp < play.pp) mine.set(play.mapId, play)
  }
  const myPPs = (profile?.scores ?? []).map((s) => s.pp).sort((a, b) => b - a)
  const myTotal = weightedTotal(myPPs, meta.decay)

  const out: Recommendation[] = []
  for (const [index, s] of stats.maps) {
    const map = maps[index]
    if (!map || s.count < minCount) continue
    if (options.minStars != null && map.stars < options.minStars) continue
    if (options.maxStars != null && map.stars > options.maxStars) continue
    const played = mine.get(map.id)
    if (played && options.hidePlayed) continue

    const share = s.count / n
    // Laplace-smoothed ratio of how common the map is here vs. everywhere.
    const lift = ((s.count + 1) / (n + 2)) / ((map.globalCount + 1) / (totalPlayers + 2))
    const rec: Recommendation = {
      map,
      count: s.count,
      share,
      popularity: s.weight / n,
      avgPP: s.ppSum / s.count,
      avgAcc: s.accSum / s.count,
      lift,
      specificity: lift > 1 ? share * Math.log2(lift) : 0,
      mine: played,
    }
    if (profile) {
      const model = skill ?? { ppRatio: 1, accRatio: 1, sharedMaps: 0 }
      rec.predictedPP = rec.avgPP * model.ppRatio
      rec.predictedAcc = Math.min(1, rec.avgAcc * model.accRatio)
      rec.gain = gainFromPlay(myPPs, rec.predictedPP, meta.decay, played?.pp, myTotal)
    }
    out.push(rec)
  }

  const key: Record<SortMode, (r: Recommendation) => number> = {
    gain: (r) => r.gain ?? 0,
    popular: (r) => r.popularity,
    specific: (r) => r.specificity,
    pp: (r) => r.avgPP,
  }
  const score = key[sort]
  return out
    .filter((r) => sort !== 'gain' || (r.gain ?? 0) > 0)
    .sort((a, b) => score(b) - score(a) || b.popularity - a.popularity || a.map.index - b.map.index)
}
