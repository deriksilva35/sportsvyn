/**
 * PlayerMatchLog — § Match Log row list.
 *
 * Renders the player's team's group-stage fixtures in the mock's
 * match-by-match shape. State per row is driven by matches.status:
 *
 *   scheduled → upcoming: date + stage chip + matchup + "Friday · 1pm PT · venue"
 *                          contribution slots empty, rating "TBD"
 *   live      → live:     scoreline shows the live numbers,
 *                          contribution still empty (no per-match player stats yet),
 *                          rating chip "LIVE"
 *   final     → final:    final scoreline, contribution slots empty until
 *                          player_match_stats lands, rating "—"
 *
 * Every populated row links its fixture cell to /match/{fixture.slug}.
 * Until player_match_stats rows exist, the per-match goal/assist boxes
 * and the rating stay dormant — explicit "—" placeholders, no fake values.
 */

import DormantSection from './DormantSection';

function fmtKickoff(kickoff_at) {
  if (!kickoff_at) return null;
  const d = new Date(kickoff_at);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'short', day: 'numeric',
  }).format(d);
}

function fmtKickoffLong(kickoff_at) {
  if (!kickoff_at) return null;
  const d = new Date(kickoff_at);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short', hour: 'numeric', minute: '2-digit',
  }).format(d).replace(',', ' ·');
}

function stageLabel(stage, group_code) {
  if (stage === 'group' && group_code) return `Group ${group_code}`;
  if (stage === 'group') return 'Group';
  if (!stage) return '';
  return stage.toUpperCase();
}

function Flag({ src }) {
  if (!src) return <span className="flag-mini" aria-hidden="true" />;
  return (
    <span
      className="flag-mini"
      role="img"
      aria-hidden="true"
      style={{ backgroundImage: `url(${src})` }}
    />
  );
}

function MatchRow({ fx, teamId }) {
  const isHome = fx.home_team_id === teamId;
  const isLive = fx.status === 'live';
  const isFinal = fx.status === 'final';
  const upcoming = !isLive && !isFinal;

  const scoreline =
    (fx.home_score != null && fx.away_score != null)
      ? `${fx.home_score}—${fx.away_score}`
      : 'vs';

  const kickoffSecondary = upcoming ? fmtKickoffLong(fx.kickoff_at) : null;
  const venueSecondary  = upcoming && fx.venue ? ` · ${fx.venue}` : '';

  return (
    <a
      key={fx.id}
      className={`mbm-row ${upcoming ? 'upcoming' : ''} ${isLive ? 'live' : ''}`}
      href={`/match/${fx.slug}`}
    >
      <span className="mbm-date">{fmtKickoff(fx.kickoff_at)}</span>
      <span className={`mbm-stage ${upcoming ? 'future' : ''}`}>
        {stageLabel(fx.stage, fx.group_code)}
      </span>
      <div className="mbm-match">
        <Flag src={fx.home_flag} />
        <span className="matchup">{fx.home_abbr ?? fx.home_name}</span>
        <span className={`scoreline ${upcoming ? 'pending' : ''}`}>{scoreline}</span>
        <span className="matchup">{fx.away_abbr ?? fx.away_name}</span>
        <Flag src={fx.away_flag} />
      </div>
      <div className="mbm-contribution">
        {upcoming ? (
          <span className="mbm-contribution-pending">
            {kickoffSecondary}{venueSecondary}
          </span>
        ) : (
          <>
            <div className="mbm-contribution-item">
              <span className="mbm-contribution-val zero">—</span>
              <span className="mbm-contribution-label">Goals</span>
            </div>
            <div className="mbm-contribution-item">
              <span className="mbm-contribution-val zero">—</span>
              <span className="mbm-contribution-label">Assists</span>
            </div>
          </>
        )}
      </div>
      <div>
        <div className="mbm-rating mbm-rating--placeholder">{isLive ? 'LIVE' : (isFinal ? '—' : 'TBD')}</div>
        <div className="mbm-rating-label">{isLive ? '' : 'Match rating'}</div>
      </div>
    </a>
  );
}

export default function PlayerMatchLog({ fixtures, teamId }) {
  if (!fixtures || fixtures.length === 0) {
    return <DormantSection message="The match log fills in as the team's group fixtures arrive." />;
  }
  return (
    <div className="match-by-match-list">
      {fixtures.map((fx) => (
        <MatchRow key={fx.id} fx={fx} teamId={teamId} />
      ))}
    </div>
  );
}
