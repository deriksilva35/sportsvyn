/**
 * KeyMoments — Live tab event timeline with deterministic templated
 * headlines, mock-faithful icon boxes, and optional AI gloss sub-line.
 *
 * Ported from sportsvyn-match-live-tab-v1.html (.km-* class system).
 * Replaces the prior .stream-* row layout. Mock-style three-column row:
 * minute · icon-box · body (headline + optional gloss).
 *
 * HEADLINE LOGIC (deterministic, NO AI):
 *   - Goals: vocabulary picked from the score state BEFORE this goal.
 *     0-0 → "OPENS THE SCORING"; trailing→tied → "EQUALISES";
 *     tied→leading → "PUTS {TEAM} AHEAD" (or RESTORES if this side
 *     led earlier in the match); leading→leading-by-more → "DOUBLES"
 *     when the new margin is 2, else "EXTENDS".
 *   - Own goals: scorer name replaced with literal "OWN GOAL".
 *   - Missed penalties: "{PLAYER} MISSES THE PENALTY" (no score change).
 *   - Yellow: "{PLAYER} BOOKED" · Red / 2nd yellow: "{PLAYER} SENT OFF".
 *   - Subst: "{IN} ON FOR {OUT}" (API-Sports convention: player_name =
 *     OFF, assist_name = IN).
 *   - VAR: "VAR CHECK — {DETAIL}" (or "VAR CHECK" when detail empty).
 *
 * SCORE-STATE: derived by iterating events in chronological order. The
 * page-side query already filters is_current=true so VAR-cancelled
 * goals don't poison the running score. hasLed[side] tracks whether
 * this side has held the lead at any point earlier in the match —
 * powers the RESTORES headline.
 *
 * GLOSS RENDERING: the AI gloss (match_events.gloss column) renders as
 * an italic sub-line under the headline ONLY when non-empty. NULL
 * (pending pass) and '' (tried-empty sentinel) both render nothing —
 * no dangling em-dash, no empty prose line. Fixes the prod bug where
 * un-glossed rows showed a bare "—".
 *
 * LIFECYCLE SCAFFOLD: KICK-OFF / HALF-TIME / FULL TIME synthesized from
 * match.status + event minute reach. Same rules as before; render as
 * .km-divider with optional score meta on FULL TIME.
 */

function formatMinute(e) {
  const m = e.minute ?? 0;
  if (e.minute_extra != null && e.minute_extra > 0) {
    return `${m}+${e.minute_extra}'`;
  }
  return `${m}'`;
}

// ============================================================================
// HEADLINE DERIVATION
// ============================================================================

// Compute per-goal headline using the score state BEFORE the goal +
// whether each side has led at any point before this event. The split
// between "before" (used here) and "after" (caller updates) is what
// keeps the vocabulary correct on extends/restores — DOUBLES/EXTENDS
// reads "before this was a 1- or 2-goal lead; this goal added another."
function goalHeadline({ side, scorer, teamName, detail, before, after, hasLedBefore }) {
  const isOwnGoal = detail === 'Own Goal';
  // For own goals, the API-Sports payload puts team_side on the
  // BENEFITING team and player_name on the player who put it in (their
  // own net). Crediting that player by name reads wrong; replace with
  // the literal "OWN GOAL" prefix so the headline reads neutrally.
  const namePart = isOwnGoal
    ? 'OWN GOAL'
    : (scorer && scorer.length > 0 ? scorer.toUpperCase() : null);

  const scoringSide = side; // 'home' | 'away'
  const otherSide = scoringSide === 'home' ? 'away' : 'home';

  const beforeScoring = before[scoringSide];
  const beforeOther   = before[otherSide];
  const afterScoring  = after[scoringSide];
  const afterOther    = after[otherSide];

  const wasZeroZero   = beforeScoring === 0 && beforeOther === 0;
  const wasTied       = beforeScoring === beforeOther;
  const wasLeading    = beforeScoring > beforeOther;
  const wasTrailing   = beforeScoring < beforeOther;
  const nowTied       = afterScoring === afterOther;
  const nowLeading    = afterScoring > afterOther;
  const margin        = afterScoring - afterOther;

  let template;
  if (wasZeroZero) {
    template = 'OPENS THE SCORING';
  } else if (wasTrailing && nowTied) {
    template = 'EQUALISES';
  } else if (wasTied && nowLeading) {
    template = hasLedBefore[scoringSide] ? `RESTORES THE LEAD` : `PUTS ${teamName} AHEAD`;
  } else if (wasLeading && nowLeading) {
    // Same side extending an existing lead.
    template = margin === 2 ? 'DOUBLES THE LEAD' : 'EXTENDS THE LEAD';
  } else if (wasTrailing && afterScoring < afterOther) {
    // Trailing team scores but still trails — the other side leads by 1+.
    // Standard football vocab: "pulls one back". Sits above the generic
    // fallback so this common pattern reads correctly instead of as
    // "MAKES IT 2-1".
    template = 'PULLS ONE BACK';
  } else {
    // True fallback — anything not matching the seven cases above.
    // Always honest: literal score change.
    template = `MAKES IT ${after.home}-${after.away}`;
  }

  // namePart prepended only when we have a real name. Own goals get
  // "OWN GOAL" prefix; missing scorer falls back to bare template.
  return namePart ? `${namePart} ${template}` : template;
}

