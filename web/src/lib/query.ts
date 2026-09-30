import type { SourceId } from './types'

export type Query =
  | { kind: 'empty' }
  | { kind: 'rank'; rank: number }
  | { kind: 'player'; id: string; source?: SourceId }
  | { kind: 'name'; name: string }
  | { kind: 'invalid'; reason: string }

/** Player ids (Steam / Oculus / BeatLeader) are long numbers; ranks are short ones. */
const MIN_ID_DIGITS = 10

export function parseQuery(raw: string): Query {
  const text = raw.trim()
  if (!text) return { kind: 'empty' }

  const ss = text.match(/scoresaber\.com\/u\/(\d+)/i)
  if (ss) return { kind: 'player', id: ss[1], source: 'scoresaber' }
  const bl = text.match(/beatleader\.(?:com|xyz|net)\/u\/([A-Za-z0-9_-]+)/i)
  if (bl) return { kind: 'player', id: bl[1], source: 'beatleader' }
  if (/^https?:\/\//i.test(text)) {
    return { kind: 'invalid', reason: 'Paste a scoresaber.com/u/… or beatleader.com/u/… profile link.' }
  }

  // "#1,234", "1 234", "12.345" are all ranks.
  if (/^#?\s*\d[\d,.\s]*$/.test(text)) {
    const digits = text.replace(/\D/g, '')
    if (digits.length >= MIN_ID_DIGITS) return { kind: 'player', id: digits }
    const rank = Number.parseInt(digits, 10)
    if (!Number.isFinite(rank) || rank < 1) return { kind: 'invalid', reason: 'Ranks start at 1.' }
    return { kind: 'rank', rank }
  }

  if (text.length < 3) return { kind: 'invalid', reason: 'Player names need at least 3 characters.' }
  return { kind: 'name', name: text }
}
