/**
 * RecentNext — two-card row showing the most recent final and the next
 * scheduled match. Hidden cleanly when neither exists.
 */

import Flag from './Flag';
import { stageDisplay } from './SportsvynOutlook';
import LocalDate from '@/components/LocalDate';
import LocalTime from '@/components/LocalTime';

// Local-zone formatters (LocalDate / LocalTime client islands) replace
// the previous hardcoded-ET fmtDateShort + fmtTime. Date cells get
// visitor-zone date (no zone label); time cells get visitor-zone time
// WITH zone abbreviation. See components/LocalDate.js + LocalTime.js
// for the SSR-stable hydration pattern.

function MatchCard({ match, teamId, broadcasters, kind }) {
  const isHome = match.home_team_id === teamId;
  const usName = isHome ? match.home_short_name || match.home_name : match.away_short_name || match.away_name;
  const oppName = isHome ? match.away_short_name || match.away_name : match.home_short_name || match.home_name;
  const usAbbr = isHome ? match.home_abbreviation : match.away_abbreviation;
  const oppAbbr = isHome ? match.away_abbreviation : match.home_abbreviation;
  const oppColor = isHome ? match.away_flag_color : match.home_flag_color;
  const usColor = isHome ? match.home_flag_color : match.away_flag_color;

  const stage = stageDisplay(match.stage) ?? '—';

  if (kind === 'recent') {
    const usScore = isHome ? match.home_score : match.away_score;
    const themScore = isHome ? match.away_score : match.home_score;
    const resultCode = usScore > themScore ? 'win' : usScore < themScore ? 'loss' : 'draw';
    const resultLabel = resultCode === 'win' ? 'Win' : resultCode === 'loss' ? 'Loss' : 'Draw';
    return (
      <div className="match-card">
        <div className="match-card-header">
          <div className="match-card-kicker">Most Recent</div>
          <div className="match-card-meta">
            <LocalDate iso={match.kickoff_at} /> · {stage}
          </div>
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
  const primary = broadcasters?.find((b) => b.is_primary);
  const others = broadcasters?.filter((b) => !b.is_primary) ?? [];

  return (
    <div className="match-card">
      <div className="match-card-header">
        <div className="match-card-kicker next">Next Match · {stage}</div>
        {/* Meta line was "Jun 4 · Thu" — date + weekday duplicated.
            The full LocalTime below already carries the weekday in its
            output ("Thu, 7:00 PM PDT"), so the meta line just shows the
            date now. Cleaner, no duplication. */}
        <div className="match-card-meta">
          <LocalDate iso={match.kickoff_at} />
        </div>
      </div>
      <div className="match-card-body">
        <div className="match-scoreline">
          <div className="match-team-block us">
            <Flag abbreviation={usAbbr} colorPrimary={usColor} variant="mini" />
            <span className="team-name">{usName}</span>
          </div>
          <div className="match-scoreline-center">
            <div className="match-time-display">
              <LocalTime iso={match.kickoff_at} />
              {/* "ET · {venue}" prefix removed — LocalTime above now
                  carries the visitor's zone abbreviation, so the
                  hardcoded "ET" prefix was redundant + wrong for
                  non-ET visitors. Just the venue now. */}
              {match.venue && <div className="label">{match.venue}</div>}
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
