const DIFFICULTY_LABELS: Record<string, string> = {
  Easy: 'Easy',
  Normal: 'Normal',
  Hard: 'Hard',
  Expert: 'Expert',
  ExpertPlus: 'Expert+',
}

export function difficultyLabel(difficulty: string, mode: string): string {
  const label = DIFFICULTY_LABELS[difficulty] ?? difficulty
  return mode && mode !== 'Standard' ? `${label} (${mode})` : label
}

export function formatInt(value: number): string {
  return Math.round(value).toLocaleString('en-US')
}

export function formatPP(value: number, digits = 1): string {
  return `${value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}pp`
}

export function formatPercent(fraction: number, digits = 1): string {
  return `${(fraction * 100).toFixed(digits)}%`
}

export function formatDate(iso: string | null): string {
  if (!iso) return 'unknown date'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toISOString().slice(0, 10)
}

export function formatDuration(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) return null
  const total = Math.round(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** "+1.2%" / "-0.4%" for fractions such as 0.012. */
export function formatSignedPercent(fraction: number, digits = 1): string {
  const value = (fraction * 100).toFixed(digits)
  return fraction >= 0 ? `+${value}%` : `${value}%`
}
