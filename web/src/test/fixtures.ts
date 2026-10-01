import type { Bucket, BucketRow, MapInfo, Meta } from '../lib/types'

export function makeMap(overrides: Partial<MapInfo> = {}): MapInfo {
  return {
    index: 0,
    id: '101',
    hash: 'ABCDEF0123456789ABCDEF0123456789ABCDEF01',
    key: '2a1b',
    name: 'Song',
    subName: '',
    artist: 'Artist',
    mapper: 'Mapper',
    difficulty: 'ExpertPlus',
    mode: 'Standard',
    stars: 9.5,
    cover: '',
    globalCount: 10,
    globalWeight: 5,
    ppScale: null,
    rankedAt: null,
    duration: null,
    tags: [],
    njs: null,
    nps: null,
    mods: [],
    ...overrides,
  }
}

export const testMeta: Meta = {
  source: 'scoresaber', label: 'ScoreSaber', realm: null, sample: false, decay: 0.965, bucketSize: 100,
  bucketCount: 300, shardCount: 256, playerCount: 30000, mapCount: 4, minRank: 1, maxRank: 30000,
  scoresPerPlayer: 100, recentDays: 30, fetchedAt: '2026-09-28T00:00:00Z', builtAt: '',
}

export function makeBucket(b: number, players: number, rows: BucketRow[], extra: Partial<Bucket> = {}): Bucket {
  return {
    bucket: b, players, minRank: b * 100 + 1, maxRank: b * 100 + players, fields: [], rows,
    accCurve: [[4.25, 0.97, 50], [8.25, 0.95, 50], [12.25, 0.9, 50]],
    typical: [400, 350, 300, 250, 200],
    ...extra,
  }
}
