import type { MapInfo } from '../lib/types'

export function makeMap(overrides: Partial<MapInfo> = {}): MapInfo {
  return {
    index: 0,
    id: '101',
    hash: 'ABCDEF0123456789ABCDEF0123456789ABCDEF01',
    key: '2a1b',
    name: 'Song',
    subName: '',
    artist: 'Artist',
    mapper: 'Mapper',
    difficulty: 'ExpertPlus',
    mode: 'Standard',
    stars: 9.5,
    cover: '',
    globalCount: 10,
    globalWeight: 5,
    ...overrides,
  }
}
