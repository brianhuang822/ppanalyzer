import {
  clampAcc,
  interpolate,
  median,
  MIN_SHARED_MAPS,
  OVERWEIGHT_SHRINK,
  ppAt,
  shrunkAffinity,
} from './model'
import { gainFromPlay, weightedTotal } from './pp'
import type { Bucket, MapInfo, Meta, PlayerProfile, PlayScore } from './types'

export type WindowMode = 'around' | 'above'
export type SortMode = 'climb' | 'perMinute' | 'overweight' | 'trending' | 'popular'
export type PlayedFilter = 'new' | 'improve' | 'all'

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
  residSum: number
  recent: number
}

export interface PeerStats {
  players: number
  minRank: number
  maxRank: number
  maps: Map<number, MapStats>
  /** [stars, typical accuracy] for this range of ranks. */
  accCurve: [number, number][]
  /** pp at each position of a typical play list in this range. */
  typical: number[]
}

export function aggregate(buckets: Bucket[]): PeerStats {
  const maps = new Map<number, MapStats>()
  const curve = new Map<number, { sum: number; n: number }>()
  const typicalSums: { sum: number; weight: number }[] = []
  let players = 0
  let minRank = Infinity
  let maxRank = 0
  for (const bucket of buckets) {
    if (!bucket.players) continue
    players += bucket.players
    minRank = Math.min(minRank, bucket.minRank)
    maxRank = Math.max(maxRank, bucket.maxRank)
    for (const [index, count, weight, ppSum, accSum, residSum, recent] of bucket.rows) {
      const stats = maps.get(index)
      if (stats) {
        stats.count += count
        stats.weight += weight
        stats.ppSum += ppSum
        stats.accSum += accSum
        stats.residSum += residSum
        stats.recent += recent
      } else {
        maps.set(index, { count, weight, ppSum, accSum, residSum, recent })
      }
    }
    for (const [stars, acc, n] of bucket.accCurve) {
      const entry = curve.get(stars) ?? { sum: 0, n: 0 }
      entry.sum += acc * n
      entry.n += n
      curve.set(stars, entry)
    }
    bucket.typical.forEach((pp, i) => {
      typicalSums[i] ??= { sum: 0, weight: 0 }
      typicalSums[i].sum += pp * bucket.players
      typicalSums[i].weight += bucket.players
    })
  }
  const accCurve = [...curve.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([stars, { sum, n }]) => [stars, sum / n] as [number, number])
  const typical: number[] = []
  for (const entry of typicalSums) {
    // Stop where fewer than half the players have that many plays.
    if (!entry || entry.weight < players / 2) break
    typical.push(entry.sum / entry.weight)
  }
  return { players, minRank: Number.isFinite(minRank) ? minRank : 0, maxRank, maps, accCurve, typical }
}

/** Typical accuracy at this star rating for the peer range (NaN when unknown). */
export function expectedAcc(stats: PeerStats, stars: number): number {
  return interpolate(stats.accCurve, stars)
}

/** How much better than expected (in accuracy) players here do on the map, shrunk toward 0. */
export function overweightOf(stats: MapStats): number {
  return stats.residSum / (stats.count + OVERWEIGHT_SHRINK)
}

export interface SkillModel {
  /** Your accuracy minus the band's typical accuracy at the same stars, on maps you played. */
  offset: number
  sharedMaps: number
  /** Extra accuracy on maps with a given BeatSaver tag (shrunk, capped at ±1%). */
  affinity: Map<string, number>
}

/**
 * Fit a player against the peer range: their offset is the median of
 * (accuracy - typical accuracy at the stars - the map's overweight) over their plays, so playing
 * mostly overweighted maps doesn't make someone look better than they are.
 */
export function fitSkill(profile: PlayerProfile, stats: PeerStats, maps: MapInfo[],
  indexById: Map<string, number>): SkillModel {
  const residuals: { map: MapInfo; value: number }[] = []
  for (const play of profile.scores) {
    const index = indexById.get(play.mapId)
    const map = index === undefined ? undefined : maps[index]
    if (!map || !(map.stars > 0) || !(play.acc > 0)) continue
    const expected = expectedAcc(stats, map.stars)
    if (!Number.isFinite(expected)) continue
    const peer = stats.maps.get(map.index)
    residuals.push({ map, value: play.acc - expected - (peer ? overweightOf(peer) : 0) })
  }
  if (residuals.length < MIN_SHARED_MAPS) return { offset: 0, sharedMaps: residuals.length, affinity: new Map() }
  const offset = median(residuals.map((r) => r.value))
  const sums = new Map<string, { sum: number; n: number }>()
  for (const { map, value } of residuals) {
    for (const tag of map.tags) {
      const entry = sums.get(tag) ?? { sum: 0, n: 0 }
      entry.sum += value - offset
      entry.n += 1
      sums.set(tag, entry)
    }
  }
  const affinity = new Map([...sums].map(([tag, { sum, n }]) => [tag, shrunkAffinity(sum, n)]))
  return { offset, sharedMaps: residuals.length, affinity }
}

function styleBoost(map: MapInfo, skill: SkillModel | null | undefined): number {
  if (!skill || !map.tags.length) return 0
  const values = map.tags.map((t) => skill.affinity.get(t) ?? 0)
  return values.reduce((a, b) => a + b, 0) / values.length
}

