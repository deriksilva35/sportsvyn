/**
 * TopPlayers — three cards driven by composite_score DESC. Each card adapts
 * its stat row to the player's position (forwards/mid: G/A/G+A; keepers:
 * Saves/CS/Save%; defenders: Mins/Tackles fall-back when available, else
 * a generic Mins/G+A line).
 *
 * Photo treatment: photo_url_treated rendered as a background-image so a
 * failed/404 URL falls back to the gradient + silhouette without showing
 * a broken-image icon. Duotone filter is applied via .has-photo class.
 */

function POSITION_LABEL(pos) {
  const map = {
    GK: 'Goalkeeper',
    CB: 'Center Back', LB: 'Left Back', RB: 'Right Back',
    DM: 'Defensive Mid', CM: 'Midfielder', AM: 'Attacking Mid',
    LM: 'Left Mid', RM: 'Right Mid',
    LW: 'Left Wing', RW: 'Right Wing',
    CF: 'Forward', ST: 'Striker',
  };
  return pos ? map[pos] ?? pos : null;
}

function Silhouette() {
  return (
    <svg viewBox="0 0 64 80" xmlns="http://www.w3.org/2000/svg" fill="currentColor" aria-hidden="true">
      <circle cx="32" cy="26" r="13" />
      <path d="M 10 80 L 10 60 Q 10 46 32 46 Q 54 46 54 60 L 54 80 Z" />
    </svg>
  );
}

function PlayerPhoto({ photoUrl }) {
  if (photoUrl) {
    return (
      <div
        className="player-photo has-photo"
        style={{ backgroundImage: `url(${photoUrl})` }}
        aria-hidden="true"
      />
    );
  }
  return (
    <div className="player-photo">
      <Silhouette />
    </div>
  );
}

function StatBlock({ num, label }) {
  return (
    <div className="player-card-stat">
      <span className="stat-num">{num}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function fmt(v, decimals = 0) {
  if (v == null) return '—';
  return Number(v).toFixed(decimals);
}

function kickerForRank(rank, position) {
  if (position === 'GK') return 'Top Keepers';
  if (rank === 1) return 'Player of the Tournament';
  if (rank <= 5) return 'Top Composite';
  return 'Squad';
}

function StatRow({ player }) {
  if (player.position === 'GK') {
    return (
      <div className="player-card-stat-row">
        <StatBlock num={fmt(player.saves)} label="Saves" />
        <StatBlock num={fmt(player.clean_sheets)} label="Clean Sheets" />
        <StatBlock
          num={player.save_pct != null ? `${Number(player.save_pct).toFixed(0)}%` : '—'}
          label="Save %"
        />
      </div>
    );
  }
  return (
    <div className="player-card-stat-row">
      <StatBlock num={fmt(player.goals)} label="Goals" />
      <StatBlock num={fmt(player.assists)} label="Assists" />
      <StatBlock num={fmt(player.goal_contributions)} label="G+A" />
    </div>
  );
}

function PlayerCard({ player }) {
  const kicker = kickerForRank(player.rank_composite, player.position);
  const posLabel = POSITION_LABEL(player.position);
  // Whole card becomes the link when we have a slug — the previous
  // CTA-only "#" stub is replaced by a real destination at
  // /player/[slug]. Falls back to a plain div if the row somehow
  // lacks a slug (it shouldn't — getTopPlayers projects p.slug).
  const Wrapper = player.slug ? 'a' : 'div';
  const wrapperProps = player.slug
    ? { href: `/player/${player.slug}`, className: 'player-card player-card--link' }
    : { className: 'player-card' };
  return (
    <Wrapper {...wrapperProps}>
      <div className="player-card-header">
        <div className="player-card-kicker">{kicker}</div>
        {player.rank_composite != null && player.composite_score != null && (
          <span className="player-card-rank-badge">
            #{player.rank_composite} · {Number(player.composite_score).toFixed(1)}
          </span>
        )}
      </div>
      <div className="player-card-body">
        <PlayerPhoto photoUrl={player.photo_url_treated} />
        <div className="player-card-info">
          <h3 className="player-card-name">{player.full_name}</h3>
          <div className="player-card-pos">
            {posLabel}
            {player.age != null && ` · ${player.age}yo`}
          </div>
        </div>
        <StatRow player={player} />
      </div>
      <div className="player-card-footer">
        <span className="player-card-cta">Player page <span className="arrow">→</span></span>
      </div>
    </Wrapper>
  );
}

export default function TopPlayers({ players }) {
  if (!players?.length) return null;
  return (
    <section className="page-section" id="players">
      <div className="section-head">
        <div className="section-head-left">
          <span className="section-head-num">§ Squad</span>
          <h2 className="section-head-title">Top <span className="accent">Performers</span></h2>
        </div>
      </div>
      <div className="player-grid">
        {players.map((p) => (
          <PlayerCard key={p.id} player={p} />
        ))}
      </div>
    </section>
  );
}
