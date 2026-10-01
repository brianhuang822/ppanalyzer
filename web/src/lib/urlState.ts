import type { PlayedFilter, SortMode, WindowMode } from './recommend'

/** Everything needed to reproduce a view; mirrored into the URL so results can be shared. */
export interface ViewState {
  source: string | null
  q: string
  width: number
  mode: WindowMode
  sort: SortMode
  played: PlayedFilter
  minStars: number | null
  maxStars: number | null
  tag: string | null
}

export const WIDTHS = [100, 250, 500, 1000, 2500]
export const SORTS: SortMode[] = ['climb', 'perMinute', 'overweight', 'trending', 'popular']
const PLAYED: PlayedFilter[] = ['new', 'improve', 'all']

export const DEFAULT_STATE: ViewState = {
  source: null,
  q: '',
  width: 500,
  mode: 'around',
  sort: 'climb',
  played: 'new',
  minStars: null,
  maxStars: null,
  tag: null,
}

function num(value: string | null): number | null {
  if (value === null || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function readState(search: string): ViewState {
  const params = new URLSearchParams(search)
  const width = num(params.get('w'))
  const sort = params.get('sort') as SortMode | null
  const played = params.get('maps') as PlayedFilter | null
  return {
    source: params.get('src'),
    q: params.get('q') ?? '',
    width: width && WIDTHS.includes(width) ? width : DEFAULT_STATE.width,
    mode: params.get('mode') === 'above' ? 'above' : 'around',
    sort: sort && SORTS.includes(sort) ? sort : DEFAULT_STATE.sort,
    played: played && PLAYED.includes(played) ? played : DEFAULT_STATE.played,
    minStars: num(params.get('min')),
    maxStars: num(params.get('max')),
    tag: params.get('tag') || null,
  }
}

export function writeState(state: ViewState): string {
  const params = new URLSearchParams()
  if (state.source) params.set('src', state.source)
  if (state.q) params.set('q', state.q)
  if (state.width !== DEFAULT_STATE.width) params.set('w', String(state.width))
  if (state.mode !== DEFAULT_STATE.mode) params.set('mode', state.mode)
  if (state.sort !== DEFAULT_STATE.sort) params.set('sort', state.sort)
  if (state.played !== DEFAULT_STATE.played) params.set('maps', state.played)
  if (state.minStars !== null) params.set('min', String(state.minStars))
  if (state.maxStars !== null) params.set('max', String(state.maxStars))
  if (state.tag) params.set('tag', state.tag)
  const query = params.toString()
  return query ? `?${query}` : ''
}
