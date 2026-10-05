// lib/run/entry.js - the nine against the database.
//
// THE DOOR IS THIN. Every refusal is lib/run/rules.js refuseReason()'s, so the
// sentence the card prints beside a greyed player and the sentence the server
// returns are produced by the same function. This file adds the server clock
// and the reader's own burn list, and nothing else.

import { sql } from '../db.js';
import { SLOTS, refuseReason, progress, rosterState, roundPips, clubStarted, nextClubLock, ROSTER_SIZE, DNF } from './rules.js';
import { scoreRoster, boxForRound, clubStateFrom } from './settle.js';
import { usedPlayers, runPool, clubStarters, lineupsByClub, probablesByClub, roundMatches, roundGames,
  probablesByClubGames, lastLineupsByClub, postedAtByClub } from './pool.js';
import { surname } from '../mlb/cardLines.js';
import { notStarting } from '../october/pool.js';
import { RULES_LINE } from '../mlb/fantasyPoints.js';
import { isVoidAll, VOID_ALL_LABEL } from '../settle/voidRule.js';

/** Save one slot. Save-on-change; there is no submit. */
export async function saveRunPick(userId, contestId, slot, player, { now = new Date() } = {}) {
  const contest = (await sql`
    SELECT id, board, meta, settled, opens_at, season_year FROM contests
     WHERE id = ${contestId} AND game_type = 'run' LIMIT 1`)[0];
  if (!contest) return { ok: false, reason: 'no_board' };
  if (contest.settled) return { ok: false, reason: 'settled' };
  if (new Date(contest.opens_at).getTime() > new Date(now).getTime()) return { ok: false, reason: 'not_open' };

  const [entry] = await sql`
    SELECT lineup FROM contest_entries WHERE contest_id = ${contestId} AND user_id = ${userId}`;
  const lineup = entry?.lineup ?? {};
  // THE BURN LIST EXCLUDES THIS ROUND'S OWN ROSTER, or replacing a pick would
  // refuse the player it is replacing as "used" - by the reader, here.
  const used = await usedPlayers(userId, contest.season_year, { excludeContestId: contestId, preview: isRunPreview(contest) });

  // THE DOOR READS THE SAME CLUB LOCKS THE CARD DOES, off the round's own
  // matches - statuses, live first pitches and which clubs play in each.
  const games = roundGames(await roundMatches(contest).catch(() => []));
  const reason = refuseReason(lineup, slot, player, {
    board: runBoardOf(contest), used, now, games,
  });
  if (reason) return { ok: false, reason, usedIn: reason === 'used' ? used.get(String(player.playerId)) : undefined };

  const patch = JSON.stringify({
    [slot]: {
      playerId: String(player.playerId), teamId: Number(player.teamId),
      kind: player.kind, name: player.name ?? null, team: player.team ?? null,
      // WHEN THE PICK WAS MADE, on the server's clock. The settle scores only
      // the games that begin at or after it - no backfill.
      at: new Date(now).toISOString(),
    },
  });
  await sql`
    INSERT INTO contest_entries (contest_id, user_id, lineup, submitted_at)
    VALUES (${contestId}, ${userId}, ${patch}::jsonb, ${new Date(now).toISOString()}::timestamptz)
    ON CONFLICT (contest_id, user_id)
    DO UPDATE SET lineup = contest_entries.lineup || ${patch}::jsonb, updated_at = now(),
                  submitted_at = EXCLUDED.submitted_at`;
  return { ok: true, slot, playerId: String(player.playerId) };
}

/** Clear a slot. The round's lock applies to clearing as well as to filling. */
export async function clearRunPick(userId, contestId, slot, { now = new Date() } = {}) {
  const contest = (await sql`
    SELECT id, board, meta, settled FROM contests WHERE id = ${contestId} AND game_type = 'run' LIMIT 1`)[0];
  if (!contest) return { ok: false, reason: 'no_board' };
  if (contest.settled) return { ok: false, reason: 'settled' };
  if (!SLOTS.includes(slot)) return { ok: false, reason: 'bad_slot' };
  // A SLOT WHOSE PLAYER'S CLUB HAS STARTED IS SEALED - clearing is a change
  // too. An empty slot, or one holding a club still ahead, clears freely.
  const [entry] = await sql`
    SELECT lineup FROM contest_entries WHERE contest_id = ${contestId} AND user_id = ${userId}`;
  const sitting = entry?.lineup?.[slot];
  if (sitting?.teamId != null) {
    const games = roundGames(await roundMatches(contest).catch(() => []));
    if (clubStarted(sitting.teamId, now, { games })) return { ok: false, reason: 'game_started' };
  }
  await sql`
    UPDATE contest_entries SET lineup = lineup - ${slot}, updated_at = now(), submitted_at = ${new Date(now).toISOString()}::timestamptz
     WHERE contest_id = ${contestId} AND user_id = ${userId}`;
  return { ok: true, slot };
}

/**
 * THE SETTING SCREEN and THE LIVE SCREEN are one read - the mock's frames 1
 * and 2 are the same roster before and after the lock, and which one renders
 * is a function of the clock, not of a different query.
 */
