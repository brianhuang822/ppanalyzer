import { normalizeBucket, parseMaps } from './parse'
import { shardOf } from './shard'
import type {
  Backtest,
  Bucket,
  MapInfo,
  Meta,
  PlayerHit,
  PlayerProfile,
  PlayerShard,
  PlaylistBand,
  SourceEntry,
  Table,
} from './types'

/** Static data lives next to the app: <base>/data/<source>/... */
export const DATA_ROOT = `${import.meta.env.BASE_URL}data`

const cache = new Map<string, Promise<unknown>>()

async function getJson<T>(path: string): Promise<T> {
  const url = `${DATA_ROOT}/${path}`
  let pending = cache.get(url) as Promise<T> | undefined
  if (!pending) {
    pending = fetch(url).then(async (response) => {
      if (!response.ok) throw new Error(`Could not load ${path} (HTTP ${response.status})`)
      return (await response.json()) as T
    })
    pending.catch(() => cache.delete(url))
    cache.set(url, pending)
  }
  return pending
}

export function clearDataCache(): void {
  cache.clear()
}

export async function loadSources(): Promise<SourceEntry[]> {
  const index = await getJson<{ sources: SourceEntry[] }>('sources.json')
  return index.sources
}

export function loadMeta(source: string): Promise<Meta> {
  return getJson<Meta>(`${source}/meta.json`)
}

export async function loadMaps(source: string): Promise<MapInfo[]> {
  return parseMaps(await getJson<Table<unknown[]>>(`${source}/maps.json`))
}

export async function loadBucket(source: string, bucket: number): Promise<Bucket> {
  return normalizeBucket(await getJson<Bucket>(`${source}/buckets/${bucket}.json`))
}

export async function loadBuckets(source: string, buckets: number[]): Promise<Bucket[]> {
  return Promise.all(buckets.map((b) => loadBucket(source, b)))
}

/** Personal data for a player in the snapshot (the fallback when the live API is unreachable). */
export async function loadSnapshotPlayer(source: string, meta: Meta, maps: MapInfo[],
  playerId: string): Promise<PlayerProfile | null> {
  let shard: PlayerShard
  try {
    shard = await getJson<PlayerShard>(`${source}/players/${shardOf(playerId, meta.shardCount)}.json`)
  } catch {
    return null
  }
  const player = shard.players[playerId]
  if (!player) return null
  return {
    id: playerId,
    name: player.name,
    rank: player.rank,
    pp: player.pp,
    origin: 'snapshot',
    scores: player.scores
      .filter(([index]) => maps[index] !== undefined)
      .map(([index, pp, acc]) => ({ mapId: maps[index].id, pp, acc })),
  }
}

/** Optional files: missing ones (older data, first week) just hide their feature. */
export async function loadBacktest(source: string): Promise<Backtest | null> {
  try {
    return await getJson<Backtest>(`${source}/backtest.json`)
  } catch {
    return null
  }
}

export async function loadPlaylistBands(source: string): Promise<PlaylistBand[]> {
  try {
    return (await getJson<{ bands: PlaylistBand[] }>(`${source}/playlists/index.json`)).bands
  } catch {
    return []
  }
}

/** Absolute URL of a data file, for links that leave the browser (e.g. bsplaylist://). */
export function dataUrl(path: string): string {
  return new URL(`${DATA_ROOT}/${path}`, window.location.href).toString()
}

export async function searchSnapshotPlayers(source: string, name: string, limit = 8): Promise<PlayerHit[]> {
  const index = await getJson<[string, string, number][]>(`${source}/players/index.json`)
  const needle = name.trim().toLowerCase()
  const exact: PlayerHit[] = []
  const partial: PlayerHit[] = []
  for (const [id, playerName, rank] of index) {
    const lower = playerName.toLowerCase()
    if (lower === needle) exact.push({ id, name: playerName, rank })
    else if (lower.includes(needle)) partial.push({ id, name: playerName, rank })
    if (exact.length >= limit) break
  }
  return [...exact, ...partial].slice(0, limit)
}
