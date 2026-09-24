// lib/run/settle.js - a roster scores every game its clubs play in the round.
//
// THE UNIT IS THE ROUND, NOT THE GAME. A Run slot is not a bet on one box
// score - it is a bet that this player's club goes deep, and the points are
// the SUM of every game that club plays in the round. A sweep is three games
// and a full series is five, which is the whole strategic question the game
// asks: a safe club that wins in three can be worth less than a coin-flip
// club that goes the distance.
//
// A SWEPT CLUB STOPS SCORING AND NOTHING IS ZEROED. The relay's own words, and
// the mock draws it: Judge's slot is marked OUT, and it keeps 7.0. Zeroing an
// eliminated club would punish a reader twice for one bad call and would make
// the board unreadable - a 0 would be indistinguishable from a player who
// never appeared.
//
// SETTLED PER GAME AT ITS FINAL; the ROUND settles when its last series is
// decided, which lib/mlb/series.js already answers.

import { sql } from '../db.js';
import { SLOTS, ROSTER_SIZE, DNF, rosterState } from './rules.js';
import { slotPoints, batLine, armLine, round1 } from '../mlb/fantasyPoints.js';

/**
 * PURE. One roster against the round's box scores.
 *
 * @param lineup   { slot: { playerId, teamId } }
 * @param rows     mlb_player_game_stats rows for the round, any club
 * @param clubs    [{ teamId, abbr, alive, gamesPlayed }] - the round's state
 */
export function scoreRoster(lineup = {}, rows = [], clubs = []) {
  const byPlayer = new Map();
  for (const r of rows) {
    const k = String(r.bdl_player_id);
    if (!byPlayer.has(k)) byPlayer.set(k, []);
    byPlayer.get(k).push(r);
  }
  const clubBy = new Map(clubs.map((c) => [String(c.teamId), c]));

  const slots = SLOTS.map((slot) => {
    const pick = lineup?.[slot] ?? null;
    if (!pick?.playerId) return { slot, state: 'empty', points: null, games: 0, line: null };
    const club = clubBy.get(String(pick.teamId)) ?? null;
    const games = byPlayer.get(String(pick.playerId)) ?? [];
    // EVERY GAME THE CLUB PLAYED, summed. A player who sat one out contributes
    // nothing for it and is not penalised for it.
    const points = games.length
      ? round1(games.reduce((a, g) => a + slotPoints(slot === 'arm1' || slot === 'arm2' ? 'arm' : 'bat', g), 0))
      : (club && club.gamesPlayed > 0 ? 0 : null);
    return {
      slot,
      playerId: pick.playerId,
      teamId: pick.teamId,
      abbr: club?.abbr ?? null,
      // OUT IS A CLUB FACT, not a player one, and it does not touch the score.
      state: club && club.alive === false ? 'out' : games.length ? 'live' : 'pending',
      games: games.length,
      points,
      line: summarise(slot, games),
    };
  });

  const total = round1(slots.reduce((a, s) => a + (s.points ?? 0), 0));
  return {
    slots, total,
    filled: slots.filter((s) => s.state !== 'empty').length,
    alive: slots.filter((s) => s.state !== 'empty' && s.state !== 'out').length,
    out: slots.filter((s) => s.state === 'out').length,
  };
}

/** The mock's own sub-line: a round's worth of a bat, or of an arm. */
function summarise(slot, games) {
  if (!games.length) return null;
  const arm = slot === 'arm1' || slot === 'arm2';
  if (arm) {
    const s = games.reduce((a, g) => ({
      outs_recorded: n(a.outs_recorded) + n(g.outs_recorded),
      strikeouts_pitched: n(a.strikeouts_pitched) + n(g.strikeouts_pitched),
      earned_runs: n(a.earned_runs) + n(g.earned_runs),
      wins: n(a.wins) + n(g.wins),
    }), {});
    return armLine(s);
  }
  const s = games.reduce((a, g) => ({
    at_bats: n(a.at_bats) + n(g.at_bats), hits: n(a.hits) + n(g.hits),
    doubles: n(a.doubles) + n(g.doubles), triples: n(a.triples) + n(g.triples),
    home_runs: n(a.home_runs) + n(g.home_runs), rbi: n(a.rbi) + n(g.rbi),
    runs: n(a.runs) + n(g.runs), walks: n(a.walks) + n(g.walks),
    stolen_bases: n(a.stolen_bases) + n(g.stolen_bases),
  }), {});
  return batLine(s);
}
const n = (v) => (v == null || v === '' ? 0 : Number(v) || 0);

/** Every stat row for the round's games, read once. */
export async function boxForRound(contest) {
  const ids = (contest.meta?.matchIds ?? []);
  if (!ids.length) return [];
  return sql`
    SELECT match_id, bdl_player_id, at_bats, hits, doubles, triples, home_runs,
           rbi, runs, walks, stolen_bases,
           outs_recorded, strikeouts_pitched, wins, earned_runs, hits_allowed, walks_allowed
      FROM mlb_player_game_stats WHERE match_id = ANY(${ids})`.catch(() => []);
}

/**
 * The round's clubs, with whether they are still alive and how many games
 * they have played - both derived from the series, never stored.
 */
