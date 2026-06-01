/**
 * KeyMoments — factual live event timeline for the LIVE tab panel.
 *
 * Reads from match_events (migration 022, written by the poll-live cron
 * via lib/events.js). Server component — receives the rows as a prop
 * from app/match/[slug]/page.js's Promise.all. Refresh cadence comes
 * from LiveHero.js calling router.refresh() after each successful
 * fetch tick, so new events written by the cron flow into the
 * server-rendered panel without a manual reload.
 *
 * Locked v4 mock pattern (.stream-entry.auto): minute column on the
 * left, content column on the right with a small uppercase tag +
 * one-line prose. NO editorial overlays (headlines, prose enrichment,
 * bylines) — that is ③b's territory. Strictly factual reads of the
 * row.
 *
 * VAR handling: events with event_type='Var' render as their own row
 * (tag VAR · {team_abbr}, prose "{player} goal disallowed"). The
 * disallowed goal itself never reaches this component because the
 * page-side query filters is_current=true, and a VAR-cancelled goal
 * is flipped to is_current=false by syncMatchEvents.
 *
 * Substitution direction (easy to flip — locked here): API-Sports's
 * subst events use player_name for the player going OFF and assist_name
 * for the player coming ON. Rendered as "{OFF} off · {IN} on".
 */

function formatMinute(e) {
  const m = e.minute ?? 0;
  if (e.minute_extra != null && e.minute_extra > 0) {
    return `${m}+${e.minute_extra}'`;
  }
  return `${m}'`;
}

// Clean-omits the team suffix when teamAbbr is missing (e.g. DEV's
// friendlies-league rows have NULL abbreviation; PROD's WC rows have
// 'USA' / 'SEN' etc populated). Avoids the trailing " · " ghost.
function tagWithTeam(base, teamAbbr) {
  return teamAbbr ? `${base} · ${teamAbbr}` : base;
}

function describe(e, homeAbbr, awayAbbr) {
  const teamAbbr = e.team_side === 'home' ? homeAbbr : awayAbbr;
  const player = e.player_name ?? '—';
  const assist = e.assist_name;

  if (e.event_type === 'Goal') {
    let prose;
    if (e.detail === 'Penalty')           prose = `${player} (penalty)`;
    else if (e.detail === 'Own Goal')     prose = `${player} (own goal)`;
    else if (e.detail === 'Missed Penalty') prose = `${player} — missed penalty`;
    else                                  prose = assist ? `${player} (${assist})` : player;
    const modifier = e.detail === 'Missed Penalty' ? 'CHANCE' : 'GOAL';
    return { tag: tagWithTeam('GOAL', teamAbbr), modifier, prose };
  }

  if (e.event_type === 'Card') {
    if (e.detail === 'Yellow Card') {
      return { tag: tagWithTeam('YELLOW', teamAbbr), modifier: 'YELLOW', prose: player };
    }
    if (e.detail === 'Red Card' || e.detail === 'Second Yellow card') {
      return { tag: tagWithTeam('RED', teamAbbr), modifier: 'RED', prose: player };
    }
    return { tag: tagWithTeam('CARD', teamAbbr), modifier: 'YELLOW', prose: `${player}${e.detail ? ' — ' + e.detail : ''}` };
  }

  if (e.event_type === 'subst') {
    // player = OFF, assist = IN (API-Sports convention; matches the v4
    // mock's "Boufal off · Cheddira on" prose).
    return {
      tag: tagWithTeam('SUB', teamAbbr),
      modifier: 'SUB',
      prose: assist ? `${player} off · ${assist} on` : `${player} off`,
    };
  }

  if (e.event_type === 'Var') {
    if (e.detail === 'Goal cancelled') {
      return { tag: tagWithTeam('VAR', teamAbbr), modifier: 'VAR', prose: `${player} goal disallowed` };
    }
    return { tag: tagWithTeam('VAR', teamAbbr), modifier: 'VAR', prose: `${player}${e.detail ? ' — ' + e.detail : ''}` };
  }

  // Forward-compat for unknown event_types — render a generic tag rather
  // than crash. event_type stays unconstrained at the schema level so a
  // new API-Sports type lands gracefully.
  return {
    tag: tagWithTeam('EVENT', teamAbbr),
    modifier: 'SUB',
    prose: `${player}${e.detail ? ' — ' + e.detail : ''}`,
  };
}

export default function KeyMoments({ events = [], homeAbbr, awayAbbr }) {
  if (!Array.isArray(events) || events.length === 0) {
    return <div className="tab-stub">No key moments yet — events post during play.</div>;
  }

  return (
    <div className="key-moments">
      <div className="commentary-header">
        <div className="commentary-header-title">
          Key <span className="accent">Moments</span> &amp; Events
        </div>
        <div className="commentary-header-meta">Latest first · Auto-updates</div>
      </div>
      {events.map((e, i) => {
        const { tag, modifier, prose } = describe(e, homeAbbr, awayAbbr);
        return (
          <div key={e.id ?? `${e.minute}-${e.minute_extra}-${i}`} className="stream-entry auto">
            <div className="stream-minute">{formatMinute(e)}</div>
            <div className="stream-body">
              <span className={`stream-event-tag ${modifier}`}>{tag}</span>
              <div className="stream-prose">{prose}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
