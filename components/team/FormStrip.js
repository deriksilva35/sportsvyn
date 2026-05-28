/**
 * FormStrip — last N final matches as W/D/L chips, plus rolling splits.
 * Renders fewer than 5 chips if the team has played fewer; never fabricates.
 */

function resultFor(match, teamId) {
  if (match.home_score == null || match.away_score == null) return null;
  const isHome = match.home_team_id === teamId;
  const us = isHome ? match.home_score : match.away_score;
  const them = isHome ? match.away_score : match.home_score;
  if (us > them) return { code: 'w', label: `${us}-${them}` };
  if (us < them) return { code: 'l', label: `${us}-${them}` };
  return { code: 'd', label: `${us}-${them}` };
}

function ratingFor(results) {
  if (!results.length) return null;
  const w = results.filter((r) => r.code === 'w').length;
  const pct = w / results.length;
  if (pct >= 0.8) return 'Excellent';
  if (pct >= 0.6) return 'Strong';
  if (pct >= 0.4) return 'Mixed';
  if (pct > 0) return 'Soft';
  return 'Poor';
}

export default function FormStrip({ matches, teamId, stats }) {
  const finals = matches
    .filter((m) => m.status === 'final')
    .slice(-5)
    .map((m) => ({ match: m, result: resultFor(m, teamId) }))
    .filter((entry) => entry.result);

  if (!finals.length) return null;

  const splitsAvailable = !!stats;
  const rating = ratingFor(finals.map((f) => f.result));

  return (
    <section className="form-strip">
      <div className="form-strip-label">Last {finals.length}</div>
      <div className="form-chips">
        {finals.map(({ match, result }) => (
          <div key={match.id} className="form-chip-wrap">
            <div className={`form-chip ${result.code}`}>{result.code.toUpperCase()}</div>
            <span className="form-chip-label">{result.label}</span>
          </div>
        ))}
      </div>
      {splitsAvailable && (
        <div className="form-splits">
          <span><span className="split-val">{stats.goals_for}</span> GF</span>
          <span><span className="split-val">{stats.goals_against}</span> GA</span>
          {stats.xg != null && (
            <span><span className="split-val">{Number(stats.xg).toFixed(1)}</span> xG</span>
          )}
        </div>
      )}
      {rating && <div className="form-rating">{rating}</div>}
    </section>
  );
}
