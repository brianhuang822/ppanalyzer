/** Pure parsers for the files `ppanalyzer build` writes; shared by the app and the Node scripts. */
import type { Bucket, BucketRow, MapInfo, Table } from './types'

export function parseMaps(table: Table<unknown[]>): MapInfo[] {
  const at = (name: string) => table.fields.indexOf(name)
  const col = {
    id: at('id'), hash: at('hash'), key: at('key'), name: at('name'), subName: at('subName'),
    artist: at('artist'), mapper: at('mapper'), difficulty: at('difficulty'), mode: at('mode'),
    stars: at('stars'), cover: at('cover'), globalCount: at('globalCount'), globalWeight: at('globalWeight'),
    ppScale: at('ppScale'), rankedAt: at('rankedAt'), duration: at('duration'), tags: at('tags'),
    njs: at('njs'), nps: at('nps'), mods: at('mods'),
  }
  const get = (row: unknown[], i: number) => (i >= 0 ? row[i] : undefined)
  const num = (value: unknown) => (value === null || value === undefined ? null : Number(value))
  return table.rows.map((row, index) => ({
    index,
    id: String(get(row, col.id)),
    hash: String(get(row, col.hash) ?? ''),
    key: (get(row, col.key) as string | null) ?? null,
    name: String(get(row, col.name) ?? ''),
    subName: String(get(row, col.subName) ?? ''),
    artist: String(get(row, col.artist) ?? ''),
    mapper: String(get(row, col.mapper) ?? ''),
    difficulty: String(get(row, col.difficulty) ?? ''),
    mode: String(get(row, col.mode) ?? 'Standard'),
    stars: Number(get(row, col.stars) ?? 0),
    cover: String(get(row, col.cover) ?? ''),
    globalCount: Number(get(row, col.globalCount) ?? 0),
    globalWeight: Number(get(row, col.globalWeight) ?? 0),
    ppScale: num(get(row, col.ppScale)),
    rankedAt: num(get(row, col.rankedAt)),
    duration: num(get(row, col.duration)),
    tags: (get(row, col.tags) as string[] | undefined) ?? [],
    njs: num(get(row, col.njs)),
    nps: num(get(row, col.nps)),
    mods: (get(row, col.mods) as string[] | undefined) ?? [],
  }))
}

/** Older bucket files lack the residual / recent columns and curves; pad them. */
export function normalizeBucket(raw: Omit<Partial<Bucket>, 'rows'> & { rows: number[][] }): Bucket {
  return {
    bucket: raw.bucket ?? 0,
    players: raw.players ?? 0,
    minRank: raw.minRank ?? 0,
    maxRank: raw.maxRank ?? 0,
    fields: raw.fields ?? [],
    rows: raw.rows.map((r) => [r[0], r[1], r[2], r[3], r[4], r[5] ?? 0, r[6] ?? 0] as BucketRow),
    accCurve: raw.accCurve ?? [],
    typical: raw.typical ?? [],
  }
}
