export type SourceId = 'scoresaber' | 'beatleader' | 'sample' | (string & {})

export interface SourceEntry {
  id: SourceId
  label: string
  sample: boolean
  fetchedAt: string | null
}

/** meta.json written by `ppanalyzer build`. */
export interface Meta {
  source: SourceId
  label: string
  realm: string | null
  sample: boolean
  decay: number
  bucketSize: number
  bucketCount: number
  shardCount: number
  playerCount: number
  mapCount: number
  minRank: number
  maxRank: number
  scoresPerPlayer: number | null
  fetchedAt: string | null
  builtAt: string
}

export interface MapInfo {
  index: number
  id: string
  hash: string
  key: string | null
  name: string
  subName: string
  artist: string
  mapper: string
  difficulty: string
  mode: string
  stars: number
  cover: string
  globalCount: number
  globalWeight: number
}

/** Columnar file: `fields` names the entries of every row. */
export interface Table<Row = unknown[]> {
  fields: string[]
  rows: Row[]
}

/** [mapIndex, playersWithIt, decayWeightedCount, ppSum, accSum] */
export type BucketRow = [number, number, number, number, number]

export interface Bucket {
  bucket: number
  players: number
  minRank: number
  maxRank: number
  fields: string[]
  rows: BucketRow[]
}

export interface SnapshotPlayer {
  name: string
  country: string
  rank: number
  pp: number
  /** [mapIndex, pp, accuracy] best first */
  scores: [number, number, number][]
}

export interface PlayerShard {
  fields: string[]
  players: Record<string, SnapshotPlayer>
}

export interface PlayScore {
  /** Leaderboard id; matches MapInfo.id when the map is in the snapshot. */
  mapId: string
  pp: number
  acc: number
}

export interface PlayerProfile {
  id: string
  name: string
  rank: number
  pp: number
  scores: PlayScore[]
  origin: 'live' | 'snapshot'
}

export interface PlayerHit {
  id: string
  name: string
  rank: number
}
