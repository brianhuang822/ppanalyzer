import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { clearDataCache } from './lib/data'
import { shardOf } from './lib/shard'

const PLAYER = '76561198000000001'
const SHARDS = 4

const files: Record<string, unknown> = {
  'sources.json': { sources: [{ id: 'scoresaber', label: 'ScoreSaber', sample: false, fetchedAt: '2026-09-28T00:00:00Z' }] },
  'scoresaber/meta.json': {
    source: 'scoresaber', label: 'ScoreSaber', realm: 'Main', sample: false, decay: 0.965, bucketSize: 100,
    bucketCount: 2, shardCount: SHARDS, playerCount: 200, mapCount: 3, minRank: 1, maxRank: 200,
    scoresPerPlayer: 100, fetchedAt: '2026-09-28T00:00:00Z', builtAt: '2026-09-28T01:00:00Z',
  },
  'scoresaber/maps.json': {
    fields: ['id', 'hash', 'key', 'name', 'subName', 'artist', 'mapper', 'difficulty', 'mode', 'stars', 'cover',
      'globalCount', 'globalWeight', 'ppScale', 'rankedAt', 'duration', 'tags', 'njs', 'nps', 'mods'],
    rows: [
      ['11', 'a'.repeat(40), '1a', 'Alpha', '', 'Artist A', 'Mapper A', 'ExpertPlus', 'Standard', 9.2, '', 150, 90,
        9.2, null, 200, ['tech'], 20, 6.1, []],
      // Bravo is overweighted: players here beat the accuracy its stars imply by ~1.2%.
      ['22', 'b'.repeat(40), '2b', 'Bravo', '', 'Artist B', 'Mapper B', 'Expert', 'Standard', 7.4, '', 90, 40,
        7.4, null, 150, ['accuracy'], 18, 5.2, []],
      ['33', 'c'.repeat(40), null, 'Charlie', '(Remix)', 'Artist C', 'Mapper C', 'Hard', 'Standard', 5.1, '', 60, 20,
        5.1, null, 180, [], 16, 4.0, []],
    ],
  },
  // rows: [map, count, weight, ppSum, accSum, residSum, recent]
  'scoresaber/buckets/0.json': {
    bucket: 0, players: 100, minRank: 1, maxRank: 100, fields: [],
    rows: [[0, 80, 50, 80 * 360, 80 * 0.94, 0, 2], [1, 50, 20, 50 * 350, 50 * 0.966, 50 * 0.012, 12],
      [2, 30, 10, 30 * 260, 30 * 0.97, 0, 0]],
    accCurve: [[5.25, 0.97, 50], [7.25, 0.955, 50], [9.25, 0.94, 50]],
    typical: [400, 380, 360, 340, 320, 300, 280, 260, 240, 220],
  },
  'scoresaber/buckets/1.json': {
    bucket: 1, players: 100, minRank: 101, maxRank: 200, fields: [],
    rows: [[0, 70, 40, 70 * 350, 70 * 0.94, 0, 1], [1, 40, 20, 40 * 340, 40 * 0.966, 40 * 0.012, 9],
      [2, 30, 10, 30 * 250, 30 * 0.97, 0, 0]],
    accCurve: [[5.25, 0.97, 50], [7.25, 0.955, 50], [9.25, 0.94, 50]],
    typical: [400, 380, 360, 340, 320, 300, 280, 260, 240, 220],
  },
  'scoresaber/playlists/index.json': {
    bands: [{ lo: 1, hi: 200, file: 'playlists/rank-1-200.bplist', title: 'Ranks 1-200', songs: 3 }],
  },
  'scoresaber/backtest.json': {
    before: '2026-09-21T00:00:00Z', after: '2026-09-28T00:00:00Z', players: 180, newPlays: 950,
    maeBaseline: 0.012, maeWithOverweight: 0.009, overweightCorrelation: 0.41,
    strategies: { climb: { players: 180, hits: 360, hitRate: 0.08, gainPerHit: 9.5 } },
  },
  [`scoresaber/players/${shardOf(PLAYER, SHARDS)}.json`]: {
    fields: ['map', 'pp', 'acc'],
    players: { [PLAYER]: { name: 'Snapshot Sam', country: 'US', rank: 150, pp: 4000, scores: [[0, 240, 0.94]] } },
  },
  'scoresaber/players/index.json': [[PLAYER, 'Snapshot Sam', 150], ['76561198000000002', 'Sammy', 160]],
}

