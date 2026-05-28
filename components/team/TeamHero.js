/**
 * TeamHero — flag + name + meta row on the left, Power Ranking block on the right.
 * Reads `team` (a getTeamBySlug row). All denormalized columns live on this row.
 */

import Flag from './Flag';

function coachShortName(name) {
  if (!name) return null;
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
}

function MovementChip({ movement }) {
  if (movement === null || movement === undefined || movement === 0) {
    return <span className="team-rank-mvmt flat">— Hold</span>;
  }
  if (movement > 0) {
    return <span className="team-rank-mvmt up">▲ Up {movement}</span>;
  }
  return <span className="team-rank-mvmt down">▼ Down {Math.abs(movement)}</span>;
}

export default function TeamHero({ team }) {
  return (
    <section className="team-hero">
      <div className="team-hero-left">
        <div className="team-flag-name-row">
          <Flag
            abbreviation={team.abbreviation}
            colorPrimary={team.flag_color_primary}
            variant="hero"
          />
          <h1 className="team-hero-name">{team.name}</h1>
        </div>
        <div className="team-meta-row">
          {team.confederation && (
            <span className="meta-item">
              <span className="meta-label">Conf</span>
              <span className="meta-value">{team.confederation}</span>
            </span>
          )}
          {team.group_code && (
            <span className="meta-item">
              <span className="meta-label">Group</span>
              <span className="meta-value">{team.group_code}</span>
            </span>
          )}
          {team.coach_name && (
            <span className="meta-item">
              <span className="meta-label">Coach</span>
              <span className="meta-value">{coachShortName(team.coach_name)}</span>
            </span>
          )}
          {team.fifa_rank != null && (
            <span className="meta-item">
              <span className="meta-label">FIFA</span>
              <span className="meta-value accent">#{team.fifa_rank}</span>
            </span>
          )}
          <span className="meta-item">
            <span className="meta-label">WC Record</span>
            <span>
              <span className="record-w">{team.tournament_wins}</span>–
              <span className="record-d">{team.tournament_draws}</span>–
              <span className="record-l">{team.tournament_losses}</span>
            </span>
          </span>
        </div>
      </div>

      {team.current_power_rank != null && (
        <div className="team-rank-block">
          <div className="team-rank-kicker">Sportsvyn Power Ranking</div>
          <div className="team-rank-num-row">
            <div className="team-rank-num">
              <span className="hash">#</span>
              {team.current_power_rank}
            </div>
            {team.current_power_score != null && (
              <div>
                <div className="team-rank-composite">{Number(team.current_power_score).toFixed(1)}</div>
                <div className="team-rank-composite-label">Composite</div>
              </div>
            )}
          </div>
          <div className="team-rank-mvmt-row">
            <MovementChip movement={team.current_rank_movement} />
          </div>
        </div>
      )}
    </section>
  );
}
