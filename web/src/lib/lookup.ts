import { loadSnapshotPlayer, searchSnapshotPlayers } from './data'
import { fetchLivePlayer, NotFoundError, searchLivePlayers, supportsLive } from './live'
import type { MapInfo, Meta, PlayerHit, PlayerProfile, SourceId } from './types'

export interface LookupResult {
  profile: PlayerProfile
  /** Why the live API wasn't used, when the profile came from the snapshot. */
  liveError?: string
}

function describe(error: unknown): string {
  if (error instanceof NotFoundError) return 'not found on the live leaderboard'
  if (error instanceof DOMException && error.name === 'AbortError') return 'the live API timed out'
  if (error instanceof TypeError) return 'the browser could not reach the live API, most likely blocked by CORS'
  return error instanceof Error ? error.message : String(error)
}

export async function lookupPlayer(source: SourceId, meta: Meta, maps: MapInfo[], id: string): Promise<LookupResult> {
  let liveError: string | undefined
  if (supportsLive(source)) {
    try {
      return { profile: await fetchLivePlayer(source, id) }
    } catch (error) {
      liveError = describe(error)
    }
  }
  const snapshot = await loadSnapshotPlayer(source, meta, maps, id)
  if (snapshot) return { profile: snapshot, liveError }
  const coverage = `the snapshot only covers ranks ${meta.minRank.toLocaleString('en-US')}–${meta.maxRank.toLocaleString('en-US')}`
  throw new Error(
    liveError
      ? `Couldn't load player ${id}: ${liveError}, and ${coverage}. Enter your rank instead.`
      : `Player ${id} isn't in the snapshot (${coverage}). Enter your rank instead.`,
  )
}

export async function searchPlayers(source: SourceId, name: string): Promise<{ hits: PlayerHit[]; live: boolean }> {
  if (supportsLive(source)) {
    try {
      return { hits: await searchLivePlayers(source, name), live: true }
    } catch {
      // Fall through to the snapshot's name index.
    }
  }
  return { hits: await searchSnapshotPlayers(source, name), live: false }
}
