// lib/push/scoreFold.js - ONE TOUCHDOWN, ONE NOTIFICATION. PURE.
//
// THE PROBLEM. The board moves twice for one play. A touchdown posts six, and
// the extra point posts the seventh a refresh later - two deltas, two 'score'
// transitions, two pushes, for one thing that happened. A reader gets "KC 21"
// and then "KC 22" thirty seconds apart and has to work out that the second
// one is not a new score.
//
// THE FIX HAS TWO HALVES, AND THE FIRST IS NOT A TIMER.
//
//   1. THE PLAY ALREADY KNOWS. The try is written INSIDE the touchdown's own
//      play text in both feeds ("... TOUCHDOWN. C.Little extra point is GOOD"),
//      and the play row's home_score/away_score are the POST-TRY numbers. So
//      when the plays table has caught up, there is nothing to wait for: the
//      push goes out once, immediately, with the score the board is about to
//      show. lib/push/scoringPlay.js does that reading.
//
//   2. THE WINDOW IS THE FALLBACK. The score poller and the plays cron are
//      independent writers and the play row can land after the score does. So
//      a bare six with no play to read HOLDS for up to FOLD_WINDOW_MS. If the
//      try's delta arrives first, the two fold into one push carrying the
//      post-try score. If nothing arrives, the hold times out and the six goes
//      out on its own - which is also exactly right for a missed extra point.
//
// A HOLD IS NEVER A DROP. Every path out of here emits; the only question is
// when and with which scoreline. The relay's own words: the join is the
// enrichment, not the dependency.
//
// NOTHING ELSE WAITS. A field goal, a safety and a defensive score have no try
// and go immediately. So does a delta of 7 or 8, which is the board having
// already folded the try into one tick by itself.
//
// THE IDEMPOTENCY KEY FALLS OUT OF THIS FOR FREE. lib/push/prefs.js eventKey()
// keys a score on `score:<match>:<home>:<away>`, so a folded push claims the
// POST-TRY scoreline - and the try's own delta, when it arrives a tick later,
// produces that same key and is deduped by the claim that already exists.
// That is why the fold must emit with the scores it printed, never with the
// scores it observed at the six.

/** How long a bare touchdown waits for its try before going out alone. */
export const FOLD_WINDOW_MS = 90_000;

const TD_DELTAS = new Set([6, 7, 8]);

/** The state to send, with the play row's post-try scores substituted in. */
function withPlayScores(state, play) {
  if (play?.homeScore == null || play?.awayScore == null) return state;
  return { ...state, homeScore: play.homeScore, awayScore: play.awayScore };
}

/**
 * A score transition arrives.
 *
 * @param {object|null} pending  this team's held touchdown, or null
 * @param {object} evt {delta, state, play, now}
 * @returns {{pending: object|null, emit: Array<{state, kind, scorer, folded, timedOut}>}}
 */
export function onScore(pending, { delta, state, play = null, now = Date.now() } = {}) {
  // A HELD TOUCHDOWN CLAIMS THE NEXT DELTA ON THE SAME TEAM. One, two or zero
  // points: whatever it is, it belongs to the play we are holding, and the new
  // state carries the scoreline after it.
  if (pending) {
    return {
      pending: null,
      emit: [{
        state,
        kind: 'touchdown',
        scorer: pending.play?.scorer ?? null,
        folded: true,
        timedOut: false,
      }],
    };
  }

  const td = TD_DELTAS.has(Number(delta));
  if (!td) {
    // Not a touchdown: nothing to fold, and the caller's own delta-derived
    // kind is as good as it gets unless the play named one.
    return {
      pending: null,
      emit: [{ state, kind: play?.kind ?? null, scorer: play?.scorer ?? null, folded: false, timedOut: false }],
    };
  }

  // THE PLAY RESOLVED THE TRY: send now, with the play's own post-try score.
  if (play?.kind === 'touchdown' && play.tryResolved) {
    return {
      pending: null,
      emit: [{ state: withPlayScores(state, play), kind: 'touchdown', scorer: play.scorer ?? null, folded: true, timedOut: false }],
    };
  }

  // THE BOARD FOLDED IT ITSELF - 7 or 8 in one tick is already post-try.
  if (Number(delta) !== 6) {
    return {
      pending: null,
      emit: [{ state, kind: 'touchdown', scorer: play?.scorer ?? null, folded: true, timedOut: false }],
    };
  }

  // A bare six with nothing to read. Hold.
  return { pending: { delta: 6, state, play, at: now }, emit: [] };
}

/**
 * Time passes. Called every poll, whether or not this match changed.
 * A hold older than the window goes out on its own - a missed extra point
 * looks exactly like a late one from here, and both are correctly a six.
 */
export function onTick(pending, { now = Date.now() } = {}) {
  if (!pending) return { pending: null, emit: [] };
  if (now - pending.at < FOLD_WINDOW_MS) return { pending, emit: [] };
  return {
    pending: null,
    emit: [{ state: pending.state, kind: 'touchdown', scorer: pending.play?.scorer ?? null, folded: false, timedOut: true }],
  };
}

/**
 * SOMETHING ELSE IS ABOUT TO BE SAID ABOUT THIS GAME - a quarter, a close, a
 * final. The held touchdown goes first, whatever its window says, because a
 * reader must never be told the game ended and then told about a score from
 * before the whistle.
 */
export function flush(pending) {
  if (!pending) return { pending: null, emit: [] };
  return {
    pending: null,
    emit: [{ state: pending.state, kind: 'touchdown', scorer: pending.play?.scorer ?? null, folded: false, timedOut: false }],
  };
}
