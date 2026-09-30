import type { SortMode, WindowMode } from './recommend'

/** Everything needed to reproduce a view; mirrored into the URL so results can be shared. */
export interface ViewState {
  source: string | null
  q: string
  width: number
  mode: WindowMode
  sort: SortMode | null
  hidePlayed: boolean
  minStars: number | null
  maxStars: number | null
}

export const WIDTHS = [100, 250, 500, 1000, 2500]
export const DEFAULT_STATE: ViewState = {
  source: null,
  q: '',
  width: 500,
  mode: 'around',
  sort: null,
  hidePlayed: true,
  minStars: null,
  maxStars: null,
}

const SORTS: SortMode[] = ['gain', 'popular', 'specific', 'pp']

function num(value: string | null): number | null {
  if (value === null || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function readState(search: string): ViewState {
  const params = new URLSearchParams(search)
  const width = num(params.get('w'))
  const sort = params.get('sort') as SortMode | null
  return {
    source: params.get('src'),
    q: params.get('q') ?? '',
    width: width && WIDTHS.includes(width) ? width : DEFAULT_STATE.width,
    mode: params.get('mode') === 'above' ? 'above' : 'around',
    sort: sort && SORTS.includes(sort) ? sort : null,
    hidePlayed: params.get('played') !== 'show',
    minStars: num(params.get('min')),
    maxStars: num(params.get('max')),
  }
}

export function writeState(state: ViewState): string {
  const params = new URLSearchParams()
  if (state.source) params.set('src', state.source)
  if (state.q) params.set('q', state.q)
  if (state.width !== DEFAULT_STATE.width) params.set('w', String(state.width))
  if (state.mode !== DEFAULT_STATE.mode) params.set('mode', state.mode)
  if (state.sort) params.set('sort', state.sort)
  if (!state.hidePlayed) params.set('played', 'show')
  if (state.minStars !== null) params.set('min', String(state.minStars))
  if (state.maxStars !== null) params.set('max', String(state.maxStars))
  const query = params.toString()
  return query ? `?${query}` : ''
}
