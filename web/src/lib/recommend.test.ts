import { describe, expect, it } from 'vitest'
import { makeBucket, makeMap, testMeta as meta } from '../test/fixtures'
import { DEFAULT_PP_CURVE, interpolate, PP_PER_STAR, ppAt } from './model'
import { weightedTotal } from './pp'
import { aggregate, expectedAcc, fitSkill, overweightOf, peerWindow, recommend } from './recommend'
import type { BucketRow, PlayerProfile } from './types'

describe('peerWindow', () => {
  it('covers the buckets around a rank; rank 100 is in the first bucket', () => {
    expect(peerWindow(meta, 100, 0, 'around').buckets).toEqual([0])
    expect(peerWindow(meta, 101, 0, 'around').buckets).toEqual([1])
    expect(peerWindow(meta, 5000, 250, 'around')).toEqual({ lo: 4750, hi: 5250, buckets: [47, 48, 49, 50, 51, 52] })
  })

  it('looks only at better players in "above" mode', () => {
    expect(peerWindow(meta, 5000, 250, 'above')).toEqual({ lo: 4500, hi: 4999, buckets: [44, 45, 46, 47, 48, 49] })
    expect(peerWindow(meta, 10, 250, 'above').lo).toBe(1)
  })

  it('clamps ranks outside the snapshot and says so', () => {
    const window = peerWindow(meta, 80000, 100, 'around')
    expect(window.clampedFrom).toBe(80000)
    expect(window.buckets).toEqual([298, 299])
  })
})

describe('pp model', () => {
  it('turns accuracy into pp with the curve (ScoreSaber: stars x 42.11 x multiplier)', () => {
    const map = makeMap({ stars: 10 })
    expect(ppAt(meta, map, 0.95)).toBeCloseTo(10 * PP_PER_STAR)
    expect(ppAt(meta, map, 0.98)).toBeCloseTo(10 * PP_PER_STAR * 1.5702410055532239)
    expect(ppAt(meta, makeMap({ stars: 10, ppScale: 12 }), 0.95)).toBeCloseTo(12 * PP_PER_STAR)
    expect(interpolate(DEFAULT_PP_CURVE, 2)).toBeCloseTo(5.367394282890631 * PP_PER_STAR)
  })
})

// Map 0: ordinary 8* map. Map 1: same stars, players beat expectations by ~1% (overweighted).
// Map 2: easy 4* map. Map 3: rare. Map 4: short overweighted map, farmed recently.
const maps = [
  makeMap({ index: 0, id: 'plain', stars: 8.25, duration: 240, tags: ['tech'] }),
  makeMap({ index: 1, id: 'farm', stars: 8.25, duration: 240, tags: ['accuracy'] }),
  makeMap({ index: 2, id: 'easy', stars: 4.25, duration: 240, tags: ['accuracy'] }),
  makeMap({ index: 3, id: 'rare', stars: 8.25 }),
  makeMap({ index: 4, id: 'short', stars: 8.25, duration: 90, rankedAt: Date.parse('2026-09-20') / 1000 }),
]
// [map, count, weight, ppSum, accSum, residSum, recent]
const row = (map: number, count: number, acc: number, resid: number, recent = 0): BucketRow =>
  [map, count, count * 0.5, count * 300, count * acc, resid * count, recent]
const stats = aggregate([
  makeBucket(10, 100, [row(0, 60, 0.95, 0), row(1, 40, 0.96, 0.01), row(2, 50, 0.97, 0), row(3, 1, 0.95, 0)]),
  makeBucket(11, 100, [row(0, 50, 0.95, 0), row(1, 40, 0.96, 0.01), row(4, 30, 0.96, 0.01, 25)],
    { accCurve: [[4.25, 0.96, 50], [8.25, 0.94, 50]], typical: [380, 330, 290] }),
])

describe('aggregate', () => {
  it('pools buckets, weights the accuracy curve by plays, averages the typical list', () => {
    expect(stats.players).toBe(200)
    expect(stats.maps.get(1)).toMatchObject({ count: 80, residSum: 0.8 })
    expect(expectedAcc(stats, 4.25)).toBeCloseTo(0.965)
    expect(expectedAcc(stats, 8.25)).toBeCloseTo(0.945)
    expect(expectedAcc(stats, 12.25)).toBeCloseTo(0.9) // only one bucket knows this star level
    // Positions only one bucket has are kept while that bucket holds at least half the players.
    expect(stats.typical).toEqual([390, 340, 295, 250, 200])
  })

  it('shrinks overweight toward zero by sample size', () => {
    expect(overweightOf(stats.maps.get(1)!)).toBeCloseTo(0.8 / 90)
    expect(overweightOf(stats.maps.get(0)!)).toBe(0)
  })
})

