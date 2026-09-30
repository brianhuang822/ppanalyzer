/** 32-bit FNV-1a over UTF-8 bytes; must match pipeline/ppanalyzer/build.py:fnv1a32. */
export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

export function shardOf(playerId: string, shardCount: number): number {
  return fnv1a32(playerId) % shardCount
}
