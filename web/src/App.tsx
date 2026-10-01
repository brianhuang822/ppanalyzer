import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Controls } from './components/Controls'
import { MapList } from './components/MapList'
import { ModelCheck } from './components/ModelCheck'
import { PlayerCard } from './components/PlayerCard'
import { SyncedPlaylist } from './components/SyncedPlaylist'
import { loadBacktest, loadBuckets, loadMaps, loadMeta, loadPlaylistBands, loadSources } from './lib/data'
import { formatDate, formatInt, formatPercent } from './lib/format'
import { lookupPlayer, searchPlayers } from './lib/lookup'
import { buildPlaylist, downloadPlaylist } from './lib/playlist'
import { parseQuery } from './lib/query'
import {
  aggregate,
  fitSkill,
  peerWindow,
  recommend,
  type PeerStats,
  type PeerWindow,
  type SortMode,
} from './lib/recommend'
import type { Backtest, MapInfo, Meta, PlayerHit, PlayerProfile, PlaylistBand, SourceEntry } from './lib/types'
import { readState, writeState, type ViewState } from './lib/urlState'

const PAGE = 25

interface Dataset {
  source: string
  meta: Meta
  maps: MapInfo[]
  indexById: Map<string, number>
  /** Most common BeatSaver tags, for the style filter. */
  tags: string[]
  backtest: Backtest | null
  bands: PlaylistBand[]
}

type LookupOutcome =
  | { kind: 'player'; profile: PlayerProfile; liveError?: string }
  | { kind: 'hits'; hits: PlayerHit[] }
  | { kind: 'error'; message: string }

const SORT_TITLES: Record<SortMode, string> = {
  climb: 'biggest pp gain',
  perMinute: 'pp gain per minute of song',
  overweight: 'most overweighted for their star rating',
  trending: 'most set by these players in the last month',
  popular: 'most played at this rank',
}

