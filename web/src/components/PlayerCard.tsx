import { formatInt, formatPP, formatSignedPercent } from '../lib/format'
import { profileUrl } from '../lib/links'
import type { SkillModel } from '../lib/recommend'
import type { PlayerProfile, SourceId } from '../lib/types'

interface Props {
  profile: PlayerProfile
  skill: SkillModel | null
  source: SourceId
  liveError?: string
  onClear: () => void
}

function strengths(skill: SkillModel): string | null {
  const ranked = [...skill.affinity].filter(([, v]) => Math.abs(v) >= 0.001).sort((a, b) => b[1] - a[1])
  if (!ranked.length) return null
  const describe = ([tag, value]: [string, number]) => `${formatSignedPercent(value)} on ${tag} maps`
  const picks = [...ranked.slice(0, 2).filter(([, v]) => v > 0), ...ranked.slice(-1).filter(([, v]) => v < 0)]
  return picks.length ? `Style: ${picks.map(describe).join(', ')} (accuracy; predictions account for it).` : null
}

export function PlayerCard({ profile, skill, source, liveError, onClear }: Props) {
  const link = profileUrl(source, profile.id)
  const style = skill ? strengths(skill) : null
  return (
    <section className="player" aria-label="Player">
      <div>
        <h2>
          {link ? <a href={link} target="_blank" rel="noreferrer">{profile.name}</a> : profile.name}
          <span className={`badge badge-${profile.origin}`}
            title={profile.origin === 'live' ? 'Fetched just now' : 'From the snapshot; recent plays may be missing'}>
            {profile.origin === 'live' ? 'live' : 'snapshot'}
          </span>
        </h2>
        <p>
          Rank {profile.rank ? `#${formatInt(profile.rank)}` : 'unranked'} · {formatPP(profile.pp, 0)} ·{' '}
          {profile.scores.length} ranked plays loaded
        </p>
        {skill ? (
          <p className="muted">
            {skill.sharedMaps >= 3
              ? `On ${skill.sharedMaps} of your maps you score ${formatSignedPercent(skill.offset, 2)} accuracy versus typical players at your rank on the same star ratings.`
              : 'Too few of your plays overlap these players to calibrate; predictions assume a typical player here.'}
            {style ? ` ${style}` : ''}
          </p>
        ) : null}
        {liveError ? <p className="muted">Live lookup unavailable ({liveError}); using the snapshot instead.</p> : null}
      </div>
      <button type="button" className="btn" onClick={onClear}>Clear</button>
    </section>
  )
}