/** Is this round the preview? One field, asked by everything. */
export const isRunPreview = (c) => c?.meta?.preview === true;

/**
 * THE ROUND'S SHAPE, from the two columns it actually lives in. contests.board
 * is the ARRAY of clubs - it is an array for every game in this product and at
 * least one existing query calls jsonb_array_length on it - and everything
 * else is in meta. This is the one place that joins them back up.
 */
export function runBoardOf(contest) {
  return { ...(contest?.meta ?? {}), clubs: contest?.board ?? [] };
}

export async function runView(userId, contest, { now = new Date(), withPool = true } = {}) {
  if (!contest) return { phase: 'none', contest: null, slots: [], clubs: [] };
  const board = runBoardOf(contest);
  const round = board.round ?? null;

  const [entry] = userId == null ? [] : await sql`
    SELECT lineup, score, meta FROM contest_entries
     WHERE contest_id = ${contest.id} AND user_id = ${userId}`;
  const lineup = entry?.lineup ?? {};

  const { seriesFor } = await import('../mlb/series.js');
  const [rows, series, used, pool, done, matchRows] = await Promise.all([
    boxForRound(contest),
    seriesFor(round, contest.season_year).catch(() => []),
    usedPlayers(userId, contest.season_year, { excludeContestId: contest.id, preview: isRunPreview(contest) }),
    withPool ? runPool(contest).catch(() => null) : Promise.resolve(null),
    (async () => (await import('./create.js')).settledRounds(contest.season_year))().catch(() => []),
    // THE POSTED CARDS, ONE PER CLUB. The panel's bats are the lineup when it
    // is up - the same rule October's picker follows, through the same two
    // functions - and this is read live rather than frozen into the cached pool
    // because a batting order changes all afternoon and the pool is built once.
    // THE ROUND'S OWN MATCHES, once. The club locks read their statuses and
    // their live first pitches (clubStarted) and the panel reads their posted
    // cards, off the same rows.
    roundMatches(contest).catch(() => []),
  ]);
  const lineups = await lineupsByClub(contest, matchRows).catch(() => new Map());
  // G1 AND G2 PROBABLES, and THE PROJECTED NINE for every club whose card is
  // not up - its card from its last final (tue-5).
  const probableGames = probablesByClubGames(matchRows);
  const unposted = (board.clubs ?? []).filter((c) => !c.bye && !lineups.get(String(c.teamId))).map((c) => c.teamId);
  const projected = withPool ? await lastLineupsByClub(unposted, { now }).catch(() => new Map()) : new Map();
  const panel = panelFor(pool, lineups, probablesByClub(matchRows), { games: probableGames, projected });
  const postedAt = postedAtByClub(matchRows);
  // THE LOCK IS PER CLUB. Each club seals at its own first game of the round
  // (clubStarted), and the header counts down to the next club still ahead
  // (nextClubLock). The card says LOCKED only once every club has started.
  const games = roundGames(matchRows);
  const lockOpts = { games };
  const next = nextClubLock(board, now, lockOpts);

  const clubState = clubStateFrom(series, board.clubs ?? []);
  const card = scoreRoster(lineup, rows, clubState);
  const prog = progress(lineup, board, now, lockOpts);
  // AN ALL-VOID CLOSE IS NOT A FINAL ROUND (ruling sun-11 item 1): rosterState
  // with final:true turns an empty or short roster into a DNF, and nobody can
  // DNF a round nobody played. Read as unfinal; the flags below say void.
  const voidAll = contest.settled === true && isVoidAll(contest);
  const state = rosterState(lineup, { final: contest.settled === true && !voidAll });
  const aliveBy = new Map(clubState.map((c) => [String(c.teamId), c]));
  const started = new Set((board.clubs ?? [])
    .filter((c) => clubStarted(c.teamId, now, lockOpts)).map((c) => String(c.teamId)));

  return {
    phase: contest.settled ? 'settled' : prog.locked ? 'live' : 'open',
    contest: {
      id: contest.id, season: contest.season_year, week: contest.week,
      round, label: board.label ?? null,
      settled: contest.settled,
      preview: isRunPreview(contest),
      voidAll,
      voidLabel: voidAll ? VOID_ALL_LABEL : null,
      seasonLabel: contest.meta?.season_label ?? null,
      rules: RULES_LINE, rosterSize: ROSTER_SIZE,
    },
    // THE NEXT CLUB LOCK, with the clock's reading taken HERE, on the server -
    // October learned that Date.now() during render hydrates to a different
    // minute than it painted.
    nextLock: next ? {
      matchId: next.matchId, kickoffAt: next.kickoffAt, label: next.label,
      msAway: Math.max(0, next.ms - new Date(now).getTime()),
    } : null,
    pips: roundPips(round, done),
    clubs: (board.clubs ?? []).map((c) => ({
      ...c,
      alive: c.bye ? null : (aliveBy.get(String(c.teamId))?.alive ?? true),
      gamesPlayed: aliveBy.get(String(c.teamId))?.gamesPlayed ?? 0,
      // WHETHER THIS CLUB'S CARD IS UP. Per club, because one posts at 3pm and
      // the next at 6.
      lineupPosted: panel.posted[String(c.teamId)] === true,
      // THE TILE'S NAME: the G1 probable's surname, or null ("TBA" on the tile).
      probableShort: surname(probableGames.get(String(c.teamId))?.g1?.name) ?? null,
      // THE PANEL'S LINE: "lineup posted 9:12 AM" / "projected from Sun's game".
      lineupNote: lineupNote({
        posted: panel.posted[String(c.teamId)] === true,
        postedAt: postedAt.get(String(c.teamId)) ?? null,
        projectedFrom: panel.projected?.[String(c.teamId)] ? projected.get(String(c.teamId))?.kickoffAt ?? null : null,
      }),
      // STARTED: this club's first game of the round is under way, so it is
      // out of everyone's pool for the rest of the round.
      started: started.has(String(c.teamId)),
    })),
    slots: card.slots.map((s) => ({
      ...s,
      name: lineup?.[s.slot]?.name ?? null,
      team: lineup?.[s.slot]?.team ?? s.abbr,
      // SEALED: his club has started, so this slot neither swaps nor clears.
      locked: started.has(String(lineup?.[s.slot]?.teamId ?? '')),
      // "NOT STARTING - SWAP", only while this slot can still move - the lock
      // is the club's, as October's is the game's. Same function either way.
      notStarting: s.slot.startsWith('arm') ? false : notStarting(
        { ...(lineup?.[s.slot] ?? {}) },
        {
          lineup: { away: lineups.get(String(lineup?.[s.slot]?.teamId ?? '')) ?? null, home: null },
          awayAbbr: lineup?.[s.slot]?.team ?? null,
          homeAbbr: null,
          locked: started.has(String(lineup?.[s.slot]?.teamId ?? '')),
        },
      ),
    })),
    progress: prog,
    rosterState: state.state,
    isDnf: !voidAll && state.state === DNF,
    dnfSlots: voidAll ? [] : state.dnfSlots,
    // NO TOTAL ON A VOID ROUND: scoreRoster reads live lines, and a game that
    // started and was then abandoned would print points for a round that was
    // never scored.
    total: voidAll ? null : card.total,
    aliveCount: card.alive,
    outCount: card.out,
    used: Object.fromEntries(used),
    pool: panel.pool ?? pool,
    score: entry?.score == null ? null : Number(entry.score),
  };
}