export function clubStateFrom(series = [], boardClubs = []) {
  const byTeam = new Map();
  for (const s of series) {
    for (const t of s.teams) {
      const cur = byTeam.get(String(t.id)) ?? { teamId: t.id, abbr: t.abbreviation, gamesPlayed: 0, alive: true };
      cur.gamesPlayed += s.games.filter((g) => g.status === 'final').length;
      // ALIVE UNTIL THE SERIES IS DECIDED AGAINST YOU. An undecided series
      // leaves both clubs alive, which is what "2 going to game 3" means.
      if (s.winner != null && s.winner !== t.id) cur.alive = false;
      byTeam.set(String(t.id), cur);
    }
  }
  // A club on the board with no series row is still on the board - it keeps
  // its own entry rather than vanishing from a roster that named it.
  for (const c of boardClubs) {
    if (!byTeam.has(String(c.teamId))) {
      byTeam.set(String(c.teamId), { teamId: c.teamId, abbr: c.abbr, gamesPlayed: 0, alive: true });
    }
  }
  return [...byTeam.values()];
}

/**
 * Settle one round. THE GATE IS THE SERIES, NOT THE CLOCK: the round is done
 * when every series in it has a winner, which is exactly when no club in it
 * can play another game.
 */
/**
 * PURE. May this round settle? NOTHING DECIDED IS NOT EVERYTHING DECIDED.
 *
 * On 23 Sep settleDueRun read its rounds WITHOUT meta, so every preview round
 * looked like a real one with no `round`; seriesFor(null) is [], "no undecided
 * series" was true of an empty list, and all four preview rounds - three of
 * them days away - were marked settled at 06:00Z. An absent meta, an absent
 * round and an empty series list are each a refusal here, never a pass.
 */
export function settleGate({ meta, series = null, previewComplete = null } = {}) {
  if (!meta || typeof meta !== 'object') return { ok: false, reason: 'no-meta' };
  if (meta.preview === true) {
    if (previewComplete?.complete !== true) {
      return { ok: false, reason: 'games-pending', remaining: previewComplete?.remaining ?? null };
    }
    return { ok: true };
  }
  if (!meta.round) return { ok: false, reason: 'no-round' };
  if (!Array.isArray(series) || !series.length) return { ok: false, reason: 'no-series' };
  const undecided = series.filter((s) => s.winner == null);
  if (undecided.length) {
    return { ok: false, reason: 'series-pending', remaining: undecided.length,
      waitingOn: undecided.map((s) => s.key) };
  }
  return { ok: true };
}

export async function settleRunRound(contest, { now = new Date() } = {}) {
  const { seriesFor } = await import('../mlb/series.js');
  // THE ROW'S OWN META, read here if the caller did not bring it - the gate
  // below refuses without it, and a round nobody can settle is the safe side.
  const meta = contest.meta ?? (await sql`
    SELECT meta FROM contests WHERE id = ${contest.id}`)[0]?.meta ?? null;
  contest = { ...contest, meta };
  const round = meta?.round ?? null;
  const preview = meta?.preview === true;

  let series = [];
  let previewComplete = null;
  if (preview) {
    // THE PREVIEW SETTLES ON THE DAY'S LAST FINAL. There are no series, so
    // "every series decided" has nothing to ask; "every match on this board
    // final" is the same gate in the vocabulary this round actually has, and
    // it is exactly the moment no club on the board can score again.
    const { previewRoundComplete } = await import('./preview.js');
    previewComplete = await previewRoundComplete(contest);
  } else if (round) {
    series = await seriesFor(round, contest.season_year);
  }
  const gate = settleGate({ meta, series, previewComplete });
  if (!gate.ok) return { contestId: contest.id, settled: false, preview, ...gate };

  const rows = await boxForRound(contest);
  // A PREVIEW CLUB IS NEVER "OUT". Nobody is eliminated from a Tuesday, so
  // every club stays alive and no slot is marked out - clubStateFrom's own
  // fallback for a board club with no series row does exactly that.
  const clubs = clubStateFrom(series, contest.board ?? []);
  const entries = await sql`
    SELECT id, user_id, lineup FROM contest_entries WHERE contest_id = ${contest.id}`;
  let dnf = 0;
  for (const e of entries) {
    const state = rosterState(e.lineup ?? {}, contest.meta ?? {}, now).state;
    const card = scoreRoster(e.lineup ?? {}, rows, clubs);
    const points = state === DNF ? 0 : card.total;
    if (state === DNF) dnf += 1;
    await sql`
      UPDATE contest_entries
         SET score = ${points}, base_score = ${points},
             meta = COALESCE(meta, '{}'::jsonb) || ${JSON.stringify({
    run: { state, filled: card.filled, out: card.out, raw: card.total, preview },
  })}::jsonb,
             locked_at = COALESCE(locked_at, now()), updated_at = now()
       WHERE id = ${e.id}`;
  }
  await sql`
    UPDATE contests SET settled = true, settled_at = now()
     WHERE id = ${contest.id} AND NOT settled`;
  return { contestId: contest.id, settled: true, entries: entries.length, dnf, round };
}

/** Every due Run round. */
export async function settleDueRun({ now = new Date() } = {}) {
  const due = await sql`
    SELECT id, board, meta, week, puzzle_date, season_year FROM contests
     WHERE game_type = 'run' AND sport = 'mlb' AND NOT settled
       AND opens_at <= ${new Date(now).toISOString()}
     ORDER BY week ASC`;
  const out = [];
  for (const c of due) {
    try { out.push(await settleRunRound(c, { now })); }
    catch (err) { out.push({ contestId: c.id, error: String(err?.message ?? err) }); }
  }
  return { due: due.length, results: out };
}

/** October total: the sum of a reader's settled rounds. A DNF round is 0. */
export function runTotal(rounds = []) {
  const counted = rounds.filter((r) => r.settled);
  return {
    total: round1(counted.reduce((a, r) => a + (r.state === DNF ? 0 : (Number(r.points) || 0)), 0)),
    rounds: counted.length,
    dnf: counted.filter((r) => r.state === DNF).length,
    of: ROSTER_SIZE,
  };
}
