/**
 * Write one auto-updating playlist per rank band for every source:
 *   <data>/<source>/playlists/rank-<lo>-<hi>.bplist   (customData.syncURL points back at itself)
 *   <data>/<source>/playlists/index.json
 * Players install a band once (bsplaylist:// one-click) and press Sync in-game each week.
 *
 * Usage: tsx scripts/build-playlists.ts --data public/data --site-url https://user.github.io/ppanalyzer/
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { buildPlaylist } from '../src/lib/playlist'
import { recommend } from '../src/lib/recommend'
import type { PlaylistBand } from '../src/lib/types'
import { readSources, SiteData } from './site'

export interface PlaylistOptions {
  bandSize: number
  songs: number
}

export function buildBandPlaylists(site: SiteData, source: string, siteUrl: string,
  options: PlaylistOptions = { bandSize: 1000, songs: 40 }): PlaylistBand[] {
  const { meta } = site
  const size = meta.bucketSize
  const perBand = Math.max(1, Math.round(options.bandSize / size))
  const outDir = join(site.dir, 'playlists')
  mkdirSync(outDir, { recursive: true })
  const base = siteUrl.replace(/\/?$/, '/')
  const bands: PlaylistBand[] = []
  for (let first = 0; first < meta.bucketCount; first += perBand) {
    const buckets = Array.from({ length: Math.min(perBand, meta.bucketCount - first) }, (_, i) => first + i)
    const stats = site.peers(buckets)
    if (!stats.players) continue
    const lo = first * size + 1
    const hi = Math.min((first + buckets.length) * size, meta.maxRank)
    const picks = recommend({ maps: site.maps, stats, meta, sort: 'climb' }).slice(0, options.songs)
    const file = `playlists/rank-${lo}-${hi}.bplist`
    const title = `PP Analyzer ${meta.label}: ranks ${lo.toLocaleString('en-US')}-${hi.toLocaleString('en-US')}`
    const description = `The ${picks.length} ranked maps expected to add the most pp for a typical player ranked `
      + `#${lo}-#${hi}, overweighted maps first in line. Rebuilt weekly from ${meta.label} data `
      + `(${meta.fetchedAt?.slice(0, 10) ?? 'latest'}); press Sync to update. ${base}`
    const playlist = buildPlaylist(title, description, picks.map((r) => r.map), `${base}data/${source}/${file}`)
    writeFileSync(join(site.dir, file), JSON.stringify(playlist, null, 2))
    bands.push({ lo, hi, file, title, songs: playlist.songs.length })
  }
  writeFileSync(join(outDir, 'index.json'), JSON.stringify({ bands }))
  return bands
}

function main(): void {
  const { values } = parseArgs({
    options: {
      data: { type: 'string', default: 'public/data' },
      'site-url': { type: 'string' },
      'band-size': { type: 'string', default: '1000' },
      songs: { type: 'string', default: '40' },
    },
  })
  const siteUrl = values['site-url'] ?? process.env.SITE_URL
  if (!siteUrl) throw new Error('--site-url (or SITE_URL) is required so playlists can sync from it')
  for (const source of readSources(values.data!)) {
    if (source.sample) {
      console.log(`skipping ${source.id}: sample data has no real maps`)
      continue
    }
    const site = new SiteData(join(values.data!, source.id))
    const bands = buildBandPlaylists(site, source.id, siteUrl, {
      bandSize: Number(values['band-size']), songs: Number(values.songs),
    })
    console.log(`${source.id}: ${bands.length} rank-band playlists`)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
