/**
 * SchedulePanel: server component.
 *
 * Compact list of upcoming followed fixtures. Intentionally NOT the
 * full ScheduleClient engine (no lens, no scrubber, no filters);
 * Phase 1 dashboard is a one-glance read.
 *
 * Row layout: date or kickoff label, flag + matchup with followed
 * names in volt, group letter pill. Click routes to /match/[slug].
 */

import FlagSlot from '@/components/FlagSlot';

const PT_TZ = 'America/Los_Angeles';

function fmtKickoffPt(iso) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: PT_TZ,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

function NameSpan({ team, followedSet }) {
  const followed = team?.id != null && followedSet?.has(team.id);
  return (
    <span className={followed ? 'team-name-followed' : undefined}>
      {team?.name ?? ''}
    </span>
  );
}

export default function SchedulePanel({ fixtures, followedSet }) {
  if (!fixtures || fixtures.length === 0) {
    return (
      <section className="panel panel-schedule">
        <h2 className="phead">Your Schedule</h2>
        <div className="pbody">
          <p className="sch-empty">No upcoming fixtures involving your follows.</p>
        </div>
      </section>
    );
  }
  return (
    <section className="panel panel-schedule">
      <h2 className="phead">Your Schedule</h2>
      <div className="pbody">
        <ul className="sch-list">
          {fixtures.map((f) => (
            <li key={f.id} className="sch-list-row">
              <a className="sch-list-link" href={`/match/${f.slug}`}>
                <span className="sch-list-when">{fmtKickoffPt(f.kickoff_at)}</span>
                <span className="sch-list-teams">
                  <FlagSlot
                    flagSvgPath={f.home?.flag_svg_path}
                    colorPrimary={f.home?.flag_color_primary}
                    size="sm"
                  />
                  <NameSpan team={f.home} followedSet={followedSet} />
                  <span className="sch-list-vs">v</span>
                  <FlagSlot
                    flagSvgPath={f.away?.flag_svg_path}
                    colorPrimary={f.away?.flag_color_primary}
                    size="sm"
                  />
                  <NameSpan team={f.away} followedSet={followedSet} />
                </span>
                {f.group_code && (
                  <span className="sch-list-group">Group {f.group_code}</span>
                )}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