/**
 * The panel's rows, club by club, cut to the posted lineup - and which clubs
 * have posted.
 *
 * IT RETURNS THE WHOLE POOL SHAPE for the reason October's does: the roster
 * component reads view.pool.byClub[teamId] and nothing else, and a component
 * that had to merge an overlay at render time would be a second place that knew
 * this shape.
 */
export function panelFor(pool, lineups = new Map(), probables = new Map(), { games = null, projected = new Map() } = {}) {
  const posted = {};
  const projectedBy = {};
  if (!pool?.byClub) return { pool, posted, projected: projectedBy };
  const byClub = {};
  for (const [key, rows] of Object.entries(pool.byClub)) {
    const g = games?.get(String(key)) ?? null;
    const cut = clubStarters(rows ?? [], {
      posted: lineups.get(String(key)) ?? null,
      // G1 off the per-game read when there is one; the one-probable map
      // otherwise (the house's caller, and every caller before tue-5).
      probable: g ? g.g1 : probables.get(String(key)) ?? null,
      probable2: g?.g2 ?? null,
      projected: projected.get(String(key))?.list ?? null,
    });
    byClub[key] = cut.rows;
    posted[key] = cut.posted;
    projectedBy[key] = cut.projected;
  }
  return { pool: { ...pool, byClub }, posted, projected: projectedBy };
}

const PT_CLOCK = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });
const PT_DAY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short' });

/**
 * PURE. The panel's lineup line. A posted card with no recorded time says
 * "lineup posted" rather than inventing one; a projection names the day of
 * the game it came from, in the Pacific clock the rest of the card uses.
 */
export function lineupNote({ posted = false, postedAt = null, projectedFrom = null } = {}) {
  const t = (iso) => { const d = new Date(iso ?? NaN); return Number.isFinite(d.getTime()) ? d : null; };
  if (posted) return t(postedAt) ? `lineup posted ${PT_CLOCK.format(t(postedAt))} PT` : 'lineup posted';
  if (t(projectedFrom)) return `projected from ${PT_DAY.format(t(projectedFrom))}'s game`;
  return 'lineup not posted yet';
}

/**
 * THE NEXT CLUB LOCK for a round, read on its own - the Games row's clock.
 * null when every club has started (or the round is settled).
 */
export async function nextRunLock(contest, { now = new Date() } = {}) {
  if (!contest || contest.settled) return null;
  const games = roundGames(await roundMatches(contest).catch(() => []));
  return nextClubLock(runBoardOf(contest), now, { games });
}
