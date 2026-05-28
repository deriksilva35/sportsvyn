/**
 * TeamStatsGrid — 2x3 stat tiles from team_tournament_stats. Each tile shows
 * the value, a derived per-match unit line, and a rank within the 32-team
 * league. The "Leader" tag is shown on rank=1.
 */

const TOURNAMENT_FIELD_SIZE = 32;

function fmtNum(v, decimals = 0) {
  if (v == null) return '—';
  return Number(v).toFixed(decimals);
}

function fmtSigned(v) {
  if (v == null) return '—';
  const n = Number(v);
  return n > 0 ? `+${n}` : `${n}`;
}

function Tile({ label, value, unit, rank, leader, fieldSize = TOURNAMENT_FIELD_SIZE }) {
  return (
    <div className="stat-tile">
      <div className="stat-tile-label">{label}</div>
      <div className="stat-tile-value-row">
        <span className="stat-tile-value">{value}</span>
        {unit && <span className="stat-tile-unit">{unit}</span>}
      </div>
      <div className="stat-tile-rank">
        <span className="rank-label">Rank</span>
        <span className="rank-val">{rank != null ? `#${rank}` : '—'}</span>
        <span className="rank-of">of {fieldSize}</span>
        {leader && <span className="leader-tag">▲ Leader</span>}
      </div>
    </div>
  );
}

export default function TeamStatsGrid({ stats }) {
  if (!stats) return null;

  const mp = stats.matches_played || null;
  const per = (total) => (mp && total != null ? (Number(total) / mp).toFixed(2) : null);

  return (
    <section className="page-section" id="stats">
      <div className="section-head">
        <div className="section-head-left">
          <span className="section-head-num">§ Team Stats</span>
          <h2 className="section-head-title">Tournament <span className="accent">to Date</span></h2>
        </div>
      </div>

      <div className="stats-grid">
        <Tile
          label="Goals For"
          value={fmtNum(stats.goals_for)}
          unit={mp ? `in ${mp} MP · ${per(stats.goals_for)}/match` : null}
          rank={stats.rank_goals_for}
          leader={stats.rank_goals_for === 1}
        />
        <Tile
          label="Goals Against"
          value={fmtNum(stats.goals_against)}
          unit={stats.clean_sheets != null ? `${stats.clean_sheets} clean sheets` : null}
          rank={stats.rank_goals_against}
          leader={stats.rank_goals_against === 1}
        />
        <Tile
          label="Goal Differential"
          value={fmtSigned(stats.goal_differential)}
          unit={stats.xgd != null ? `xGD ${fmtSigned(stats.xgd)}` : null}
          rank={stats.rank_goal_differential}
          leader={stats.rank_goal_differential === 1}
        />
        <Tile
          label="Expected Goals"
          value={fmtNum(stats.xg, 1)}
          unit={mp && stats.xg != null ? `${(Number(stats.xg) / mp).toFixed(2)} xG/match` : null}
          rank={stats.rank_xg}
          leader={stats.rank_xg === 1}
        />
        <Tile
          label="Expected GA"
          value={fmtNum(stats.xga, 1)}
          unit={mp && stats.xga != null ? `${(Number(stats.xga) / mp).toFixed(2)} xGA/match` : null}
          rank={stats.rank_xga}
          leader={stats.rank_xga === 1}
        />
        <Tile
          label="Possession"
          value={stats.possession_pct != null ? `${Number(stats.possession_pct).toFixed(0)}%` : '—'}
          unit={
            stats.pass_completion_pct != null
              ? `${Number(stats.pass_completion_pct).toFixed(0)}% pass completion`
              : null
          }
          rank={stats.rank_possession}
          leader={stats.rank_possession === 1}
        />
      </div>
    </section>
  );
}
