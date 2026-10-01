/** Read site data and raw snapshots from disk with the same parsers the app uses. */
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { normalizeBucket, parseMaps } from '../src/lib/parse'
import { aggregate, type PeerStats } from '../src/lib/recommend'
import type { Bucket, MapInfo, Meta, SourceEntry, Table } from '../src/lib/types'

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

export function readSources(dataDir: string): SourceEntry[] {
  const path = join(dataDir, 'sources.json')
  return existsSync(path) ? readJson<{ sources: SourceEntry[] }>(path).sources : []
}

export class SiteData {
  readonly meta: Meta
  readonly maps: MapInfo[]
  readonly indexById: Map<string, number>
  private readonly buckets = new Map<number, Bucket>()
  private readonly stats = new Map<string, PeerStats>()

  constructor(readonly dir: string) {
    this.meta = readJson<Meta>(join(dir, 'meta.json'))
    this.maps = parseMaps(readJson<Table<unknown[]>>(join(dir, 'maps.json')))
    this.indexById = new Map(this.maps.map((m) => [m.id, m.index]))
  }

  bucket(b: number): Bucket {
    let bucket = this.buckets.get(b)
    if (!bucket) {
      bucket = normalizeBucket(readJson<Bucket>(join(this.dir, 'buckets', `${b}.json`)))
      this.buckets.set(b, bucket)
    }
    return bucket
  }

  /** Pooled statistics for a list of buckets (cached: many players share a window). */
  peers(buckets: number[]): PeerStats {
    const key = buckets.join(',')
    let stats = this.stats.get(key)
    if (!stats) {
      stats = aggregate(buckets.map((b) => this.bucket(b)))
      this.stats.set(key, stats)
    }
    return stats
  }
}

export interface RawPlayer {
  id: string
  name: string
  rank: number
  pp: number
  /** [leaderboardId, pp, accuracy, setAt?] best first */
  scores: [string, number, number, number?][]
}

/** Stream a players.jsonl, keeping only players `keep` accepts (raw snapshots are large). */
export async function readRawPlayers(path: string, keep: (id: string) => boolean = () => true):
  Promise<Map<string, RawPlayer>> {
  const players = new Map<string, RawPlayer>()
  const lines = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity })
  for await (const line of lines) {
    if (!line.trim()) continue
    const player = JSON.parse(line) as RawPlayer
    if (keep(player.id)) players.set(player.id, player)
  }
  return players
}
