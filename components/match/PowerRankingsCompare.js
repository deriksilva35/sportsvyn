/**
 * PowerRankingsCompare — full-width section, two pr-card columns.
 * Renders null when neither team has a ranking row, since the section's
 * purpose is comparison — half-empty doesn't read.
 */

export default function PowerRankingsCompare({ home = null, away = null }) {
  if (!home && !away) return null;

  return (
    <section className="section">
      <div className="section-header">
        <h2 className="section-title">
          Power Rankings <span className="accent">Comparison</span>
        </h2>
      </div>
      <div className="pr-comparison">
        <PrCard team={home} fallbackName="Home" />
        <PrCard team={away} fallbackName="Away" />
      </div>
    </section>
  );
}

function PrCard({ team, fallbackName }) {
  if (!team) {
    return (
      <div className="pr-card">
        <div className="pr-card-top">
          <div className="pr-card-kicker">Power Ranking</div>
          <div className="pr-card-team-row">
            <div className="pr-card-team-name">{fallbackName}</div>
          </div>
          <div className="slot-empty-body">No ranking yet for this side.</div>
        </div>
      </div>
    );
  }
  return (
    <div className="pr-card">
      <div className="pr-card-top">
        <div className="pr-card-kicker">Power Ranking · {team.edition_label ?? 'Current'}</div>
        <div className="pr-card-team-row">
          <div className="pr-card-team-name">{team.name}</div>
        </div>
        <div className="pr-card-score-row">
          <div className="pr-card-score">{Number(team.score).toFixed(1)}</div>
          <div className="pr-card-meta">
            <div className="pr-card-rank-chip">#{team.rank}</div>
            {team.tier && <div className="pr-card-tier">{team.tier}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
