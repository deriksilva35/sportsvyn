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
 * @param apRanks team_id -> AP rank, or an empty Map. Optional so every existing
 *                caller and test keeps working and simply renders no badges.
 * @param records team_id -> a record string ("9-3"), or an empty Map.
 * @param spreads match_id -> home-based signed spread, or an empty Map.
 */
export function gameRows({
  board, liveById = new Map(), picks = {}, now = new Date(),
  apRanks = new Map(), records = new Map(), spreads = new Map(),
}) {
  const t = new Date(now).getTime();
  return board.map((g) => {
    const live = liveById.get(g.match_id) ?? {};
    const status = live.status ?? 'scheduled';
    // THE SEAL: snapshot kickoff against the server clock. `<=` - at the
    // boundary instant the game has kicked and the pick is sealed.
    const kicked = hasKicked(g, { status, now });
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
      // TEAM IDS AND AP RANKS ARE NEW ON THIS PAYLOAD. The board previously
      // sent only the two NAME STRINGS, so a rank badge on a Pick'em row was
      // impossible without this - it is a reader change, not a markup edit.
      // Ranks are resolved server-side rather than shipping ids for the client
      // to look up: the client has no rankings table, and shipping ids alone
      // would have meant a second round trip per row.
      home_team_id: g.home_team_id ?? null,
      away_team_id: g.away_team_id ?? null,
      home_rank: apRanks?.get(g.home_team_id) ?? null,
      away_rank: apRanks?.get(g.away_team_id) ?? null,
      // THREE MORE KEYS, ARGUED IN RATHER THAN ADDED.
      //
      // NONE OF THE THREE IS VIEWER-SCOPED, which is the whole test the leak
      // law applies. A team's win-loss record and the market's consensus
      // spread are IDENTICAL for every reader of the board: they carry no
      // pick, no entry, no user id, and knowing them tells you nothing about
      // anyone. They are the same class as home_rank/away_rank, which were
      // argued in on exactly this basis - my_side remains the only field that
      // differs between two viewers.
      //
      // WHY THEY EARN THEIR PLACE. A pick'em row asks a reader to choose
      // between two names; a record and a line are the two facts a person
      // actually uses to choose, and without them the card makes the reader
      // leave to find them. The rank badge made the same argument.
      //
      // NULLABLE THROUGH THE WHOLE CHAIN. A record we do not hold and a game
      // with no priced spread both arrive as null and render as nothing - a
      // dash is never invented, and board creation cannot break on their
      // absence because absence is the default.
      home_record: records?.get(g.home_team_id) ?? null,
      away_record: records?.get(g.away_team_id) ?? null,
      // SIGNED, HOME-BASED, one key. The favoured side is the sign, so a
      // fourth key naming the favourite would be a derivable fact stored
      // twice - and two places to disagree.
      spread_home: spreads?.get(g.match_id) ?? null,
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

/**
 * ONE RULE FOR "HAS THIS GAME LOCKED", and both the board and the lobby ask it.
 *
 * A game is locked once its kickoff has passed OR the provider has moved it off
 * 'scheduled' - a game that started early, or was moved, is not still open to
 * pick just because the clock says so.
 *
 * `status` defaults to 'scheduled' because a caller that has not loaded live
 * statuses (the lobby card - pickemCardData reads contests.board and nothing
 * else) still gets the timestamp half of the rule rather than a second,
 * differently-worded rule of its own.
 */
export function hasKicked(g, { status = 'scheduled', now = new Date() } = {}) {
  return new Date(g.kickoff_at).getTime() <= new Date(now).getTime() || status !== 'scheduled';
}

/**
 * The next un-locked kickoff on a board, or null once every game has kicked.
 *
 * THE MINIMUM, NOT THE FIRST IN ARRAY ORDER. contests.board is built by the
 * board planner and nothing guarantees it is sorted by kickoff; taking [0]
 * would name whichever un-kicked game happened to be stored first.
 */
export function nextUnlockedKickoff(board, { statusOf = () => 'scheduled', now = new Date() } = {}) {
  let best = null;
  for (const g of board ?? []) {
    if (hasKicked(g, { status: statusOf(g), now })) continue;
    if (best == null || new Date(g.kickoff_at) < new Date(best)) best = g.kickoff_at;
  }
  return best;
}

/** The next un-kicked kickoff - the hero's countdown target. Null once the
 * whole slate has kicked. Same rule as nextUnlockedKickoff, asked of rows that
 * have already had `kicked` decided by hasKicked inside gameRows. */
export function nextKickoff(rows) {
  let best = null;
  for (const r of rows) {
    if (r.kicked) continue;
    if (best == null || new Date(r.kickoff_at) < new Date(best)) best = r.kickoff_at;
  }
  return best;
}

/** 'preopen' | 'living' | 'settled' - the route's three renders. No contest
 * at all is the caller's fourth state (the ghost), and none of them is a 404. */
export function boardPhase(contest, now = new Date()) {
  if (!contest) return 'preopen';
  if (contest.settled) return 'settled';
  if (new Date(contest.opens_at).getTime() > new Date(now).getTime()) return 'preopen';
  return 'living';
}
