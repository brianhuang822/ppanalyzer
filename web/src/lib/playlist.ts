import type { MapInfo } from './types'

/** A .bplist playlist, as read by PlaylistManager / BSManager / ModAssistant. */
export interface Playlist {
  playlistTitle: string
  playlistAuthor: string
  playlistDescription: string
  songs: {
    key?: string
    hash: string
    songName: string
    levelAuthorName: string
    difficulties: { characteristic: string; name: string }[]
  }[]
}

function lowerFirst(text: string): string {
  return text ? text[0].toLowerCase() + text.slice(1) : text
}

export function buildPlaylist(title: string, description: string, maps: MapInfo[]): Playlist {
  const songs = new Map<string, Playlist['songs'][number]>()
  for (const map of maps) {
    if (!map.hash) continue
    const hash = map.hash.toLowerCase()
    let song = songs.get(hash)
    if (!song) {
      song = {
        ...(map.key ? { key: map.key } : {}),
        hash,
        songName: map.subName ? `${map.name} ${map.subName}` : map.name,
        levelAuthorName: map.mapper,
        difficulties: [],
      }
      songs.set(hash, song)
    }
    const difficulty = { characteristic: map.mode || 'Standard', name: lowerFirst(map.difficulty) }
    if (!song.difficulties.some((d) => d.characteristic === difficulty.characteristic && d.name === difficulty.name)) {
      song.difficulties.push(difficulty)
    }
  }
  return {
    playlistTitle: title,
    playlistAuthor: 'PP Analyzer',
    playlistDescription: description,
    songs: [...songs.values()],
  }
}

export function playlistFileName(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `${slug || 'ppanalyzer'}.bplist`
}

export function downloadPlaylist(playlist: Playlist): void {
  const blob = new Blob([JSON.stringify(playlist, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = playlistFileName(playlist.playlistTitle)
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
