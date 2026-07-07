/**
 * WatchPanel: server component.
 *
 * Today's (PT-day) matches with their watch score, from getTodayWatchboard()
 * (peak live/final score, else the pre-match editorial prediction — so
 * scheduled matches still appear). Ordered score-desc. One line per match:
 * matchup (flags + ABBR v ABBR) / status-or-kickoff / watch-score value.
 * The score renders as a volt chip (.tn-watch) when a followed team is in the
 * match. Rest day -> a quiet "No matches today." line, never an empty box.
 */

import FlagSlot from '@/components/FlagSlot';

const PT_TZ = 'America/Los_Angeles';

function fmtKickoffPt(iso) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true, timeZone: PT_TZ,
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

function whenLabel(m) {
  const hs = m.home_score ?? 0;
  const as = m.away_score ?? 0;
  if (m.status === 'live') return `LIVE · ${hs}-${as}`;
  if (m.status === 'final') return `FT · ${hs}-${as}`;
  return fmtKickoffPt(m.kickoff_at);
}

export default function WatchPanel({ matches, followedSet }) {
  const rows = Array.isArray(matches) ? matches : [];

  if (rows.length === 0) {
    return (
      <section className="panel panel-watch">
        <h2 className="phead">Watch Scores</h2>
        <div className="pbody">
          <p className="wb-empty">No matches today.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel panel-watch">
      <h2 className="phead">Watch Scores</h2>
      <div className="pbody">
        {rows.map((m) => {
          const followedInMatch =
            (m.home_id != null && followedSet?.has(m.home_id)) ||
            (m.away_id != null && followedSet?.has(m.away_id));
          return (
            <a key={m.match_id} href={`/match/${m.slug}`} className="wb-row">
              <span className="wb-teams">
                <FlagSlot flagSvgPath={m.home_flag_svg} colorPrimary={m.home_flag_color} size="sm" />
                <span className={followedInMatch && followedSet?.has(m.home_id) ? 'team-name-followed' : undefined}>
                  {m.home_abbr}
                </span>
                <span className="wb-v">v</span>
                <FlagSlot flagSvgPath={m.away_flag_svg} colorPrimary={m.away_flag_color} size="sm" />
                <span className={followedInMatch && followedSet?.has(m.away_id) ? 'team-name-followed' : undefined}>
                  {m.away_abbr}
                </span>
              </span>
              <span className="wb-when">{whenLabel(m)}</span>
              <span className={`wb-score${followedInMatch ? ' tn-watch' : ''}`}>
                {m.watch_score != null ? Number(m.watch_score).toFixed(1) : '—'}
              </span>
            </a>
          );
        })}
      </div>
    </section>
  );
}