// Non-goal event vocabulary. Pure: receives the row + team labels,
// returns { kind, headline }. kind drives the icon-box class.
function describeNonGoal(e) {
  const player = e.player_name && e.player_name.length > 0 ? e.player_name.toUpperCase() : null;
  const assist = e.assist_name && e.assist_name.length > 0 ? e.assist_name.toUpperCase() : null;

  if (e.event_type === 'Card') {
    if (e.detail === 'Yellow Card') {
      return { kind: 'yellow', headline: player ? `${player} BOOKED` : 'BOOKING' };
    }
    if (e.detail === 'Red Card' || e.detail === 'Second Yellow card') {
      return { kind: 'red', headline: player ? `${player} SENT OFF` : 'RED CARD' };
    }
    return { kind: 'yellow', headline: player ? `${player} — ${(e.detail ?? 'CARD').toUpperCase()}` : (e.detail ?? 'CARD').toUpperCase() };
  }

  if (e.event_type === 'subst') {
    // API convention: player_name = OFF, assist_name = IN.
    if (assist && player) return { kind: 'sub', headline: `${assist} ON FOR ${player}` };
    if (player)           return { kind: 'sub', headline: `${player} SUBSTITUTED OFF` };
    return { kind: 'sub', headline: 'SUBSTITUTION' };
  }

  if (e.event_type === 'Var') {
    const outcome = e.detail ? e.detail.toUpperCase() : null;
    return { kind: 'var', headline: outcome ? `VAR CHECK — ${outcome}` : 'VAR CHECK' };
  }

  // Forward-compat: an unknown event_type lands gracefully with a
  // neutral icon. Headline reads the data we have.
  return { kind: 'sub', headline: player ? `${player} — ${(e.event_type ?? 'EVENT').toUpperCase()}` : (e.event_type ?? 'EVENT').toUpperCase() };
}

// Single pass over events (chronological) to derive per-event headlines.
// Returns a Map<event_id, { kind, headline }>. Score state is mutated
// in-step; hasLed transitions on the AFTER state of each goal so a
// "restores the lead" goal can use the post-state's leader to decide
// whether the scoring side has led before.
export function deriveHeadlines(events, { homeName, awayName }) {
  const headlines = new Map();
  const state = {
    home: 0,
    away: 0,
    hasLed: { home: false, away: false },
  };

  const chronological = events
    .slice()
    .sort((a, b) => {
      const am = a.minute ?? 0, bm = b.minute ?? 0;
      if (am !== bm) return am - bm;
      const ae = a.minute_extra ?? 0, be = b.minute_extra ?? 0;
      if (ae !== be) return ae - be;
      return (a.id ?? 0) - (b.id ?? 0);
    });

  for (const e of chronological) {
    if (e.event_type === 'Goal' && e.detail !== 'Missed Penalty') {
      const side = e.team_side === 'home' ? 'home' : 'away';
      const before = { home: state.home, away: state.away };
      // hasLedBefore is a SNAPSHOT — read before mutating, used by the
      // headline picker; we update hasLed after the headline is locked
      // so the current goal doesn't self-disqualify a RESTORES read.
      const hasLedBefore = { home: state.hasLed.home, away: state.hasLed.away };
      state[side] += 1;
      const after = { home: state.home, away: state.away };

      const teamName = side === 'home' ? (homeName ?? 'HOME') : (awayName ?? 'AWAY');
      const headline = goalHeadline({
        side,
        scorer: e.player_name,
        teamName: teamName.toUpperCase(),
        detail: e.detail,
        before,
        after,
        hasLedBefore,
      });

      // Update hasLed based on the AFTER state for downstream events.
      if (after.home > after.away) state.hasLed.home = true;
      if (after.away > after.home) state.hasLed.away = true;

      headlines.set(e.id, {
        kind: 'goal',
        headline,
        side,
        scorer: e.player_name ?? null,
      });
      continue;
    }

    if (e.event_type === 'Goal' && e.detail === 'Missed Penalty') {
      const player = e.player_name && e.player_name.length > 0 ? e.player_name.toUpperCase() : null;
      headlines.set(e.id, {
        kind: 'missed',
        headline: player ? `${player} MISSES THE PENALTY` : 'PENALTY MISSED',
      });
      continue;
    }

    const { kind, headline } = describeNonGoal(e);
    headlines.set(e.id, { kind, headline });
  }

  return headlines;
}

// ============================================================================
// ICON BOXES — SVGs ported verbatim from the mock
// ============================================================================