describe('recommend without a profile (typical player at this rank)', () => {
  it('ranks the overweighted map above the ordinary one at the same stars', () => {
    const recs = recommend({ maps, stats, meta, sort: 'climb' })
    const ids = recs.map((r) => r.map.id)
    expect(ids.indexOf('farm')).toBeLessThan(ids.indexOf('plain'))
    expect(ids).not.toContain('rare') // below the minimum sample size
    const farm = recs.find((r) => r.map.id === 'farm')!
    expect(farm.predictedAcc).toBeCloseTo(0.945 + 0.8 / 90)
    expect(farm.overweightPct).toBeCloseTo(ppAt(meta, farm.map, 0.945 + 0.8 / 90) / ppAt(meta, farm.map, 0.945) - 1)
    expect(farm.overweightPct).toBeGreaterThan(0.05)
    expect(farm.gain).toBeGreaterThan(0)
  })

  it('sorts by overweight, per-minute gain, recency and popularity', () => {
    expect(recommend({ maps, stats, meta, sort: 'overweight' })[0].map.id).toBe('farm')
    expect(recommend({ maps, stats, meta, sort: 'perMinute' })[0].map.id).toBe('short')
    const trending = recommend({ maps, stats, meta, sort: 'trending' })
    expect(trending[0].map.id).toBe('short')
    expect(trending[0].newlyRanked).toBe(true)
    expect(recommend({ maps, stats, meta, sort: 'popular' })[0].map.id).toBe('plain')
  })

  it('only lets maps played by at least 1% of the range into the climb sorts', () => {
    const big = aggregate([makeBucket(5, 1000, [row(0, 400, 0.95, 0), row(1, 5, 0.97, 0.03)])])
    expect(recommend({ maps, stats: big, meta, sort: 'climb' }).map((r) => r.map.id)).toEqual(['plain'])
    expect(recommend({ maps, stats: big, meta, sort: 'overweight' }).map((r) => r.map.id)).toContain('farm')
  })

  it('filters by stars and style', () => {
    expect(recommend({ maps, stats, meta, sort: 'popular', maxStars: 5 }).map((r) => r.map.id)).toEqual(['easy'])
    expect(recommend({ maps, stats, meta, sort: 'popular', tag: 'accuracy' }).map((r) => r.map.id).sort())
      .toEqual(['easy', 'farm'])
  })
})

describe('with a profile', () => {
  const profile: PlayerProfile = {
    id: 'me', name: 'Me', rank: 1100, pp: 5000, origin: 'live',
    scores: [
      { mapId: 'plain', pp: 330, acc: 0.94 },
      { mapId: 'easy', pp: 200, acc: 0.96 },
      { mapId: 'x', pp: 310, acc: 0.95 }, // not in the snapshot; still counts toward total pp
      { mapId: 'farm', pp: 300, acc: 0.95 },
    ],
  }
  const indexById = new Map(maps.map((m) => [m.id, m.index]))

  it('fits the offset net of each map\'s overweight, and style affinity', () => {
    const skill = fitSkill(profile, stats, maps, indexById)
    expect(skill.sharedMaps).toBe(3)
    // residuals: plain 0.94-0.945-0 = -0.005; easy 0.96-0.965 = -0.005; farm 0.95-0.945-0.00889 = -0.00389
    expect(skill.offset).toBeCloseTo(-0.005)
    expect(skill.affinity.get('accuracy')).toBeGreaterThan(0) // farm/easy residuals above the offset
    expect(fitSkill({ ...profile, scores: profile.scores.slice(0, 2) }, stats, maps, indexById))
      .toMatchObject({ offset: 0, sharedMaps: 2 })
  })

  it('predicts with the offset and ranks by gain on top of the real play list', () => {
    const skill = fitSkill(profile, stats, maps, indexById)
    const recs = recommend({ maps, stats, meta, sort: 'climb', profile, skill })
    expect(recs.map((r) => r.map.id)).toEqual(['short'])
    const short = recs[0]
    expect(short.predictedAcc).toBeCloseTo(0.945 + skill.offset + overweightOf(stats.maps.get(4)!))
    const list = [330, 310, 300, 200]
    expect(short.gain).toBeCloseTo(
      weightedTotal([...list, short.predictedPP].sort((a, b) => b - a), meta.decay) - weightedTotal(list, meta.decay))
  })

  it('"improve" lists only played maps where the prediction beats the current score', () => {
    const skill = { offset: 0, sharedMaps: 5, affinity: new Map<string, number>() }
    const improve = recommend({ maps, stats, meta, sort: 'climb', profile, skill, played: 'improve' })
    expect(improve.every((r) => r.mine && r.predictedPP > r.mine.pp)).toBe(true)
    expect(improve.map((r) => r.map.id)).toContain('farm')
    const all = recommend({ maps, stats, meta, sort: 'popular', profile, skill, played: 'all' })
    expect(all.map((r) => r.map.id)).toEqual(expect.arrayContaining(['plain', 'farm', 'easy', 'short']))
  })
})