export interface Recommendation {
  map: MapInfo
  /** Peers with this map among their ranked plays. */
  count: number
  share: number
  /** The 2021 score: decay-weighted appearances per peer. */
  popularity: number
  avgPP: number
  avgAcc: number
  /** Accuracy above what the stars imply for players here (shrunk). */
  overweight: number
  /** The same as extra pp per play versus a typical map of this star rating... */
  overweightPP: number
  /** ...and as a share of that map's typical pp. */
  overweightPct: number
  /** Peers who set their score on it in the last `recentDays`. */
  recent: number
  newlyRanked: boolean
  mine?: PlayScore
  predictedAcc: number
  predictedPP: number
  /** Increase in total pp from setting the predicted play (for you, or a typical peer). */
  gain: number
  gainPerMinute: number
}

export interface RecommendOptions {
  maps: MapInfo[]
  stats: PeerStats
  meta: Meta
  sort: SortMode
  profile?: PlayerProfile | null
  skill?: SkillModel | null
  played?: PlayedFilter
  minStars?: number | null
  maxStars?: number | null
  tag?: string | null
  minCount?: number
}

export function defaultMinCount(players: number): number {
  return players >= 300 ? 3 : 2
}

/**
 * Climb sorts only trust maps at least 1% of the players around you have played: a prediction
 * built from 3 outliers on a map above the band's level is mostly noise (and accuracy ceilings on
 * easy maps make strong players' edge on hard ones look smaller than it is).
 */
export function climbMinCount(players: number): number {
  return Math.max(defaultMinCount(players), Math.ceil(players * 0.01))
}

const DEFAULT_MINUTES = 3

export function recommend(options: RecommendOptions): Recommendation[] {
  const { maps, stats, meta, profile, skill, sort } = options
  const played: PlayedFilter = profile ? options.played ?? 'new' : 'all'
  const minCount = options.minCount ?? defaultMinCount(stats.players)
  const n = Math.max(1, stats.players)
  const recentDays = meta.recentDays ?? 30
  const fetchedAt = meta.fetchedAt ? Date.parse(meta.fetchedAt) / 1000 : Date.now() / 1000

  const mine = new Map<string, PlayScore>()
  for (const play of profile?.scores ?? []) {
    const existing = mine.get(play.mapId)
    if (!existing || existing.pp < play.pp) mine.set(play.mapId, play)
  }
  // Without a profile, gains are for a typical player in this range.
  const list = profile ? profile.scores.map((s) => s.pp).sort((a, b) => b - a) : stats.typical
  const total = weightedTotal(list, meta.decay)
  const offset = profile ? skill?.offset ?? 0 : 0

  const out: Recommendation[] = []
  for (const [index, s] of stats.maps) {
    const map = maps[index]
    if (!map || s.count < minCount) continue
    if (options.minStars != null && map.stars < options.minStars) continue
    if (options.maxStars != null && map.stars > options.maxStars) continue
    if (options.tag && !map.tags.includes(options.tag)) continue
    const myPlay = profile ? mine.get(map.id) : undefined
    if (played === 'new' && myPlay) continue
    if (played === 'improve' && !myPlay) continue

    const avgAcc = s.accSum / s.count
    const typicalAcc = expectedAcc(stats, map.stars)
    const base = Number.isFinite(typicalAcc) ? typicalAcc : avgAcc
    const overweight = overweightOf(s)
    const basePP = ppAt(meta, map, base)
    const boostedPP = ppAt(meta, map, clampAcc(base + overweight))
    const predictedAcc = clampAcc(base + offset + overweight + (profile ? styleBoost(map, skill) : 0))
    const predictedPP = ppAt(meta, map, predictedAcc)
    const gain = gainFromPlay(list, predictedPP, meta.decay, myPlay?.pp, total)
    out.push({
      map,
      count: s.count,
      share: s.count / n,
      popularity: s.weight / n,
      avgPP: s.ppSum / s.count,
      avgAcc,
      overweight,
      overweightPP: boostedPP - basePP,
      overweightPct: basePP > 0 ? boostedPP / basePP - 1 : 0,
      recent: s.recent,
      newlyRanked: map.rankedAt != null && fetchedAt - map.rankedAt <= recentDays * 86400,
      mine: myPlay,
      predictedAcc,
      predictedPP,
      gain,
      gainPerMinute: gain / ((map.duration ?? DEFAULT_MINUTES * 60) / 60),
    })
  }

  const key: Record<SortMode, (r: Recommendation) => number> = {
    climb: (r) => r.gain,
    perMinute: (r) => r.gainPerMinute,
    // Absolute pp: +60% on a 1* map is worth less than +10% on a map at your level.
    overweight: (r) => r.overweightPP,
    trending: (r) => r.recent / n + r.overweightPP * 1e-6,
    popular: (r) => r.popularity,
  }
  const score = key[sort]
  const climbing = sort === 'climb' || sort === 'perMinute'
  const needsGain = climbing || played === 'improve'
  const support = options.minCount ?? (climbing ? climbMinCount(stats.players) : minCount)
  return out
    .filter((r) => (!needsGain || r.gain > 0) && r.count >= support)
    .sort((a, b) => score(b) - score(a) || b.popularity - a.popularity || a.map.index - b.map.index)
}
