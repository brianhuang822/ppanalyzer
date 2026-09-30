/**
 * Live player lookups straight from the leaderboard APIs, so recommendations reflect plays
 * set since the last snapshot. Browsers can only read these responses when the API sends
 * CORS headers; BeatLeader only allows its own sites, so callers fall back to the snapshot.
 * Set VITE_SCORESABER_API / VITE_BEATLEADER_API at build time to route through a proxy
 * (see proxy/cloudflare-worker.js).
 */
import type { PlayerHit, PlayerProfile, PlayScore, SourceId } from './types'

const SCORESABER_API = (import.meta.env.VITE_SCORESABER_API as string | undefined) ?? 'https://scoresaber.com/api/v2'
const BEATLEADER_API = (import.meta.env.VITE_BEATLEADER_API as string | undefined) ?? 'https://api.beatleader.com'
const TIMEOUT_MS = 10_000
const TOP_PLAYS = 100

export class NotFoundError extends Error {}

export function supportsLive(source: SourceId): boolean {
  return source === 'scoresaber' || source === 'beatleader'
}

async function getJson<T>(url: string): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
    if (response.status === 404) throw new NotFoundError('Player not found')
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return (await response.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

function normalizeAcc(value: unknown): number {
  const acc = Number(value) || 0
  return Math.min(1, acc > 1.5 ? acc / 100 : acc)
}

interface SsPlayer {
  id: string
  name: string
  stats?: { rank?: number; totalPP?: number }
}

interface SsScoreItem {
  score: { pp: number; accuracy: number }
  leaderboard: { id: number; realm?: { leaderboardStatus?: string } }
}

async function scoreSaberPlayer(id: string): Promise<PlayerProfile> {
  const base = SCORESABER_API.replace(/\/$/, '')
  const [player, scores] = await Promise.all([
    getJson<SsPlayer>(`${base}/players/${encodeURIComponent(id)}`),
    getJson<{ data: SsScoreItem[] }>(`${base}/players/${encodeURIComponent(id)}/scores?sort=top&limit=${TOP_PLAYS}`),
  ])
  const plays: PlayScore[] = []
  for (const item of scores.data ?? []) {
    if (!(item.score?.pp > 0)) break
    if (item.leaderboard?.realm?.leaderboardStatus && item.leaderboard.realm.leaderboardStatus !== 'RANKED') continue
    plays.push({ mapId: String(item.leaderboard.id), pp: item.score.pp, acc: normalizeAcc(item.score.accuracy) })
  }
  return {
    id: String(player.id),
    name: player.name,
    rank: Number(player.stats?.rank ?? 0),
    pp: Number(player.stats?.totalPP ?? 0),
    scores: plays,
    origin: 'live',
  }
}

async function scoreSaberSearch(name: string): Promise<PlayerHit[]> {
  const base = SCORESABER_API.replace(/\/$/, '')
  const body = await getJson<{ data: SsPlayer[] }>(`${base}/players?search=${encodeURIComponent(name)}&limit=8`)
  return (body.data ?? []).map((p) => ({ id: String(p.id), name: p.name, rank: Number(p.stats?.rank ?? 0) }))
}

interface BlPlayer {
  id: string
  name: string
  rank: number
  pp: number
}

interface BlScore {
  pp: number
  accuracy: number
  leaderboardId?: string
  leaderboard?: { id: string }
}

async function beatLeaderPlayer(id: string): Promise<PlayerProfile> {
  const base = BEATLEADER_API.replace(/\/$/, '')
  const [player, scores] = await Promise.all([
    getJson<BlPlayer>(`${base}/player/${encodeURIComponent(id)}`),
    getJson<{ data: BlScore[] }>(
      `${base}/player/${encodeURIComponent(id)}/scores?sortBy=pp&order=desc&count=${TOP_PLAYS}&type=ranked`),
  ])
  const plays: PlayScore[] = []
  for (const item of scores.data ?? []) {
    if (!(item.pp > 0)) break
    const mapId = item.leaderboard?.id ?? item.leaderboardId
    if (mapId) plays.push({ mapId: String(mapId), pp: item.pp, acc: normalizeAcc(item.accuracy) })
  }
  return { id: String(player.id), name: player.name, rank: player.rank, pp: player.pp, scores: plays, origin: 'live' }
}

async function beatLeaderSearch(name: string): Promise<PlayerHit[]> {
  const base = BEATLEADER_API.replace(/\/$/, '')
  const body = await getJson<{ data: BlPlayer[] }>(`${base}/players?search=${encodeURIComponent(name)}&count=8`)
  return (body.data ?? []).map((p) => ({ id: String(p.id), name: p.name, rank: p.rank }))
}

export function fetchLivePlayer(source: SourceId, id: string): Promise<PlayerProfile> {
  if (source === 'scoresaber') return scoreSaberPlayer(id)
  if (source === 'beatleader') return beatLeaderPlayer(id)
  return Promise.reject(new Error('No live API for this source'))
}

export function searchLivePlayers(source: SourceId, name: string): Promise<PlayerHit[]> {
  if (source === 'scoresaber') return scoreSaberSearch(name)
  if (source === 'beatleader') return beatLeaderSearch(name)
  return Promise.reject(new Error('No live API for this source'))
}
