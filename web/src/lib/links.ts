import type { MapInfo, SourceId } from './types'

/** BeatSaver map page. */
export function beatSaverUrl(map: MapInfo): string {
  return map.key
    ? `https://beatsaver.com/maps/${map.key}`
    : `https://beatsaver.com/?q=${encodeURIComponent(`${map.name} ${map.mapper}`.trim())}`
}

/**
 * One-click install: handled by ModAssistant / BSManager when "OneClick" is enabled for
 * BeatSaver. The mod manager downloads the map straight into CustomLevels.
 */
export function oneClickUrl(map: MapInfo): string | null {
  return map.key ? `beatsaver://${map.key}` : null
}

/** Direct zip from BeatSaver's CDN (files are named by lowercase hash). */
export function downloadUrl(map: MapInfo): string | null {
  return /^[0-9a-f]{40}$/i.test(map.hash) ? `https://r2cdn.beatsaver.com/${map.hash.toLowerCase()}.zip` : null
}

/** In-browser 3D preview. */
export function previewUrl(map: MapInfo): string | null {
  return map.key ? `https://allpoland.github.io/ArcViewer/?id=${map.key}` : null
}

export function leaderboardUrl(source: SourceId, map: MapInfo): string | null {
  if (source === 'scoresaber') return `https://scoresaber.com/leaderboard/${encodeURIComponent(map.id)}`
  if (source === 'beatleader') return `https://beatleader.com/leaderboard/global/${encodeURIComponent(map.id)}`
  return null
}

export function profileUrl(source: SourceId, playerId: string): string | null {
  if (source === 'scoresaber') return `https://scoresaber.com/u/${encodeURIComponent(playerId)}`
  if (source === 'beatleader') return `https://beatleader.com/u/${encodeURIComponent(playerId)}`
  return null
}
