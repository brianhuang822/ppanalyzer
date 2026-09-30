import { describe, expect, it } from 'vitest'
import { difficultyLabel, formatPP } from './format'
import { beatSaverUrl, downloadUrl, leaderboardUrl, oneClickUrl, previewUrl, profileUrl } from './links'
import { buildPlaylist, playlistFileName } from './playlist'
import { gainFromPlay, weightedTotal } from './pp'
import { parseQuery } from './query'
import { fnv1a32, shardOf } from './shard'
import { makeMap } from '../test/fixtures'
import { DEFAULT_STATE, readState, writeState } from './urlState'

describe('fnv1a32', () => {
  it('matches the published vectors and the Python pipeline', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5)
    expect(fnv1a32('a')).toBe(0xe40c292c)
    expect(fnv1a32('foobar')).toBe(0xbf9cf968)
    expect(shardOf('76561198000000000', 256)).toBe(fnv1a32('76561198000000000') % 256)
  })
})

describe('pp math', () => {
  const decay = 0.965
  const naiveGain = (plays: number[], add: number, replace?: number) => {
    const next = [...plays]
    if (replace !== undefined) next.splice(next.indexOf(replace), 1)
    next.push(add)
    next.sort((a, b) => b - a)
    return weightedTotal(next, decay) - weightedTotal(plays, decay)
  }

  it('weights plays by decay^position', () => {
    expect(weightedTotal([100, 100], decay)).toBeCloseTo(196.5)
    expect(weightedTotal([], decay)).toBe(0)
  })

  it('adds a new play at its slot and pushes the rest down', () => {
    const plays = [400, 350, 300, 250, 200]
    for (const add of [500, 325, 100, 0.5]) {
      expect(gainFromPlay(plays, add, decay)).toBeCloseTo(naiveGain(plays, add), 9)
    }
    // A new top play gains its full value minus 3.5% of the old total.
    expect(gainFromPlay([100], 200, decay)).toBeCloseTo(200 - 100 + 100 * decay)
  })

  it('replaces an existing play only when it improves', () => {
    const plays = [400, 350, 300]
    expect(gainFromPlay(plays, 380, decay, 300)).toBeCloseTo(naiveGain(plays, 380, 300), 9)
    expect(gainFromPlay(plays, 290, decay, 300)).toBe(0)
    expect(gainFromPlay(plays, 0, decay)).toBe(0)
  })
})

describe('parseQuery', () => {
  it.each([
    ['5234', { kind: 'rank', rank: 5234 }],
    ['#1,234', { kind: 'rank', rank: 1234 }],
    ['  12 345 ', { kind: 'rank', rank: 12345 }],
    ['76561198012345678', { kind: 'player', id: '76561198012345678' }],
    ['https://scoresaber.com/u/76561198012345678?page=2', { kind: 'player', id: '76561198012345678', source: 'scoresaber' }],
    ['beatleader.com/u/1234567890123', { kind: 'player', id: '1234567890123', source: 'beatleader' }],
    ['Cerret', { kind: 'name', name: 'Cerret' }],
    ['', { kind: 'empty' }],
  ])('%s', (input, expected) => {
    expect(parseQuery(input)).toEqual(expected)
  })

  it('rejects rank 0, short names and other links', () => {
    expect(parseQuery('0').kind).toBe('invalid')
    expect(parseQuery('ab').kind).toBe('invalid')
    expect(parseQuery('https://example.com/x').kind).toBe('invalid')
  })
})

describe('links', () => {
  it('builds BeatSaver, one-click, zip, preview and leaderboard links', () => {
    const map = makeMap()
    expect(beatSaverUrl(map)).toBe('https://beatsaver.com/maps/2a1b')
    expect(oneClickUrl(map)).toBe('beatsaver://2a1b')
    expect(downloadUrl(map)).toBe('https://r2cdn.beatsaver.com/abcdef0123456789abcdef0123456789abcdef01.zip')
    expect(previewUrl(map)).toBe('https://allpoland.github.io/ArcViewer/?id=2a1b')
    expect(leaderboardUrl('scoresaber', map)).toBe('https://scoresaber.com/leaderboard/101')
    expect(leaderboardUrl('beatleader', makeMap({ id: 'abc91' }))).toBe('https://beatleader.com/leaderboard/global/abc91')
    expect(leaderboardUrl('sample', map)).toBeNull()
    expect(profileUrl('scoresaber', '7')).toBe('https://scoresaber.com/u/7')
  })

  it('degrades gracefully without a key or hash', () => {
    const map = makeMap({ key: null, hash: 'nothex', name: 'My Song', mapper: 'Bob' })
    expect(oneClickUrl(map)).toBeNull()
    expect(previewUrl(map)).toBeNull()
    expect(downloadUrl(map)).toBeNull()
    expect(beatSaverUrl(map)).toBe('https://beatsaver.com/?q=My%20Song%20Bob')
  })
})

describe('playlist', () => {
  it('groups difficulties of the same song and uses bplist names', () => {
    const playlist = buildPlaylist('PP Analyzer - me', 'desc', [
      makeMap({ id: '1', difficulty: 'ExpertPlus' }),
      makeMap({ id: '2', difficulty: 'Expert' }),
      makeMap({ id: '3', difficulty: 'ExpertPlus' }),
      makeMap({ id: '4', hash: 'ff'.repeat(20), key: null, name: 'Other', subName: '(Remix)', mode: 'OneSaber' }),
    ])
    expect(playlist.playlistAuthor).toBe('PP Analyzer')
    expect(playlist.songs).toHaveLength(2)
    expect(playlist.songs[0]).toEqual({
      key: '2a1b',
      hash: 'abcdef0123456789abcdef0123456789abcdef01',
      songName: 'Song',
      levelAuthorName: 'Mapper',
      difficulties: [{ characteristic: 'Standard', name: 'expertPlus' }, { characteristic: 'Standard', name: 'expert' }],
    })
    expect(playlist.songs[1]).not.toHaveProperty('key')
    expect(playlist.songs[1].songName).toBe('Other (Remix)')
    expect(playlist.songs[1].difficulties).toEqual([{ characteristic: 'OneSaber', name: 'expertPlus' }])
    expect(playlistFileName('PP Analyzer - Rank 5,000!')).toBe('pp-analyzer-rank-5-000.bplist')
  })
})

describe('url state', () => {
  it('round-trips and ignores junk', () => {
    const state = { ...DEFAULT_STATE, source: 'beatleader', q: '123', width: 250, mode: 'above' as const,
      sort: 'specific' as const, hidePlayed: false, minStars: 6, maxStars: 10.5 }
    expect(readState(writeState(state))).toEqual(state)
    expect(writeState(DEFAULT_STATE)).toBe('')
    expect(readState('?w=7&sort=nope&min=x')).toEqual(DEFAULT_STATE)
  })
})

describe('format', () => {
  it('labels difficulties and pp', () => {
    expect(difficultyLabel('ExpertPlus', 'Standard')).toBe('Expert+')
    expect(difficultyLabel('Hard', 'OneSaber')).toBe('Hard (OneSaber)')
    expect(formatPP(1234.56)).toBe('1,234.6pp')
  })
})
