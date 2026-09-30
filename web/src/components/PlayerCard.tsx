import { formatInt, formatPP } from '../lib/format'
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

export function PlayerCard({ profile, skill, source, liveError, onClear }: Props) {
  const link = profileUrl(source, profile.id)
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
              ? `On the ${skill.sharedMaps} maps you share with these players you get ${skill.ppRatio.toFixed(2)}× their pp, so predictions are scaled by that.`
              : 'Too few maps in common with these players to calibrate; predictions use their average pp.'}
          </p>
        ) : null}
        {liveError ? <p className="muted">Live lookup unavailable ({liveError}); using the snapshot instead.</p> : null}
      </div>
      <button type="button" className="btn" onClick={onClear}>Clear</button>
    </section>
  )
}