type LiveMode = 'cors' | 'ok'
let live: LiveMode = 'cors'

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input)
  if (url.startsWith('https://scoresaber.com/api/v2/')) {
    if (live === 'cors') throw new TypeError('Failed to fetch')
    if (/\/scores(\?|$)/.test(url)) {
      return respond({ data: [
        { score: { pp: 260, accuracy: 95.1 }, leaderboard: { id: 22, realm: { leaderboardStatus: 'RANKED' } } },
        { score: { pp: 0, accuracy: 80 }, leaderboard: { id: 99 } },
      ] })
    }
    return respond({ id: PLAYER, name: 'Live Lou', stats: { rank: 120, totalPP: 4100 } })
  }
  const path = url.replace(/^.*\/data\//, '')
  return path in files ? respond(files[path]) : respond({ error: 'missing' }, 404)
})

beforeEach(() => {
  clearDataCache()
  live = 'cors'
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  window.history.replaceState(null, '', '/ppanalyzer/')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function search(text: string) {
  const user = userEvent.setup()
  render(<App />)
  await screen.findByText(/ScoreSaber snapshot from 2026-09-28/)
  await user.type(screen.getByLabelText(/Rank, profile link/), text)
  await user.click(screen.getByRole('button', { name: 'Find maps' }))
  return user
}

function mapTitles() {
  const list = screen.getByRole('region', { name: 'Recommended maps' })
  return within(list).getAllByRole('listitem').map((li) => within(li).getAllByRole('link')[0].textContent)
}

describe('App', () => {
  it('recommends maps for a rank with map, one-click and download links', async () => {
    const user = await search('150')
    await screen.findByText(/sorted by biggest pp gain \(gains shown for a typical player here/)
    expect(mapTitles()).toEqual(['Alpha', 'Bravo', 'Charlie (Remix)'])
    expect(within(screen.getByRole('link', { name: 'Bravo' }).closest('li')!).getByText(/Overweighted \+\d+pp \(\+\d+%\)/))
      .toBeInTheDocument()
    expect(within(screen.getByRole('link', { name: 'Alpha' }).closest('li')!).queryByText(/Overweighted/)).toBeNull()

    await user.selectOptions(screen.getByLabelText('Sort by'), 'overweight')
    await screen.findByText(/sorted by most overweighted/)
    expect(mapTitles()[0]).toBe('Bravo')
    await user.selectOptions(screen.getByLabelText('Sort by'), 'trending')
    await screen.findByText(/sorted by most set by these players in the last month/)
    expect(mapTitles()[0]).toBe('Bravo')
    expect(screen.getByText('🔥 21 recent')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Sort by'), 'climb')

    const alpha = screen.getByRole('link', { name: 'Alpha' })
    expect(alpha).toHaveAttribute('href', 'https://beatsaver.com/maps/1a')
    const row = alpha.closest('li')!
    expect(within(row).getByRole('link', { name: 'Install' })).toHaveAttribute('href', 'beatsaver://1a')
    expect(within(row).getByRole('link', { name: '.zip' })).toHaveAttribute(
      'href', `https://r2cdn.beatsaver.com/${'a'.repeat(40)}.zip`)
    expect(within(row).getByRole('link', { name: 'Scores' })).toHaveAttribute('href', 'https://scoresaber.com/leaderboard/11')
    // No BeatSaver key: no one-click, but the zip (by hash) still works.
    const charlie = screen.getByRole('link', { name: 'Charlie (Remix)' }).closest('li')!
    expect(within(charlie).queryByRole('link', { name: 'Install' })).toBeNull()
    expect(within(charlie).getByRole('link', { name: '.zip' })).toBeInTheDocument()

    expect(window.location.search).toBe('?q=150')
  })

  it('offers the auto-updating playlist for the rank band and shows last week\'s model check', async () => {
    await search('150')
    const install = await screen.findByRole('link', { name: 'Install playlist' })
    expect(install.getAttribute('href')).toMatch(/^bsplaylist:\/\/playlist\/https?:\/\/.+\/data\/scoresaber\/playlists\/rank-1-200\.bplist$/)
    expect(screen.getByText(/Does it work\? Last week's check/)).toBeInTheDocument()
    expect(screen.getByText(/1\.20% to 0\.90% \(25% better\)/)).toBeInTheDocument()
  })

  it('falls back to the snapshot when the live API is blocked, then ranks by pp gain', async () => {
    await search(PLAYER)
    expect(await screen.findByText('Snapshot Sam')).toBeInTheDocument()
    expect(screen.getByText('snapshot')).toBeInTheDocument()
    expect(screen.getByText(/Live lookup unavailable \(the browser could not reach the live API/)).toBeInTheDocument()
    await screen.findByText(/sorted by biggest pp gain\./)
    // Alpha is already played, so it is hidden by default ("new to me").
    expect(mapTitles()).toEqual(['Bravo', 'Charlie (Remix)'])
    expect(screen.getAllByText(/^\+\d/)[0]).toBeInTheDocument()
  })

  it('uses live data when the API is reachable', async () => {
    live = 'ok'
    const user = await search(PLAYER)
    expect(await screen.findByText('Live Lou')).toBeInTheDocument()
    expect(screen.getByText('live')).toBeInTheDocument()
    await screen.findByText(/sorted by biggest pp gain\./)
    expect(mapTitles()).toEqual(['Alpha', 'Charlie (Remix)']) // Bravo was played live

    await user.selectOptions(screen.getByLabelText('Maps'), 'improve')
    await waitFor(() => expect(mapTitles()).toEqual(['Bravo']))
    expect(screen.getByText('Played')).toBeInTheDocument()
    expect(screen.getByText(/260\.0pp @ 95\.1%/)).toBeInTheDocument()
  })

  it('finds players by name via the snapshot index', async () => {
    const user = await search('Sam')
    const pick = await screen.findByRole('button', { name: /Sammy/ })
    expect(screen.getByRole('button', { name: /Snapshot Sam/ })).toBeInTheDocument()
    await user.click(pick)
    expect(await screen.findByRole('alert')).toHaveTextContent(/isn't in the snapshot|Couldn't load player/)
  })

  it('explains invalid input and out-of-range ranks', async () => {
    const user = await search('ab')
    expect(await screen.findByRole('alert')).toHaveTextContent('at least 3 characters')
    await user.clear(screen.getByLabelText(/Rank, profile link/))
    await user.type(screen.getByLabelText(/Rank, profile link/), '999999')
    await user.click(screen.getByRole('button', { name: 'Find maps' }))
    expect(await screen.findByText(/outside this snapshot/)).toBeInTheDocument()
  })

  it('never offers install or download links for synthetic sample data', async () => {
    const meta = files['scoresaber/meta.json'] as { sample: boolean }
    meta.sample = true
    try {
      await search('150')
      await screen.findByText(/synthetic sample data/)
      await screen.findByText(/sorted by biggest pp gain/)
      expect(screen.queryByRole('link', { name: 'Install' })).toBeNull()
      expect(screen.queryByRole('link', { name: 'Install playlist' })).toBeNull()
      expect(screen.queryByRole('link', { name: '.zip' })).toBeNull()
    } finally {
      meta.sample = false
    }
  })

  it('exports the list as a .bplist playlist', async () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:playlist')
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const user = await search('150')
    await user.click(await screen.findByRole('button', { name: /Download playlist/ }))
    expect(click).toHaveBeenCalled()
    const playlist = JSON.parse(await createObjectURL.mock.calls[0][0].text())
    expect(playlist.playlistTitle).toBe('PP Analyzer - rank 150')
    expect(playlist.songs.map((s: { songName: string }) => s.songName)).toEqual(['Alpha', 'Bravo', 'Charlie (Remix)'])
    click.mockRestore()
  })
})
