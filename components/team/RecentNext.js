/**
 * RecentNext — two-card row showing the most recent final and the next
 * scheduled match. Hidden cleanly when neither exists.
 */

import Flag from './Flag';
import { stageDisplay } from './SportsvynOutlook';

const TZ = 'America/New_York';

function fmtDateShort(d) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: TZ })
    .format(new Date(d));
}

function fmtTime(d) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: TZ,
  }).format(new Date(d));
}

function MatchCard({ match, teamId, broadcasters, kind }) {
  const isHome = match.home_team_id === teamId;
  const usName = isHome ? match.home_short_name || match.home_name : match.away_short_name || match.away_name;
  const oppName = isHome ? match.away_short_name || match.away_name : match.home_short_name || match.home_name;
  const usAbbr = isHome ? match.home_abbreviation : match.away_abbreviation;
  const oppAbbr = isHome ? match.away_abbreviation : match.home_abbreviation;
  const oppColor = isHome ? match.away_flag_color : match.home_flag_color;
  const usColor = isHome ? match.home_flag_color : match.away_flag_color;

  const stage = stageDisplay(match.stage) ?? '—';
  const dateLabel = fmtDateShort(match.kickoff_at);

  if (kind === 'recent') {
    const usScore = isHome ? match.home_score : match.away_score;
    const themScore = isHome ? match.away_score : match.home_score;
    const resultCode = usScore > themScore ? 'win' : usScore < themScore ? 'loss' : 'draw';
    const resultLabel = resultCode === 'win' ? 'Win' : resultCode === 'loss' ? 'Loss' : 'Draw';
    return (
      <div className="match-card">
        <div className="match-card-header">
          <div className="match-card-kicker">Most Recent</div>
          <div className="match-card-meta">{dateLabel} · {stage}</div>
        </div>
        <div className="match-card-body">
          <div className="match-scoreline">
            <div className="match-team-block us">
              <Flag abbreviation={usAbbr} colorPrimary={usColor} variant="mini" />
              <span className="team-name">{usName}</span>
            </div>
            <div className="match-scoreline-center">
              <div className="match-score-display">
                <span className="us">{usScore}</span>
                <span className="sep">—</span>
                <span>{themScore}</span>
              </div>
              <div className={`match-result-tag ${resultCode !== 'win' ? resultCode : ''}`}>
                {resultLabel} · 90'
              </div>
            </div>
            <div className="match-team-block away">
              <span className="team-name">{oppName}</span>
              <Flag abbreviation={oppAbbr} colorPrimary={oppColor} variant="mini" />
            </div>
          </div>
        </div>
        <div className="match-card-footer">
          <a href="#" className="match-cta">Read the recap <span className="arrow">→</span></a>
        </div>
      </div>
    );
  }

  // kind === 'next'
  const timeLabel = fmtTime(match.kickoff_at);
  const primary = broadcasters?.find((b) => b.is_primary);
  const others = broadcasters?.filter((b) => !b.is_primary) ?? [];

  return (
    <div className="match-card">
      <div className="match-card-header">
        <div className="match-card-kicker next">Next Match · {stage}</div>
        <div className="match-card-meta">{dateLabel} · {timeLabel.split(', ')[0]}</div>
      </div>
      <div className="match-card-body">
        <div className="match-scoreline">
          <div className="match-team-block us">
            <Flag abbreviation={usAbbr} colorPrimary={usColor} variant="mini" />
            <span className="team-name">{usName}</span>
          </div>
          <div className="match-scoreline-center">
            <div className="match-time-display">
              {timeLabel}
              {match.venue && <div className="label">ET · {match.venue}</div>}
            </div>
          </div>
          <div className="match-team-block away">
            <span className="team-name">{oppName}</span>
            <Flag abbreviation={oppAbbr} colorPrimary={oppColor} variant="mini" />
          </div>
        </div>
      </div>
      <div className="match-card-footer">
        <a href="#" className="match-cta">See the preview <span className="arrow">→</span></a>
        {(primary || others.length > 0) && (
          <div className="match-watch-on">
            <span className="label">Watch</span>
            <span className="channels">
              {primary && <span className="primary">{primary.broadcaster_name}</span>}
              {others.map((b, i) => (
                <span key={b.broadcaster_name}>
                  {(primary || i > 0) && <span className="sep">·</span>}
                  {b.broadcaster_name}
                </span>
              ))}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function RecentNext({ teamId, recent, next, nextBroadcasters }) {
  if (!recent && !next) return null;

  return (
    <section className="page-section" id="matches">
      <div className="recent-next-row">
        {recent && <MatchCard match={recent} teamId={teamId} kind="recent" />}
        {next && <MatchCard match={next} teamId={teamId} broadcasters={nextBroadcasters} kind="next" />}
      </div>
    </section>
  );
}
