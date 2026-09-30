/**
 * Total pp is a weighted sum of a player's ranked plays, best first:
 *   total = sum_i pp_i * decay^i        (decay = 0.965 on ScoreSaber and BeatLeader)
 * so a new play is worth its own pp at its slot, minus the weight lost by every play it
 * pushes one position down.
 */

export function weightedTotal(sortedDesc: readonly number[], decay: number): number {
  let total = 0
  let weight = 1
  for (const pp of sortedDesc) {
    total += pp * weight
    weight *= decay
  }
  return total
}

/**
 * Total pp gained by setting a play worth `newPP`. If the map was already played for
 * `oldPP`, that play is replaced, so nothing is gained unless the new play is better.
 * `sortedDesc` is the player's current plays, best first.
 */
export function gainFromPlay(
  sortedDesc: readonly number[],
  newPP: number,
  decay: number,
  oldPP?: number,
  currentTotal = weightedTotal(sortedDesc, decay),
): number {
  if (!(newPP > 0)) return 0
  if (oldPP !== undefined && newPP <= oldPP) return 0
  const next = [...sortedDesc]
  if (oldPP !== undefined) {
    const at = next.indexOf(oldPP)
    if (at >= 0) next.splice(at, 1)
  }
  let slot = 0
  while (slot < next.length && next[slot] >= newPP) slot++
  next.splice(slot, 0, newPP)
  return weightedTotal(next, decay) - currentTotal
}
