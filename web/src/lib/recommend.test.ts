import { describe, expect, it } from 'vitest'
import { makeMap } from '../test/fixtures'
import { aggregate, fitSkill, peerWindow, recommend, type PeerStats } from './recommend'
import type { Bucket, Meta, PlayerProfile } from './types'

const meta: Meta = {
  source: 'scoresaber', label: 'ScoreSaber', realm: null, sample: false, decay: 0.965, bucketSize: 100,
  bucketCount: 300, shardCount: 256, playerCount: 30000, mapCount: 4, minRank: 1, maxRank: 30000,
  scoresPerPlayer: 100, fetchedAt: null, builtAt: '',
}

describe('peerWindow', () => {
  it('covers the buckets around a rank; rank 100 is in the first bucket', () => {
    expect(peerWindow(meta, 100, 0, 'around').buckets).toEqual([0])
    expect(peerWindow(meta, 101, 0, 'around').buckets).toEqual([1])
    expect(peerWindow(meta, 5000, 250, 'around')).toEqual({ lo: 4750, hi: 5250, buckets: [47, 48, 49, 50, 51, 52] })
  })

  it('looks only at better players in "above" mode', () => {
    expect(peerWindow(meta, 5000, 250, 'above')).toEqual({ lo: 4500, hi: 4999, buckets: [44, 45, 46, 47, 48, 49] })
    // Near the top there is nobody above; fall back to around.
    expect(peerWindow(meta, 10, 250, 'above').lo).toBe(1)
  })

  it('clamps ranks outside the snapshot and says so', () => {
    const window = peerWindow(meta, 80000, 100, 'around')
    expect(window.clampedFrom).toBe(80000)
    expect(window.buckets).toEqual([298, 299])
    expect(peerWindow(meta, -5, 100, 'around').buckets).toEqual([0, 1])
  })
})

const bucket = (b: number, players: number, rows: Bucket['rows']): Bucket => ({
  bucket: b, players, minRank: b * 100 + 1, maxRank: b * 100 + players, fields: [], rows,
})

describe('aggregate + recommend', () => {
  const maps = [
    makeMap({ index: 0, id: 'a', stars: 10, globalCount: 20000 }), // everyone plays it
    makeMap({ index: 1, id: 'b', stars: 8, globalCount: 300 }), // specific to this rank
    makeMap({ index: 2, id: 'c', stars: 5, globalCount: 2000 }),
    makeMap({ index: 3, id: 'd', stars: 6, globalCount: 5 }), // too rare here
  ]
  const stats: PeerStats = aggregate([
    bucket(10, 100, [[0, 80, 60, 80 * 300, 80 * 0.95], [1, 40, 35, 40 * 320, 40 * 0.96], [2, 20, 10, 20 * 200, 20 * 0.97]]),
    bucket(11, 100, [[0, 70, 50, 70 * 280, 70 * 0.94], [1, 50, 40, 50 * 330, 50 * 0.955], [3, 1, 1, 200, 0.9]]),
  ])

  it('sums buckets', () => {
    expect(stats.players).toBe(200)
    expect(stats.minRank).toBe(1001)
    expect(stats.maxRank).toBe(1200)
    expect(stats.maps.get(0)).toEqual({ count: 150, weight: 110, ppSum: 80 * 300 + 70 * 280, accSum: 80 * 0.95 + 70 * 0.94 })
  })

  it('ranks by popularity (the original 2021 method) and by rank-specificity', () => {
    const popular = recommend({ maps, stats, meta, sort: 'popular' })
    expect(popular.map((r) => r.map.id)).toEqual(['a', 'b', 'c']) // d is below the min count
    expect(popular[0].share).toBeCloseTo(0.75)
    expect(popular[0].avgPP).toBeCloseTo((80 * 300 + 70 * 280) / 150)

    const specific = recommend({ maps, stats, meta, sort: 'specific' })
    expect(specific[0].map.id).toBe('b')
    expect(specific[0].lift).toBeGreaterThan(10)
  })

  it('filters by stars', () => {
    const recs = recommend({ maps, stats, meta, sort: 'popular', minStars: 7, maxStars: 9 })
    expect(recs.map((r) => r.map.id)).toEqual(['b'])
  })

  it('falls back from gain to popular without a profile', () => {
    expect(recommend({ maps, stats, meta, sort: 'gain' })[0].gain).toBeUndefined()
  })

  describe('with a profile', () => {
    const profile: PlayerProfile = {
      id: 'me', name: 'Me', rank: 1100, pp: 5000, origin: 'live',
      scores: [
        { mapId: 'a', pp: 250, acc: 0.93 },
        { mapId: 'x', pp: 240, acc: 0.95 }, // not in the snapshot; still counts toward total pp
        { mapId: 'c', pp: 190, acc: 0.96 },
      ],
    }
    const indexById = new Map(maps.map((m) => [m.id, m.index]))

    it('needs three shared maps to calibrate', () => {
      expect(fitSkill(profile, stats, indexById)).toEqual({ ppRatio: 1, accRatio: 1, sharedMaps: 2 })
      const more = { ...profile, scores: [...profile.scores, { mapId: 'b', pp: 280, acc: 0.95 }] }
      const skill = fitSkill(more, stats, indexById)
      expect(skill.sharedMaps).toBe(3)
      expect(skill.ppRatio).toBeGreaterThan(0.8)
      expect(skill.ppRatio).toBeLessThan(1)
    })

    it('ranks unplayed maps by expected gain and hides played ones', () => {
      const skill = { ppRatio: 0.9, accRatio: 1, sharedMaps: 5 }
      const recs = recommend({ maps, stats, meta, sort: 'gain', profile, skill, hidePlayed: true })
      expect(recs.map((r) => r.map.id)).toEqual(['b'])
      expect(recs[0].predictedPP).toBeCloseTo(0.9 * ((40 * 320 + 50 * 330) / 90))
      expect(recs[0].gain).toBeGreaterThan(0)
    })

    it('shows improvable played maps when not hidden', () => {
      const skill = { ppRatio: 1, accRatio: 1, sharedMaps: 5 }
      const recs = recommend({ maps, stats, meta, sort: 'gain', profile, skill, hidePlayed: false })
      const byId = new Map(recs.map((r) => [r.map.id, r]))
      expect(recs[0].map.id).toBe('b') // unplayed, peers average ~326pp
      expect(byId.get('a')?.mine?.pp).toBe(250) // peers average ~291pp: worth improving
      expect(byId.get('c')?.gain).toBeGreaterThan(0) // peers 200pp vs my 190pp: small but positive
      expect(byId.get('c')!.gain!).toBeLessThan(byId.get('a')!.gain!)
    })
  })
})
