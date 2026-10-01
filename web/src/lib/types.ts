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
  /** Median number of ranked plays per player in the snapshot. */
  medianPlays?: number
  /** Share of players whose every ranked play was fetched. */
  completeShare?: number
  recentDays?: number
  /** pp per unit of map scale as a function of accuracy (fitted from the data). */
  ppCurve?: [number, number][]
  ppCurveFitted?: boolean
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
  /** pp = ppScale x curve(accuracy); equals the star rating on ScoreSaber. */
  ppScale: number | null
  rankedAt: number | null
  /** Seconds. */
  duration: number | null
  tags: string[]
  njs: number | null
  nps: number | null
  mods: string[]
}

/** Columnar file: `fields` names the entries of every row. */
export interface Table<Row = unknown[]> {
  fields: string[]
  rows: Row[]
}

/**
 * [mapIndex, playersWithIt, decayWeightedCount, ppSum, accSum, residualSum, recentPlays]
 * residualSum: sum of (accuracy - typical accuracy at these stars - player's offset).
 */
export type BucketRow = [number, number, number, number, number, number, number]

export interface Bucket {
  bucket: number
  players: number
  minRank: number
  maxRank: number
  fields: string[]
  rows: BucketRow[]
  /** [starCenter, typicalAccuracy, plays] */
  accCurve: [number, number, number][]
  /** Median pp at each position of these players' lists: the "typical player" here. */
  typical: number[]
}

/** Weekly check of the model against what players actually did (scripts/backtest.ts). */
export interface Backtest {
  before: string | null
  after: string | null
  players: number
  newPlays: number
  maeBaseline: number
  maeWithOverweight: number
  overweightCorrelation: number
  /** Per sort order: share of its top 25 that players went on to play, and total pp gained per such play. */
  strategies: Record<string, { players: number; hits: number; hitRate: number; gainPerHit: number }>
}

export interface PlaylistBand {
  lo: number
  hi: number
  file: string
  title: string
  songs: number
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
