import { dataUrl } from '../lib/data'
import { formatInt } from '../lib/format'
import type { PlaylistBand } from '../lib/types'

interface Props {
  source: string
  bands: PlaylistBand[]
  rank: number
}

/**
 * Static playlists per rank band, regenerated weekly. They carry a syncURL, so PlaylistManager
 * shows a Sync button in-game that pulls next week's list without visiting this site.
 */
export function SyncedPlaylist({ source, bands, rank }: Props) {
  const band = bands.find((b) => rank >= b.lo && rank <= b.hi) ?? (rank > (bands.at(-1)?.hi ?? 0) ? bands.at(-1) : undefined)
  if (!band) return null
  const url = dataUrl(`${source}/${band.file}`)
  return (
    <div className="playlist-sync">
      <span>
        <strong>Auto-updating playlist</strong> for ranks #{formatInt(band.lo)}–#{formatInt(band.hi)} ({band.songs} maps,
        refreshed weekly; press Sync in-game):
      </span>
      <a className="btn btn-primary" href={`bsplaylist://playlist/${url}`}
        title="One-click install (ModAssistant / BSManager with OneClick for playlists enabled)">
        Install playlist
      </a>
      <a className="btn" href={url} download>Download .bplist</a>
    </div>
  )
}
