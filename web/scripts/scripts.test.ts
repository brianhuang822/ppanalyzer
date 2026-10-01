import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runBacktest, pearson } from './backtest'
import { buildBandPlaylists } from './build-playlists'
import { SiteData } from './site'

/**
 * A tiny site: 2 buckets x 100 players. Map "farm" (8*) is overweighted: players beat the
 * accuracy its stars imply by 1.2%. Map "plain" (8*) is ordinary.
 */
function makeSite(root: string): string {
  const dir = join(root, 'site', 'scoresaber')
  mkdirSync(join(dir, 'buckets'), { recursive: true })
  const write = (path: string, data: unknown) => writeFileSync(join(dir, path), JSON.stringify(data))
  write('meta.json', {
    source: 'scoresaber', label: 'ScoreSaber', sample: false, decay: 0.965, bucketSize: 100, bucketCount: 2,
    shardCount: 1, playerCount: 200, mapCount: 3, minRank: 1, maxRank: 200, scoresPerPlayer: 300,
    recentDays: 30, fetchedAt: '2026-09-21T00:00:00Z', builtAt: '',
  })
  write('maps.json', {
    fields: ['id', 'hash', 'key', 'name', 'subName', 'artist', 'mapper', 'difficulty', 'mode', 'stars', 'cover',
      'globalCount', 'globalWeight', 'ppScale', 'rankedAt', 'duration', 'tags', 'njs', 'nps', 'mods'],
    rows: [
      ['plain', 'a'.repeat(40), '1a', 'Plain', '', 'A', 'M', 'ExpertPlus', 'Standard', 8, '', 100, 50, 8, null, 200, [],
        null, null, []],
      ['farm', 'b'.repeat(40), '2b', 'Farm', '', 'B', 'M', 'Expert', 'Standard', 8, '', 80, 40, 8, null, 120, [],
        null, null, []],
      ['easy', 'c'.repeat(40), '3c', 'Easy', '', 'C', 'M', 'Hard', 'Standard', 4, '', 90, 45, 4, null, 180, [],
        null, null, []],
    ],
  })
  for (const b of [0, 1]) {
    write(`buckets/${b}.json`, {
      bucket: b, players: 100, minRank: b * 100 + 1, maxRank: b * 100 + 100, fields: [],
      rows: [[0, 50, 25, 50 * 340, 50 * 0.95, 0, 1], [1, 40, 20, 40 * 380, 40 * 0.962, 40 * 0.012, 5],
        [2, 60, 30, 60 * 200, 60 * 0.97, 0, 0]],
      accCurve: [[4.25, 0.97, 60], [8.25, 0.95, 90]],
      typical: [420, 400, 380, 360, 340, 320, 300, 280],
    })
  }
  return dir
}

function writeRaw(dir: string, fetchedAt: string, players: object[]): string {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ fetchedAt }))
  writeFileSync(join(dir, 'players.jsonl'), players.map((p) => JSON.stringify(p)).join('\n') + '\n')
  return dir
}

describe('build-playlists', () => {
  it('writes one syncable playlist per rank band, overweighted maps first', () => {
    const root = mkdtempSync(join(tmpdir(), 'ppa-'))
    const site = new SiteData(makeSite(root))
    const bands = buildBandPlaylists(site, 'scoresaber', 'https://example.github.io/ppanalyzer', {
      bandSize: 100, songs: 10,
    })
    expect(bands.map((b) => [b.lo, b.hi, b.file])).toEqual([
      [1, 100, 'playlists/rank-1-100.bplist'], [101, 200, 'playlists/rank-101-200.bplist']])
    const playlist = JSON.parse(readFileSync(join(site.dir, bands[0].file), 'utf8'))
    expect(playlist.customData.syncURL)
      .toBe('https://example.github.io/ppanalyzer/data/scoresaber/playlists/rank-1-100.bplist')
    expect(playlist.songs[0].songName).toBe('Farm')
    expect(playlist.songs.length).toBeGreaterThan(0)
    const index = JSON.parse(readFileSync(join(site.dir, 'playlists', 'index.json'), 'utf8'))
    expect(index.bands).toHaveLength(2)
  })
})

describe('backtest', () => {
  it('rewards the overweight signal when players beat expectations on overweighted maps', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ppa-'))
    const site = makeSite(root)
    // 400 players who had played "plain" and "easy"; by next week each sets a score on "farm"
    // about 1.2% above what its stars imply, as the overweight predicts.
    const ids = Array.from({ length: 400 }, (_, i) => `7656119800000${String(i).padStart(4, '0')}`)
    const before = ids.map((id, i) => ({
      id, name: `P${i}`, rank: 1 + (i % 200), pp: 5000,
      scores: [['plain', 340, 0.95, 0], ['easy', 200, 0.97, 0], ['x', 150, 0.9, 0]],
    }))
    const after = before.map((p) => ({ ...p, scores: [['farm', 380, 0.962, 0], ...p.scores] }))
    const result = await runBacktest(site, writeRaw(join(root, 'before'), '2026-09-21T00:00:00Z', before),
      writeRaw(join(root, 'after'), '2026-09-28T00:00:00Z', after), { fraction: 1, width: 100, top: 25 })
    expect(result.players).toBe(400)
    expect(result.newPlays).toBe(400)
    expect(result.after).toBe('2026-09-28T00:00:00Z')
    expect(result.maeWithOverweight).toBeLessThan(result.maeBaseline)
    expect(result.strategies.climb.hitRate).toBeGreaterThan(0)
    expect(result.strategies.climb.gainPerHit).toBeGreaterThan(0)
  })

  it('computes Pearson correlation', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1)
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1)
    expect(pearson([1, 2], [1, 2])).toBe(0)
  })
})
