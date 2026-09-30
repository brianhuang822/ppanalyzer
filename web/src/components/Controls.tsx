import type { SortMode, WindowMode } from '../lib/recommend'
import { WIDTHS, type ViewState } from '../lib/urlState'

interface Props {
  state: ViewState
  sort: SortMode
  personal: boolean
  onChange: (patch: Partial<ViewState>) => void
}

const SORT_LABELS: Record<SortMode, string> = {
  gain: 'Expected pp gain',
  popular: 'Most played at my rank',
  specific: 'Most rank-specific',
  pp: 'Highest avg pp',
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

export function Controls({ state, sort, personal, onChange }: Props) {
  return (
    <fieldset className="controls">
      <legend className="visually-hidden">Options</legend>
      <label>
        Compare with
        <select value={state.mode} onChange={(e) => onChange({ mode: e.target.value as WindowMode })}>
          <option value="around">players around me</option>
          <option value="above">players just above me</option>
        </select>
      </label>
      <label>
        Range
        <select value={state.width} onChange={(e) => onChange({ width: Number(e.target.value) })}>
          {WIDTHS.map((w) => (
            <option key={w} value={w}>
              {state.mode === 'above' ? `${(2 * w).toLocaleString('en-US')} ranks` : `± ${w.toLocaleString('en-US')} ranks`}
            </option>
          ))}
        </select>
      </label>
      <label>
        Sort by
        <select value={sort} onChange={(e) => onChange({ sort: e.target.value as SortMode })}>
          {(Object.keys(SORT_LABELS) as SortMode[]).map((mode) => (
            <option key={mode} value={mode} disabled={mode === 'gain' && !personal}>
              {SORT_LABELS[mode]}
              {mode === 'gain' && !personal ? ' (enter your profile)' : ''}
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
      <label className="checkbox" title={personal ? undefined : 'Enter your profile to know what you played'}>
        <input type="checkbox" checked={state.hidePlayed} disabled={!personal}
          onChange={(e) => onChange({ hidePlayed: e.target.checked })} />
        Hide maps I've played
      </label>
    </fieldset>
  )
}
