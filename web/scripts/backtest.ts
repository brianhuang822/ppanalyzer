/**
 * Check last week's model against what players actually did since.
 *
 * For a sample of players in the previous snapshot it predicts the accuracy of every score they
 * set or improved by this week, with and without each map's overweight. If overweight is a real
 * edge, adding it must shrink the error, and it should correlate with how much better than
 * expected players did. It also scores each sort order: of the top 25 maps it recommended, how
 * many did players go on to play (hit rate, mostly a popularity measure), and when they did, how
 * much did each one add to their total pp (gain per map played: the climbing speed of following
 * that list). Observational: players never saw these lists.
 *
 * Usage: tsx scripts/backtest.ts --before-site <site>/<source> --before-raw <raw dir>
 *        --after-raw <raw dir> --out <site>/<source>/backtest.json
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { weightedTotal } from '../src/lib/pp'
import {
  expectedAcc,
  fitSkill,
  overweightOf,
  peerWindow,
  recommend,
  type SortMode,
} from '../src/lib/recommend'
import { fnv1a32 } from '../src/lib/shard'
import type { Backtest, Meta, PlayerProfile } from '../src/lib/types'
import { readJson, readRawPlayers, SiteData } from './site'

export interface BacktestOptions {
  /** Share of players to evaluate (deterministic by id). */
  fraction: number
  width: number
  top: number
}

const STRATEGIES: SortMode[] = ['climb', 'overweight', 'trending', 'popular']
/** A score counts as improved when it gained at least this much pp. */
const MIN_IMPROVEMENT = 0.5

export function pearson(xs: number[], ys: number[]): number {
  const n = xs.length
  if (n < 3) return 0
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my)
    sxx += (xs[i] - mx) ** 2
    syy += (ys[i] - my) ** 2
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0
}

export async function runBacktest(beforeSite: string, beforeRaw: string, afterRaw: string,
  options: BacktestOptions = { fraction: 0.1, width: 500, top: 25 }): Promise<Backtest> {
  const site = new SiteData(beforeSite)
  const { meta, maps, indexById } = site
  const cutoff = Math.round(options.fraction * 1000)
  const before = await readRawPlayers(join(beforeRaw, 'players.jsonl'), (id) => fnv1a32(id) % 1000 < cutoff)
  const after = await readRawPlayers(join(afterRaw, 'players.jsonl'), (id) => before.has(id))
  const afterMeta = readJson<Partial<Meta>>(join(afterRaw, 'meta.json'))

  let players = 0
  let errBase = 0
  let errOverweight = 0
  let plays = 0
  const ow: number[] = []
  const surprise: number[] = []
  const totals = Object.fromEntries(STRATEGIES.map((s) => [s, { players: 0, hits: 0, gain: 0 }]))

  for (const [id, old] of before) {
    const now = after.get(id)
    if (!now || old.rank < meta.minRank || old.rank > meta.maxRank) continue
    const best = new Map(old.scores.map(([m, pp]) => [m, pp]))
    const fresh = new Map<string, { pp: number; acc: number }>()
    for (const [m, pp, acc] of now.scores) {
      const previous = best.get(m)
      if (indexById.has(m) && (previous === undefined || pp >= previous + MIN_IMPROVEMENT)) fresh.set(m, { pp, acc })
    }
    if (!fresh.size) continue
    players++

    const stats = site.peers(peerWindow(meta, old.rank, options.width, 'around').buckets)
    const profile: PlayerProfile = {
      id, name: old.name, rank: old.rank, pp: old.pp, origin: 'snapshot',
      scores: old.scores.slice(0, 100).map(([mapId, pp, acc]) => ({ mapId, pp, acc })),
    }
    const skill = fitSkill(profile, stats, maps, indexById)

    for (const [mapId, { acc }] of fresh) {
      const map = maps[indexById.get(mapId)!]
      const typical = expectedAcc(stats, map.stars)
      if (!Number.isFinite(typical) || !(acc > 0)) continue
      const peer = stats.maps.get(map.index)
      const w = peer ? overweightOf(peer) : 0
      const base = typical + skill.offset
      errBase += Math.abs(acc - base)
      errOverweight += Math.abs(acc - base - w)
      plays++
      if (peer) {
        ow.push(w)
        surprise.push(acc - base)
      }
    }

    const oldList = profile.scores.map((s) => s.pp).sort((a, b) => b - a)
    for (const sort of STRATEGIES) {
      const picks = recommend({ maps, stats, meta, sort, profile, skill, played: 'new' }).slice(0, options.top)
      const hits = picks.filter((r) => fresh.has(r.map.id) && !best.has(r.map.id))
      const t = totals[sort]
      t.players++
      t.hits += hits.length
      const newList = [...oldList, ...hits.map((r) => fresh.get(r.map.id)!.pp)].sort((a, b) => b - a)
      t.gain += weightedTotal(newList, meta.decay) - weightedTotal(oldList, meta.decay)
    }
  }

  return {
    before: meta.fetchedAt,
    after: afterMeta.fetchedAt ?? null,
    players,
    newPlays: plays,
    maeBaseline: plays ? errBase / plays : 0,
    maeWithOverweight: plays ? errOverweight / plays : 0,
    overweightCorrelation: pearson(ow, surprise),
    strategies: Object.fromEntries(STRATEGIES.map((s) => {
      const t = totals[s]
      return [s, {
        players: t.players,
        hits: t.hits,
        hitRate: t.players ? t.hits / (t.players * options.top) : 0,
        gainPerHit: t.hits ? t.gain / t.hits : 0,
      }]
    })),
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'before-site': { type: 'string' },
      'before-raw': { type: 'string' },
      'after-raw': { type: 'string' },
      out: { type: 'string' },
      fraction: { type: 'string', default: '0.1' },
      width: { type: 'string', default: '500' },
    },
  })
  for (const flag of ['before-site', 'before-raw', 'after-raw', 'out'] as const) {
    if (!values[flag]) throw new Error(`--${flag} is required`)
  }
  const result = await runBacktest(values['before-site']!, values['before-raw']!, values['after-raw']!, {
    fraction: Number(values.fraction), width: Number(values.width), top: 25,
  })
  writeFileSync(values.out!, JSON.stringify(result))
  console.log(JSON.stringify(result, null, 1))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
