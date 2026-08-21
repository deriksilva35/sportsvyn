// lib/pickem/view.js - the living board, derived. PURE: no DB, no React.
//
// PER-GAME LOCKS, RATIFIED AUG 21: each pick is editable until ITS game's
// kickoff; the contest's locks_at (first kickoff) survives only as the
// board's "day begins" moment for copy. The kickoff that seals a pick is the
// SNAPSHOT's (board jsonb, frozen at creation) - 067's locks-don't-chase law
// applied per game: a rescheduled kickoff neither steals editing time nor
// grants it. Live STATUS and SCORES come from matches; the deadline does not.
//
// The mock's frames 1 and 2 merge into one page: an un-kicked game is a pair
// of tappable sides, a kicked one is sealed and grading in. A mid-board
// entrant simply finds some games already sealed - those score as no-pick
// (0, Relay 3's scorer) and render dimmed with no result mark.

/** 'home' | 'away' | null(tie/unplayed) - ties cannot happen in CFB (OT), but
 * a defensive null beats inventing a winner. */
export function winnerOf(g) {
  if (g.status !== 'final' || g.home_score == null || g.away_score == null) return null;
  if (Number(g.home_score) === Number(g.away_score)) return null;
  return Number(g.home_score) > Number(g.away_score) ? 'home' : 'away';
}

/**
 * One wire row per board game, VIEWER-SCOPED ONLY. The exact key set is
 * pinned by the leak test - a new key here must be argued there.
 * @param board   the contest's board jsonb (snapshot games, kickoff order)
 * @param liveById match_id -> { status, home_score, away_score } from matches
 * @param picks   MY flat lineup { [match_id]: 'home'|'away' } - never anyone else's
 */
export function gameRows({ board, liveById = new Map(), picks = {}, now = new Date() }) {
  const t = new Date(now).getTime();
  return board.map((g) => {
    const live = liveById.get(g.match_id) ?? {};
    const status = live.status ?? 'scheduled';
    // THE SEAL: snapshot kickoff against the server clock. `<=` - at the
    // boundary instant the game has kicked and the pick is sealed.
    const kicked = new Date(g.kickoff_at).getTime() <= t || status !== 'scheduled';
    const mySide = picks[g.match_id] ?? picks[String(g.match_id)] ?? null;
    const win = winnerOf({ ...live, status });
    const graded = status === 'final' && mySide != null && win != null
      ? (mySide === win ? 'W' : 'L')
      : null;
    return {
      match_id: g.match_id,
      slug: g.slug,
      kickoff_at: g.kickoff_at,
      home: g.home,
      away: g.away,
      status,
      home_score: live.home_score ?? null,
      away_score: live.away_score ?? null,
      kicked,
      my_side: mySide,
      graded,
      nopick: kicked && mySide == null,
    };
  });
}

/** n/total picked - every saved pick counts, sealed or not. */
export function progressOf(rows) {
  return { picked: rows.filter((r) => r.my_side != null).length, total: rows.length };
}

/**
 * The record strip: W-L over PICKED finals; a no-pick final is neither a win
 * nor a loss (it is a 0 at the scorer, a dim row here); pending = games not
 * yet final. Shown once anything has kicked.
 */
export function recordOf(rows) {
  return {
    wins: rows.filter((r) => r.graded === 'W').length,
    losses: rows.filter((r) => r.graded === 'L').length,
    pending: rows.filter((r) => r.status !== 'final').length,
    anyKicked: rows.some((r) => r.kicked),
  };
}

/** The next un-kicked kickoff - the hero's countdown target. Null once the
 * whole slate has kicked. */
export function nextKickoff(rows) {
  const up = rows.filter((r) => !r.kicked);
  return up.length ? up[0].kickoff_at : null;
}

/** 'preopen' | 'living' | 'settled' - the route's three renders. No contest
 * at all is the caller's fourth state (the ghost), and none of them is a 404. */
export function boardPhase(contest, now = new Date()) {
  if (!contest) return 'preopen';
  if (contest.settled) return 'settled';
  if (new Date(contest.opens_at).getTime() > new Date(now).getTime()) return 'preopen';
  return 'living';
}
