import type { PlayedFilter, SortMode, WindowMode } from '../lib/recommend'
import { SORTS, WIDTHS, type ViewState } from '../lib/urlState'

interface Props {
  state: ViewState
  personal: boolean
  tags: string[]
  onChange: (patch: Partial<ViewState>) => void
}

export const SORT_LABELS: Record<SortMode, string> = {
  climb: 'Fastest climb (pp gain)',
  perMinute: 'Fastest climb per minute',
  overweight: 'Most overweighted',
  trending: 'Being farmed now',
  popular: 'Most played at my rank',
}

const PLAYED_LABELS: Record<PlayedFilter, string> = {
  new: 'new to me',
  improve: "ones I've played and can improve",
  all: 'both',
}

/**
 * Uncontrolled on purpose: while someone types "7." a number input reports "", and a controlled
 * input would wipe it. Only complete values (or an empty box) are passed up.
 */
function StarsInput({ label, value, placeholder, onCommit }: {
  label: string
  value: number | null
  placeholder: string
  onCommit: (value: number | null) => void
}) {
  return (
    <input type="number" inputMode="decimal" min={0} max={20} step={0.5} placeholder={placeholder}
      aria-label={label} defaultValue={value ?? ''}
      onChange={(e) => {
        const text = e.target.value.trim()
        if (text === '' && !e.target.validity.badInput) onCommit(null)
        else if (text !== '' && Number.isFinite(Number(text))) onCommit(Number(text))
      }} />
  )
}

export function Controls({ state, personal, tags, onChange }: Props) {
  return (
    <fieldset className="controls">
      <legend className="visually-hidden">Options</legend>
      <label>
        Sort by
        <select aria-label="Sort by" value={state.sort} onChange={(e) => onChange({ sort: e.target.value as SortMode })}>
          {SORTS.map((mode) => <option key={mode} value={mode}>{SORT_LABELS[mode]}</option>)}
        </select>
      </label>
      <label title={personal ? undefined : 'Enter your profile to know what you played'}>
        Maps
        <select aria-label="Maps" value={personal ? state.played : 'all'} disabled={!personal}
          onChange={(e) => onChange({ played: e.target.value as PlayedFilter })}>
          {(Object.keys(PLAYED_LABELS) as PlayedFilter[]).map((p) => (
            <option key={p} value={p}>{PLAYED_LABELS[p]}</option>
          ))}
        </select>
      </label>
      <label>
        Compare with
        <select aria-label="Compare with" value={state.mode} onChange={(e) => onChange({ mode: e.target.value as WindowMode })}>
          <option value="around">players around me</option>
          <option value="above">players just above me</option>
        </select>
      </label>
      <label>
        Range
        <select aria-label="Range" value={state.width} onChange={(e) => onChange({ width: Number(e.target.value) })}>
          {WIDTHS.map((w) => (
            <option key={w} value={w}>
              {state.mode === 'above' ? `${(2 * w).toLocaleString('en-US')} ranks` : `± ${w.toLocaleString('en-US')} ranks`}
            </option>
          ))}
        </select>
      </label>
      <label className="stars-range">
        Stars
        <span>
          <StarsInput label="Minimum stars" placeholder="min" value={state.minStars}
            onCommit={(minStars) => onChange({ minStars })} />
          –
          <StarsInput label="Maximum stars" placeholder="max" value={state.maxStars}
            onCommit={(maxStars) => onChange({ maxStars })} />
        </span>
      </label>
      {tags.length ? (
        <label>
          Style
          <select aria-label="Style" value={state.tag ?? ''} onChange={(e) => onChange({ tag: e.target.value || null })}>
            <option value="">any</option>
            {tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
          </select>
        </label>
      ) : null}
    </fieldset>
  )
}
