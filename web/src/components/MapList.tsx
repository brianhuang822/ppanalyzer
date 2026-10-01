import {
  difficultyLabel,
  formatDuration,
  formatInt,
  formatPercent,
  formatPP,
  formatSignedPercent,
} from '../lib/format'
import { beatSaverUrl, downloadUrl, leaderboardUrl, oneClickUrl, previewUrl } from '../lib/links'
import type { Recommendation, SortMode } from '../lib/recommend'
import type { SourceId } from '../lib/types'

interface Props {
  recs: Recommendation[]
  source: SourceId
  sort: SortMode
  personal: boolean
  recentDays: number
  /** Synthetic data: its hashes/keys are fake, so offer no install or download links. */
  sample?: boolean
}

/** Overweight below this is noise, not worth a badge. */
const OVERWEIGHT_BADGE = 0.03

function Cover({ url, name }: { url: string; name: string }) {
  if (!url) return <div className="cover cover-empty" aria-hidden="true">{name.slice(0, 1)}</div>
  return <img className="cover" src={url} alt="" loading="lazy" width={64} height={64} />
}

function Stat({ label, value, title, className }: { label: string; value: string; title?: string; className?: string }) {
  return (
    <div className={className} title={title}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

export function MapList({ recs, source, sort, personal, recentDays, sample = false }: Props) {
  return (
    <ol className="maps">
      {recs.map((rec, i) => {
        const { map } = rec
        const install = sample ? null : oneClickUrl(map)
        const zip = sample ? null : downloadUrl(map)
        const preview = sample ? null : previewUrl(map)
        const board = leaderboardUrl(source, map)
        const title = map.subName ? `${map.name} ${map.subName}` : map.name
        const length = formatDuration(map.duration)
        const who = personal ? "You'd get" : 'Typical here'
        return (
          <li className="map" key={map.id}>
            <span className="map-pos">{i + 1}</span>
            <Cover url={map.cover} name={map.name} />
            <div className="map-main">
              <a className="map-title" href={beatSaverUrl(map)} target="_blank" rel="noreferrer"
                title="Open on BeatSaver">
                {title}
              </a>
              <div className="map-by">
                {map.artist}
                {map.mapper ? <> · mapped by {map.mapper}</> : null}
              </div>
              <div className="map-tags">
                <span className={`diff diff-${map.difficulty}`}>{difficultyLabel(map.difficulty, map.mode)}</span>
                <span className="stars" title="Star rating">★ {map.stars.toFixed(2)}</span>
                {rec.overweightPct >= OVERWEIGHT_BADGE && rec.overweightPP >= 1 ? (
                  <span className="badge-ow" title="Players at this rank get this much more pp per play on it than on a typical map of the same star rating">
                    Overweighted +{formatInt(rec.overweightPP)}pp ({formatSignedPercent(rec.overweightPct, 0)})
                  </span>
                ) : null}
                {rec.recent >= 3 ? (
                  <span className="badge-hot" title={`Players in this range who set their score on it in the last ${recentDays} days`}>
                    🔥 {formatInt(rec.recent)} recent
                  </span>
                ) : null}
                {rec.newlyRanked ? <span className="badge-new" title={`Ranked in the last ${recentDays} days: few players have farmed it yet`}>Newly ranked</span> : null}
                {rec.mine ? <span className="tag-played">Played</span> : null}
                {length ? <span className="meta-chip" title="Song length">{length}</span> : null}
                {map.njs ? <span className="meta-chip" title="Note jump speed">{map.njs} NJS</span> : null}
                {map.tags.slice(0, 3).map((tag) => <span key={tag} className="meta-chip">{tag}</span>)}
                {map.mods.map((mod) => <span key={mod} className="badge-mod">Needs {mod}</span>)}
              </div>
            </div>
            <dl className="map-stats">
              <Stat label="Peers" value={`${formatPercent(rec.share, 0)} (${formatInt(rec.count)})`}
                title="Share of players in your range with this map among their ranked plays" />
              <Stat label="Their acc" value={formatPercent(rec.avgAcc)} title="Average accuracy of those players" />
              <Stat label={who} value={`~${formatPP(rec.predictedPP, 0)} @ ${formatPercent(rec.predictedAcc)}`}
                title="Predicted from typical accuracy at this star rating, the map's overweight and (with a profile) your skill and style" />
              {rec.mine ? <Stat label="Your best" value={`${formatPP(rec.mine.pp)} @ ${formatPercent(rec.mine.acc)}`} /> : null}
              <Stat className="gain" label={personal ? 'Your total' : 'Total'} value={`+${formatPP(rec.gain, 2)}`}
                title="Increase in total pp after the 0.965-per-position weighting" />
              {sort === 'perMinute' ? (
                <Stat className="gain" label="Per minute" value={`+${formatPP(rec.gainPerMinute, 2)}`}
                  title="Total pp gain per minute of song: shorter maps let you retry more" />
              ) : null}
            </dl>
            <div className="map-actions">
              {install ? (
                <a className="btn btn-primary" href={install}
                  title="One-click install (needs ModAssistant or BSManager with OneClick enabled)">
                  Install
                </a>
              ) : null}
              {zip ? (
                <a className="btn" href={zip} download title="Download the map as a .zip">.zip</a>
              ) : null}
              {preview ? (
                <a className="btn" href={preview} target="_blank" rel="noreferrer" title="3D preview in the browser">
                  Preview
                </a>
              ) : null}
              {board ? (
                <a className="btn" href={board} target="_blank" rel="noreferrer" title="Leaderboard">Scores</a>
              ) : null}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
