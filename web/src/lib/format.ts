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
