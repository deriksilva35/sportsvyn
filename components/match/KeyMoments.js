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
 *
 * Lifecycle scaffold (KICK-OFF / HALF-TIME / FULL TIME): synthesized
 * from match.status + the highest event minute. NOT passed through
 * from the API — derived here so they're never missing when the API
 * skips them. Rendered as quiet centered divider rows (mono caps,
 * muted) so they read as section breaks rather than event lines.
 *
 *   KICK-OFF   — present whenever the match has started (live | final).
 *                Anchors the feed at minute 0 so the LIVE tab is never
 *                a dead "no key moments yet" panel post-kickoff.
 *   HALF-TIME  — present when match.status='final' (definitely passed
 *                HT) OR when a live match has positive evidence of
 *                second-half play (an event at minute >= 46). The
 *                conservative read means a truly 0-0 live match at HT
 *                with zero events won't show the marker, but we never
 *                falsely claim HT has happened.
 *   FULL TIME  — present only when match.status='final', with the
 *                final score line ("3 — 2") as meta.
 *
 * Empty-state ("No key moments yet — events post during play.") only
 * shows when the lifecycle scaffold yields zero entries AND there are
 * zero events — i.e. pre-kickoff. Once status flips to live the
 * KICK-OFF anchor replaces the empty state.
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

// Synthesize lifecycle markers from match state. See header doc for the
// gating rules per marker. Returns rows in the same shape as event rows
// so they can be merged + sorted alongside them.
function buildLifecycleRows(match, events) {
  if (!match) return [];
  const isLive = match.status === 'live';
  const isFinal = match.status === 'final';
  if (!isLive && !isFinal) return [];

  const rows = [];

  // KICK-OFF — anchors the bottom of the newest-first feed.
  rows.push({
    kind: 'lifecycle',
    lifecycle: 'kickoff',
    label: 'KICK-OFF',
    meta: null,
    sortMinute: -1,
    sortExtra: 0,
  });

  // HALF-TIME — sort to appear newer than the latest 45+X stoppage event
  // (extra=MAX_SAFE_INTEGER) so the feed reads, top-to-bottom:
  //   ... 2H events ... HALF-TIME ... 45+X stoppage events ... 1H events ... KICK-OFF
  const reachedHalfTime =
    isFinal || (isLive && events.some((e) => (e.minute ?? 0) >= 46));
  if (reachedHalfTime) {
    rows.push({
      kind: 'lifecycle',
      lifecycle: 'halftime',
      label: 'HALF-TIME',
      meta: null,
      sortMinute: 45,
      sortExtra: Number.MAX_SAFE_INTEGER,
    });
  }

  // FULL TIME — only at final, sorts to top of the feed with the score
  // line as meta.
  if (isFinal) {
    const home = match.home_score ?? 0;
    const away = match.away_score ?? 0;
    rows.push({
      kind: 'lifecycle',
      lifecycle: 'fulltime',
      label: 'FULL TIME',
      meta: `${home} — ${away}`,
      sortMinute: Number.MAX_SAFE_INTEGER,
      sortExtra: 0,
    });
  }

  return rows;
}

function eventRowSortKey(e) {
  return {
    sortMinute: e.minute ?? 0,
    sortExtra: e.minute_extra ?? 0,
    sortId: e.id ?? 0,
  };
}

export default function KeyMoments({ events = [], match = null, homeAbbr, awayAbbr }) {
  const eventList = Array.isArray(events) ? events : [];
  const lifecycle = buildLifecycleRows(match, eventList);

  const rows = [
    ...eventList.map((e) => ({ kind: 'event', data: e, ...eventRowSortKey(e) })),
    ...lifecycle.map((l) => ({ ...l, data: l, sortId: 0 })),
  ];

  // Newest-first: minute DESC, extra DESC, id DESC. Lifecycle markers
  // get extreme sort minutes (-1 for kickoff, MAX for fulltime) and a
  // saturated extra for HT so they land at their intended positions.
  rows.sort((a, b) => {
    if (a.sortMinute !== b.sortMinute) return b.sortMinute - a.sortMinute;
    if (a.sortExtra !== b.sortExtra) return b.sortExtra - a.sortExtra;
    return b.sortId - a.sortId;
  });

  if (rows.length === 0) {
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
      {rows.map((r, i) => {
        if (r.kind === 'lifecycle') {
          return (
            <div
              key={`lifecycle-${r.lifecycle}`}
              className={`stream-entry lifecycle lifecycle-${r.lifecycle}`}
            >
              <div className="stream-lifecycle-row">
                <span className="stream-lifecycle-label">{r.label}</span>
                {r.meta && (
                  <>
                    <span className="stream-lifecycle-sep">·</span>
                    <span className="stream-lifecycle-meta">{r.meta}</span>
                  </>
                )}
              </div>
            </div>
          );
        }
        const e = r.data;
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
