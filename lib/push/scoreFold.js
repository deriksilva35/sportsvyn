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
  const d = Number(delta);

  // ---- A HELD TOUCHDOWN TAKES ONLY A TRY ----------------------------------
  //
  // It used to claim the NEXT DELTA, whatever it was, and that cost a real
  // notification on 15 Sep. The provider flapped on Mahomes' first touchdown -
  // 0 to 6 at 00:27:42, back to 0 at 00:28:44, then 0 to 7 at 00:29:47, three
  // score changes for one play - and the hold took the revert as its try. It
  // sent "DEN 0, KC 0 · KC touchdown", a touchdown on a nil-nil scoreline, and
  // then, the hold being spent, the genuine seventh point sent a SECOND push.
  // One touchdown, two notifications, the first of them nonsense - worse than
  // the behaviour the fold replaced.
  //
  // A TRY IS +1 OR +2. Nothing else is.
  if (pending) {
    if (d === 1 || d === 2) {
      return {
        pending: null,
        emit: [{
          state,
          kind: 'touchdown',
          // THE FRESH LOOKUP WINS. A held six usually has no play row yet -
          // measured on 15 Sep, the plays cron writes every ~120s against a
          // 30s score poller - so the scorer very often arrives DURING the
          // hold. The caller re-runs the lookup when the hold resolves and
          // passes it here; pending.play is the fallback for when it still
          // has nothing.
          scorer: play?.scorer ?? pending.play?.scorer ?? null,
          credit: play?.credit ?? pending.play?.credit ?? null,
          folded: true,
          timedOut: false,
        }],
      };
    }

    // A REVERT CANCELS THE HOLD, SILENTLY. The score it was holding did not
    // happen, so there is nothing to announce - and announcing the revert
    // would be a push about a touchdown being taken away, which is not a
    // thing a scoreboard says.
    if (d < 0) return { pending: null, emit: [] };

    // ANYTHING ELSE LEAVES THE HOLD STANDING and is handled on its own merits.
    // A second score for the same team before the first one's try has landed
    // is its own event: it must not eat the hold, and the hold must not eat
    // it. The held six keeps its window and its timeout.
    return {
      pending,
      emit: [{
        state,
        kind: play?.kind ?? null,
        scorer: play?.scorer ?? null,
        credit: play?.credit ?? null,
        folded: false,
        timedOut: false,
      }],
    };
  }

  const td = TD_DELTAS.has(d);
  if (!td) {
    // Not a touchdown: nothing to fold, and the caller's own delta-derived
    // kind is as good as it gets unless the play named one.
    return {
      pending: null,
      emit: [{ state, kind: play?.kind ?? null, scorer: play?.scorer ?? null, credit: play?.credit ?? null, folded: false, timedOut: false }],
    };
  }

  // THE PLAY RESOLVED THE TRY: send now, with the play's own post-try score.
  if (play?.kind === 'touchdown' && play.tryResolved) {
    return {
      pending: null,
      emit: [{ state: withPlayScores(state, play), kind: 'touchdown', scorer: play.scorer ?? null, credit: play.credit ?? null, folded: true, timedOut: false }],
    };
  }

  // THE BOARD FOLDED IT ITSELF - 7 or 8 in one tick is already post-try.
  if (d !== 6) {
    return {
      pending: null,
      emit: [{ state, kind: 'touchdown', scorer: play?.scorer ?? null, credit: play?.credit ?? null, folded: true, timedOut: false }],
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
export function onTick(pending, { now = Date.now(), play = null } = {}) {
  if (!pending) return { pending: null, emit: [] };
  if (now - pending.at < FOLD_WINDOW_MS) return { pending, emit: [] };
  // THE LOOKUP IS RE-RUN AT THE TIMEOUT, not only when the hold started. A six
  // held for ninety seconds has had ninety seconds for its play row to land,
  // and on the measured cadence that is usually long enough.
  return {
    pending: null,
    emit: [{
      state: pending.state,
      kind: 'touchdown',
      scorer: play?.scorer ?? pending.play?.scorer ?? null,
      credit: play?.credit ?? pending.play?.credit ?? null,
      folded: false,
      timedOut: true,
    }],
  };
}

/**
 * SOMETHING ELSE IS ABOUT TO BE SAID ABOUT THIS GAME - a quarter, a close, a
 * final. The held touchdown goes first, whatever its window says, because a
 * reader must never be told the game ended and then told about a score from
 * before the whistle.
 */
export function flush(pending, { play = null } = {}) {
  if (!pending) return { pending: null, emit: [] };
  return {
    pending: null,
    emit: [{
      state: pending.state,
      kind: 'touchdown',
      scorer: play?.scorer ?? pending.play?.scorer ?? null,
      credit: play?.credit ?? pending.play?.credit ?? null,
      folded: false,
      timedOut: false,
    }],
  };
}
