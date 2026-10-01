import { formatDate, formatInt, formatPercent } from '../lib/format'
import type { Backtest } from '../lib/types'
import { SORT_LABELS } from './Controls'
import type { SortMode } from '../lib/recommend'

/** Last week's recommendations scored against what players actually did since. */
export function ModelCheck({ backtest }: { backtest: Backtest }) {
  const reduction = backtest.maeBaseline > 0 ? 1 - backtest.maeWithOverweight / backtest.maeBaseline : 0
  const strategies = Object.entries(backtest.strategies)
  return (
    <section className="model-check">
      <h3>Does it work? Last week's check</h3>
      <p>
        Between {formatDate(backtest.before)} and {formatDate(backtest.after)}, {formatInt(backtest.players)} players set{' '}
        {formatInt(backtest.newPlays)} new or improved scores. Adding each map's overweight to the prediction changed the
        accuracy error from {formatPercent(backtest.maeBaseline, 2)} to {formatPercent(backtest.maeWithOverweight, 2)}{' '}
        ({reduction >= 0 ? `${formatPercent(reduction, 0)} better` : `${formatPercent(-reduction, 0)} worse`}); last week's
        overweight correlated {backtest.overweightCorrelation.toFixed(2)} with how much better than expected players
        actually did.
      </p>
      {strategies.length ? (
        <>
        <p className="muted small">
          When players happened to play a map from each list, how much did it raise their total? Players never saw these
          lists, so this measures where pp came from rather than the effect of the advice.
        </p>
        <table>
          <thead>
            <tr><th>Sorted by</th><th>Total pp gained per map played</th><th>Maps played (of top 25)</th></tr>
          </thead>
          <tbody>
            {strategies.map(([name, s]) => (
              <tr key={name}>
                <td>{SORT_LABELS[name as SortMode] ?? name}</td>
                <td>{s.hits ? `+${s.gainPerHit.toFixed(1)}pp` : 'n/a'}</td>
                <td>{formatInt(s.hits)} ({formatPercent(s.hitRate)})</td>
              </tr>
            ))}
          </tbody>
        </table>
        </>
      ) : null}
    </section>
  )
}
