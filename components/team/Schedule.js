/**
 * Schedule — full ordered list of the team's matches across the tournament.
 * Each row: date, stage, matchup, result-or-time.
 */

import Flag from './Flag';
import { stageDisplay } from './SportsvynOutlook';

const TZ = 'America/New_York';

function fmtDate(d) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: TZ })
    .format(new Date(d));
}

function fmtTime(d) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: TZ,
  }).format(new Date(d));
}

function ScheduleRow({ match, teamId }) {
  const isHome = match.home_team_id === teamId;
  const usName = isHome ? match.home_short_name || match.home_name : match.away_short_name || match.away_name;
  const oppName = isHome ? match.away_short_name || match.away_name : match.home_short_name || match.home_name;
  const usAbbr = isHome ? match.home_abbreviation : match.away_abbreviation;
  const oppAbbr = isHome ? match.away_abbreviation : match.home_abbreviation;
  const usColor = isHome ? match.home_flag_color : match.away_flag_color;
  const oppColor = isHome ? match.away_flag_color : match.home_flag_color;

  const isFinal = match.status === 'final';
  const isUpcoming = match.status === 'scheduled';

  let resultEl;
  if (isFinal && match.home_score != null && match.away_score != null) {
    const us = isHome ? match.home_score : match.away_score;
    const them = isHome ? match.away_score : match.home_score;
    const code = us > them ? 'win' : us < them ? 'loss' : 'draw';
    resultEl = <span className={`schedule-result ${code}`}>{us}—{them}</span>;
  } else if (isUpcoming) {
    resultEl = <span className="schedule-result tbd">{fmtTime(match.kickoff_at)}</span>;
  } else {
    resultEl = <span className="schedule-result tbd">{match.status}</span>;
  }

  const stage = match.stage === 'group' && match.group_code
    ? `Group ${match.group_code}`
    : stageDisplay(match.stage) ?? '—';

  return (
    <div className={`schedule-row${isUpcoming ? ' upcoming' : ''}`}>
      <span className="schedule-date">{fmtDate(match.kickoff_at)}</span>
      <span className="schedule-stage">{stage}</span>
      <div className="schedule-matchup">
        <Flag abbreviation={usAbbr} colorPrimary={usColor} variant="mini" />
        <span className="team-label us">{usName}</span>
        <span className="vs">vs</span>
        <span className="team-label">{oppName}</span>
        <Flag abbreviation={oppAbbr} colorPrimary={oppColor} variant="mini" />
      </div>
      {resultEl}
    </div>
  );
}

export default function Schedule({ matches, teamId }) {
  if (!matches?.length) return null;
  return (
    <section className="page-section" id="schedule">
      <div className="section-head">
        <div className="section-head-left">
          <span className="section-head-num">§ Schedule</span>
          <h2 className="section-head-title">Full <span className="accent">Tournament</span></h2>
        </div>
      </div>
      <div className="schedule-list">
        {matches.map((m) => (
          <ScheduleRow key={m.id} match={m} teamId={teamId} />
        ))}
      </div>
    </section>
  );
}
