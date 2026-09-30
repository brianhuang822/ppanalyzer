import { difficultyLabel, formatInt, formatPercent, formatPP } from '../lib/format'
import { beatSaverUrl, downloadUrl, leaderboardUrl, oneClickUrl, previewUrl } from '../lib/links'
import type { Recommendation, SortMode } from '../lib/recommend'
import type { SourceId } from '../lib/types'

interface Props {
  recs: Recommendation[]
  source: SourceId
  sort: SortMode
  personal: boolean
  /** Synthetic data: its hashes/keys are fake, so offer no install or download links. */
  sample?: boolean
}

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

export function MapList({ recs, source, sort, personal, sample = false }: Props) {
  return (
    <ol className="maps">
      {recs.map((rec, i) => {
        const { map } = rec
        const install = sample ? null : oneClickUrl(map)
        const zip = sample ? null : downloadUrl(map)
        const preview = sample ? null : previewUrl(map)
        const board = leaderboardUrl(source, map)
        const title = map.subName ? `${map.name} ${map.subName}` : map.name
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
                {rec.mine ? <span className="tag-played">Played</span> : null}
              </div>
            </div>
            <dl className="map-stats">
              <Stat label="Peers" value={`${formatPercent(rec.share, 0)} (${formatInt(rec.count)})`}
                title="Share of players in your range with this map in their top plays" />
              <Stat label="Avg pp" value={formatPP(rec.avgPP)} title="Mean pp these players get on it" />
              <Stat label="Avg acc" value={formatPercent(rec.avgAcc)} />
              {sort === 'specific' || sort === 'popular' ? (
                <Stat label={sort === 'specific' ? 'Rank-specific' : 'Weighted'}
                  value={sort === 'specific' ? `${rec.lift.toFixed(1)}×` : rec.popularity.toFixed(2)}
                  title={sort === 'specific'
                    ? 'How much more common this map is at your rank than across all ranks'
                    : 'Appearances per player, weighted 0.965^position like pp'} />
              ) : null}
              {personal && rec.predictedPP !== undefined ? (
                <Stat label="You'd get" value={`~${formatPP(rec.predictedPP, 0)}`}
                  title={rec.predictedAcc ? `Predicted accuracy ${formatPercent(rec.predictedAcc)}` : undefined} />
              ) : null}
              {rec.mine ? <Stat label="Your best" value={formatPP(rec.mine.pp)} /> : null}
              {personal && rec.gain !== undefined ? (
                <Stat className="gain" label="Total gain" value={`+${formatPP(rec.gain, 2)}`}
                  title="Estimated increase in your total pp after the 0.965 weighting" />
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