function KmIcon({ kind }) {
  switch (kind) {
    case 'goal':
      return (
        <span className="km-icon goal">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="9"/>
            <path d="M12 3v4M12 17v4M3 12h4M17 12h4"/>
            <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none"/>
          </svg>
        </span>
      );
    case 'yellow':
      return (
        <span className="km-icon yellow">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <rect x="6" y="3" width="12" height="18" rx="1.5"/>
          </svg>
        </span>
      );
    case 'red':
      return (
        <span className="km-icon red">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <rect x="6" y="3" width="12" height="18" rx="1.5"/>
          </svg>
        </span>
      );
    case 'sub':
      return (
        <span className="km-icon sub">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M7 7l-4 4 4 4M3 11h10"/>
            <path d="M17 17l4-4-4-4M21 13H11"/>
          </svg>
        </span>
      );
    case 'var':
      return (
        <span className="km-icon var">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="3" y="6" width="18" height="12" rx="1.5"/>
            <path d="M9 9l3 3 3-3"/>
          </svg>
        </span>
      );
    case 'missed':
      // Off-target / missed-chance feel: same circle as goal but desaturated
      // via .km-icon.missed CSS class.
      return (
        <span className="km-icon missed">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="9"/>
            <path d="M8 8l8 8M16 8l-8 8"/>
          </svg>
        </span>
      );
    default:
      return (
        <span className="km-icon sub" aria-hidden="true" />
      );
  }
}

// ============================================================================
// LIFECYCLE ROWS
// ============================================================================

function buildLifecycleRows(match, events) {
  if (!match) return [];
  const isLive = match.status === 'live';
  const isFinal = match.status === 'final';
  if (!isLive && !isFinal) return [];

  const rows = [];

  rows.push({
    kind: 'lifecycle',
    lifecycle: 'kickoff',
    label: 'KICK-OFF',
    meta: null,
    sortMinute: -1,
    sortExtra: 0,
  });

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

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function KeyMoments({ events = [], match = null, homeAbbr, awayAbbr, homeName, awayName }) {
  const eventList = Array.isArray(events) ? events : [];
  const lifecycle = buildLifecycleRows(match, eventList);

  // Pass team names (full or abbr fallback) to the headline derivation
  // for "PUTS {TEAM} AHEAD". Prefer abbr for the headline since it
  // reads tighter at Saira-uppercase scale ("PUTS USA AHEAD" beats
  // "PUTS UNITED STATES AHEAD"). Full name preferred only when no abbr.
  const headlines = deriveHeadlines(eventList, {
    homeName: homeAbbr ?? homeName,
    awayName: awayAbbr ?? awayName,
  });

  const rows = [
    ...eventList.map((e) => ({ kind: 'event', data: e, ...eventRowSortKey(e) })),
    ...lifecycle.map((l) => ({ ...l, data: l, sortId: 0 })),
  ];

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
          Key <span className="accent">Moments</span>{' '}&amp; Events
        </div>
        <div className="commentary-header-meta">Latest first · Auto-updates</div>
      </div>
      <div className="key-moments-ai-marker">Live Notes · Auto-Generated</div>

      <div className="km">
        {rows.map((r, i) => {
          if (r.kind === 'lifecycle') {
            const cls = `km-divider${r.lifecycle === 'kickoff' ? ' kickoff' : ''}`;
            return (
              <div key={`lifecycle-${r.lifecycle}`} className={cls}>
                <span>
                  {r.label}
                  {r.meta && <> · {r.meta}</>}
                </span>
              </div>
            );
          }
          const e = r.data;
          const h = headlines.get(e.id) ?? { kind: 'sub', headline: '' };
          const isGoal = h.kind === 'goal';
          const hasGloss = typeof e.gloss === 'string' && e.gloss.length > 0;
          const rowClass = `km-row${isGoal ? ' goal' : ''}`;

          // Scorer span gets .scored treatment so the volt highlight on
          // goal rows lands on the name only. The first whitespace in
          // the headline separates the (upper-cased) scorer from the
          // template; we wrap that initial segment.
          let headlineNode;
          if (isGoal && h.scorer) {
            const upperScorer = h.scorer.toUpperCase();
            if (h.headline.startsWith(upperScorer)) {
              const tail = h.headline.slice(upperScorer.length);
              headlineNode = (
                <>
                  <span className="scored">{upperScorer}</span>
                  {tail}
                </>
              );
            } else {
              headlineNode = h.headline;
            }
          } else {
            headlineNode = h.headline;
          }

          return (
            <div key={e.id ?? `${e.minute}-${e.minute_extra}-${i}`} className={rowClass}>
              <div className="km-min">{formatMinute(e)}</div>
              <KmIcon kind={h.kind} />
              <div className="km-body">
                <div className="km-headline">{headlineNode}</div>
                {hasGloss && <div className="km-gloss">{e.gloss}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