function topTags(maps: MapInfo[], limit = 12): string[] {
  const counts = new Map<string, number>()
  for (const map of maps) for (const tag of map.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([tag]) => tag).sort()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default function App() {
  const [view, setView] = useState<ViewState>(() => readState(window.location.search))
  const [input, setInput] = useState(view.q)
  const [limit, setLimit] = useState(PAGE)
  const [sources, setSources] = useState<SourceEntry[] | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const [dataset, setDataset] = useState<Dataset | null>(null)
  const [lookup, setLookup] = useState<{ key: string; outcome: LookupOutcome } | null>(null)
  const [peers, setPeers] = useState<{ key: string; window: PeerWindow; stats: PeerStats } | null>(null)

  const query = useMemo(() => parseQuery(view.q), [view.q])
  const source = sources ? (sources.find((s) => s.id === view.source) ?? sources[0])?.id ?? null : null
  const ready = dataset !== null && dataset.source === source ? dataset : null

  useEffect(() => {
    window.history.replaceState(null, '', writeState(view) || window.location.pathname)
  }, [view])

  useEffect(() => {
    loadSources()
      .then((list) => (list.length ? setSources(list) : setFatal('No data has been published yet.')))
      .catch((error) => setFatal(errorMessage(error)))
  }, [])

  useEffect(() => {
    if (!source) return
    let cancelled = false
    Promise.all([loadMeta(source), loadMaps(source), loadBacktest(source), loadPlaylistBands(source)])
      .then(([meta, maps, backtest, bands]) => {
        if (cancelled) return
        setDataset({
          source, meta, maps, backtest, bands, tags: topTags(maps),
          indexById: new Map(maps.map((m) => [m.id, m.index])),
        })
      })
      .catch((error) => !cancelled && setFatal(errorMessage(error)))
    return () => {
      cancelled = true
    }
  }, [source])

  // Player lookups (by id or name). Results are keyed by their inputs, so "loading" is derived
  // from a key mismatch instead of being set synchronously here.
  const lookupKey = ready && (query.kind === 'player' || query.kind === 'name') ? `${ready.source}|${view.q}` : null
  useEffect(() => {
    if (!ready || !lookupKey || (query.kind !== 'player' && query.kind !== 'name')) return
    let cancelled = false
    const run = async (): Promise<LookupOutcome> => {
      if (query.kind === 'player') {
        const { profile, liveError } = await lookupPlayer(ready.source, ready.meta, ready.maps, query.id)
        return { kind: 'player', profile, liveError }
      }
      const { hits } = await searchPlayers(ready.source, query.name)
      const exact = hits.filter((h) => h.name.toLowerCase() === query.name.toLowerCase())
      if (exact.length === 1) {
        const { profile, liveError } = await lookupPlayer(ready.source, ready.meta, ready.maps, exact[0].id)
        return { kind: 'player', profile, liveError }
      }
      return { kind: 'hits', hits }
    }
    run()
      .then((outcome) => !cancelled && setLookup({ key: lookupKey, outcome }))
      .catch((error) => !cancelled && setLookup({ key: lookupKey, outcome: { kind: 'error', message: errorMessage(error) } }))
    return () => {
      cancelled = true
    }
  }, [ready, lookupKey, query])

  const outcome = lookup && lookup.key === lookupKey ? lookup.outcome : null
  const lookingUp = lookupKey !== null && outcome === null
  const profile = outcome?.kind === 'player' ? outcome.profile : null

  const rank = query.kind === 'rank' ? query.rank : profile ? profile.rank || ready?.meta.maxRank || null : null
  const peerRange = ready && rank ? peerWindow(ready.meta, rank, view.width, view.mode) : null
  const peersKey = peerRange && ready ? `${ready.source}|${peerRange.buckets.join(',')}|${peerRange.lo}|${peerRange.hi}` : null
  useEffect(() => {
    if (!ready || !peerRange || !peersKey) return
    let cancelled = false
    loadBuckets(ready.source, peerRange.buckets)
      .then((buckets) => !cancelled && setPeers({ key: peersKey, window: peerRange, stats: aggregate(buckets) }))
      .catch((error) => !cancelled && setFatal(errorMessage(error)))
    return () => {
      cancelled = true
    }
    // peerRange is recreated every render; peersKey captures everything it depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, peersKey])
  const currentPeers = peers && peers.key === peersKey ? peers : null

  const personal = profile !== null
  const sort = view.sort
  const skill = useMemo(
    () => (profile && currentPeers && ready ? fitSkill(profile, currentPeers.stats, ready.maps, ready.indexById) : null),
    [profile, currentPeers, ready],
  )
  const recs = useMemo(() => {
    if (!ready || !currentPeers) return []
    return recommend({
      maps: ready.maps,
      stats: currentPeers.stats,
      meta: ready.meta,
      sort,
      profile,
      skill,
      played: view.played,
      minStars: view.minStars,
      maxStars: view.maxStars,
      tag: view.tag,
    })
  }, [ready, currentPeers, sort, profile, skill, view.played, view.minStars, view.maxStars, view.tag])
  const visible = recs.slice(0, limit)

  const update = (patch: Partial<ViewState>) => {
    setView((v) => ({ ...v, ...patch }))
    setLimit(PAGE)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const parsed = parseQuery(input)
    const wanted = parsed.kind === 'player' ? parsed.source : undefined
    const switchTo = wanted && sources?.some((s) => s.id === wanted) ? wanted : undefined
    update({ q: input.trim(), ...(switchTo ? { source: switchTo } : {}) })
  }

  const exportPlaylist = () => {
    if (!ready || !currentPeers) return
    const who = profile ? profile.name : `rank ${formatInt(rank ?? 0)}`
    const title = `PP Analyzer - ${who}`
    const description = `${visible.length} ${ready.meta.label} maps (${SORT_TITLES[sort]}) from players ranked `
      + `#${formatInt(currentPeers.stats.minRank)}-#${formatInt(currentPeers.stats.maxRank)}. `
      + `Generated ${new Date().toISOString().slice(0, 10)} by https://brianhuang822.github.io/ppanalyzer/`
    downloadPlaylist(buildPlaylist(title, description, visible.map((r) => r.map)))
  }

  const meta = ready?.meta
  return (
    <div className="page">
      <header className="header">
        <div>
          <h1>PP Analyzer</h1>
          <p className="tagline">
            Find the ranked Beat Saber maps that give players at your rank more pp than their star rating suggests.
          </p>
        </div>
        {sources && sources.length > 1 ? (
          <nav className="sources" aria-label="Leaderboard">
            {sources.map((s) => (
              <button key={s.id} type="button" className={s.id === source ? 'tab tab-active' : 'tab'}
                aria-pressed={s.id === source} onClick={() => update({ source: s.id })}>
                {s.label}
              </button>
            ))}
          </nav>
        ) : null}
      </header>

      {meta?.sample ? (
        <p className="notice notice-warn" role="status">
          Showing <strong>synthetic sample data</strong>. Real ScoreSaber / BeatLeader data appears after the first
          scheduled data refresh runs.
        </p>
      ) : null}
      {fatal ? <p className="notice notice-error" role="alert">{fatal}</p> : null}

      <form className="search" onSubmit={submit} role="search">
        <label htmlFor="q" className="visually-hidden">Rank, profile link, player ID or name</label>
        <input id="q" value={input} onChange={(e) => setInput(e.target.value)} autoComplete="off"
          placeholder="Your rank (e.g. 5234), profile link, player ID or name" />
        <button type="submit" className="btn btn-primary">Find maps</button>
      </form>
      {meta ? (
        <p className="muted small">
          {meta.label} snapshot from {formatDate(meta.fetchedAt)} · {formatInt(meta.playerCount)} players ranked
          #{formatInt(meta.minRank)}–#{formatInt(meta.maxRank)} · {meta.medianPlays
            ? `median ${formatInt(meta.medianPlays)} ranked plays each`
            : `top ${meta.scoresPerPlayer ?? 100} plays each`}
          {meta.completeShare ? ` (every play for ${formatPercent(meta.completeShare, 0)} of players)` : ''}.
          Enter your profile to skip maps you've played and get predictions calibrated to you.
        </p>
      ) : null}

      {query.kind === 'invalid' ? <p className="notice notice-error" role="alert">{query.reason}</p> : null}
      {lookingUp ? <p className="muted" role="status">Looking up player…</p> : null}
      {outcome?.kind === 'error' ? <p className="notice notice-error" role="alert">{outcome.message}</p> : null}
      {outcome?.kind === 'hits' ? (
        <section className="hits" aria-label="Matching players">
          {outcome.hits.length ? (
            <>
              <p>Which player?</p>
              <ul>
                {outcome.hits.map((hit) => (
                  <li key={hit.id}>
                    <button type="button" className="btn" onClick={() => { setInput(hit.id); update({ q: hit.id }) }}>
                      {hit.name} <span className="muted">#{formatInt(hit.rank)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="notice">No players found with that name.</p>
          )}
        </section>
      ) : null}

      {profile && outcome?.kind === 'player' && source ? (
        <PlayerCard profile={profile} skill={skill} source={source} liveError={outcome.liveError}
          onClear={() => { setInput(''); update({ q: '' }) }} />
      ) : null}

      {rank && meta ? (
        <>
          <Controls state={view} personal={personal} tags={ready?.tags ?? []} onChange={update} />
          {peerRange?.clampedFrom ? (
            <p className="notice" role="status">
              Rank #{formatInt(peerRange.clampedFrom)} is outside this snapshot (#{formatInt(meta.minRank)}–
              #{formatInt(meta.maxRank)}), so these are the closest players available.
            </p>
          ) : null}
          {currentPeers ? (
            <section className="results" aria-label="Recommended maps">
              <div className="results-head">
                <p>
                  <strong>{formatInt(recs.length)}</strong> maps from {formatInt(currentPeers.stats.players)} players
                  ranked #{formatInt(currentPeers.stats.minRank)}–#{formatInt(currentPeers.stats.maxRank)}, sorted by{' '}
                  {SORT_TITLES[sort]}
                  {personal ? '' : ' (gains shown for a typical player here; enter your profile for yours)'}.
                </p>
                {visible.length ? (
                  <button type="button" className="btn" onClick={exportPlaylist}
                    title="Playlist for PlaylistManager / BSManager: drop it in Beat Saber/Playlists">
                    Download playlist (.bplist)
                  </button>
                ) : null}
              </div>
              {ready && source && !meta.sample ? (
                <SyncedPlaylist source={source} bands={ready.bands} rank={rank} />
              ) : null}
              {visible.length ? (
                <MapList recs={visible} source={source ?? ''} sort={sort} personal={personal}
                  recentDays={meta.recentDays ?? 30} sample={meta.sample} />
              ) : (
                <p className="notice">
                  {sort === 'climb' || sort === 'perMinute' || view.played === 'improve'
                    ? 'No map is predicted to raise your pp in this range. Try a wider range or "players just above me".'
                    : 'No maps match these filters.'}
                </p>
              )}
              {recs.length > visible.length ? (
                <button type="button" className="btn more" onClick={() => setLimit((l) => l + PAGE)}>
                  Show {Math.min(PAGE, recs.length - visible.length)} more
                </button>
              ) : null}
            </section>
          ) : (
            <p className="muted" role="status">Loading players near #{formatInt(rank)}…</p>
          )}
        </>
      ) : null}

      <details className="about">
        <summary>How does this work?</summary>
        <ul>
          <li>
            A weekly job pulls every ranked player's ranked plays from the {meta?.label ?? 'leaderboard'} API and groups
            players by rank.
          </li>
          <li>
            <strong>Overweighted</strong>: for each group the job learns the accuracy players there typically get at
            each star rating, and how each player compares with that. A map is overweighted when players do better on it
            than their skill and its star rating predict. Because pp rises steeply with accuracy, a small accuracy edge
            is a big pp edge, and the badge shows it in pp.
          </li>
          <li>
            <strong>Fastest climb</strong>: your predicted accuracy is the typical accuracy at the map's stars, plus your
            offset, plus the map's overweight, plus how you do on maps with the same style tags. That is turned into pp
            with the leaderboard's curve, and the gain is how much your <em>total</em> rises after the
            0.965-per-position weighting. Without a profile it uses a typical player at your rank.
          </li>
          <li>
            <strong>Being farmed now</strong>: maps players in your range set scores on in the last month.{' '}
            <strong>Per minute</strong> divides the gain by song length, since short maps allow more attempts.
          </li>
          <li>
            <strong>Install</strong> uses the <code>beatsaver://</code> one-click link (enable OneClick for BeatSaver in
            ModAssistant or BSManager). <strong>.zip</strong> downloads the map directly from BeatSaver.
          </li>
          <li>
            The edge is real only if it holds up, so each week the job checks last week's predictions against the
            scores players actually set (below, once two snapshots exist). Rating teams also reweight maps, so
            yesterday's farm map can stop paying.
          </li>
        </ul>
        {ready?.backtest ? <ModelCheck backtest={ready.backtest} /> : null}
      </details>

      <footer className="footer muted small">
        Data from <a href="https://scoresaber.com" target="_blank" rel="noreferrer">ScoreSaber</a>,{' '}
        <a href="https://beatleader.com" target="_blank" rel="noreferrer">BeatLeader</a> and{' '}
        <a href="https://beatsaver.com" target="_blank" rel="noreferrer">BeatSaver</a>. Not affiliated with any of them.{' '}
        <a href="https://github.com/brianhuang822/ppanalyzer" target="_blank" rel="noreferrer">Source on GitHub</a>.
      </footer>
    </div>
  )
}
