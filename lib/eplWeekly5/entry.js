// lib/eplWeekly5/entry.js - the card against the database.
//
// THE DOOR IS THIN AND THE RULES ARE NOT HERE: every refusal is
// lib/eplWeekly5/rules.js refuseReason(). What this file adds is the server
// clock, the LIVE fixture times and statuses (read at the moment of the save,
// never a frozen copy), and the player as the DATABASE knows him - a client
// sends a player id and nothing else, so the club the two-per-club cap counts
// and the fixture the lock reads cannot be supplied by a browser.

import { sql } from '../db.js';
import {
  GAME_KEY, SLOTS, SLOT_LABEL, refuseReason, clearRefusal, cardProgress, nextLock, kickoffOf,
  roundLabel, roundShort, MAX_PER_CLUB, isOff,
} from './rules.js';
import { RULES_LINES } from './scoring.js';
import { fixturesNow, linesFor, scorePick, poolFor, cleanName } from './data.js';
import { rankOf, boardTop } from './board.js';

async function contestRow(contestId) {
  const [c] = await sql`
    SELECT id, season_year, week, board, meta, opens_at, locks_at, settled, settled_at, perfect
      FROM contests WHERE id = ${contestId} AND game_type = ${GAME_KEY} LIMIT 1`;
  return c ?? null;
}

const liveMaps = (fx) => ({
  statusBy: new Map([...fx].map(([k, m]) => [k, m.status])),
  kickoffBy: new Map([...fx].map(([k, m]) => [k, m.kickoff_at])),
});

/** The player as the database knows him, on this gameweek's board. */
async function resolvePlayer(playerId, board) {
  const [p] = await sql`
    SELECT id, COALESCE(known_as, full_name) AS name, position, current_team_id
      FROM players WHERE id = ${Number(playerId)} LIMIT 1`;
  if (!p) return null;
  const g = (board ?? []).find((x) => String(x.home?.id) === String(p.current_team_id) || String(x.away?.id) === String(p.current_team_id));
  const side = g ? (String(g.home?.id) === String(p.current_team_id) ? 'home' : 'away') : null;
  return {
    playerId: String(p.id), pos: p.position, clubId: p.current_team_id,
    matchId: g?.match_id ?? -1, name: cleanName(p.name), club: side ? g[side]?.abbr ?? null : null,
  };
}

/** SAVE ONE SLOT. Save-on-change; there is no submit. */
export async function saveEpl5Pick(userId, contestId, slot, playerId, { now = new Date() } = {}) {
  const contest = await contestRow(contestId);
  if (!contest) return { ok: false, reason: 'no_contest' };
  if (contest.settled) return { ok: false, reason: 'settled' };
  if (new Date(contest.opens_at).getTime() > new Date(now).getTime()) return { ok: false, reason: 'not_open' };
  const player = await resolvePlayer(playerId, contest.board);
  if (!player) return { ok: false, reason: 'bad_player' };
  const [entry] = await sql`SELECT lineup FROM contest_entries WHERE contest_id = ${contestId} AND user_id = ${userId}`;
  const lineup = entry?.lineup ?? {};
  const fx = await fixturesNow(contest.board);
  const reason = refuseReason(lineup, slot, player, { board: contest.board ?? [], now, ...liveMaps(fx) });
  if (reason) return { ok: false, reason };
  // ONE SLOT KEY, REPLACED WHOLE: `lineup || {slot: {...}}` merges at the top
  // level only, which is exactly one slot - the shallow merge is the intent.
  const patch = JSON.stringify({ [slot]: {
    playerId: player.playerId, matchId: Number(player.matchId), clubId: Number(player.clubId),
    pos: player.pos, name: player.name, club: player.club,
  } });
  await sql`
    INSERT INTO contest_entries (contest_id, user_id, lineup)
    VALUES (${contestId}, ${userId}, ${patch}::jsonb)
    ON CONFLICT (contest_id, user_id)
    DO UPDATE SET lineup = CASE WHEN jsonb_typeof(contest_entries.lineup) = 'object' THEN contest_entries.lineup ELSE '{}'::jsonb END
                           || ${patch}::jsonb,
                  updated_at = now()`;
  return { ok: true, slot, playerId: player.playerId };
}

/** Clear a slot - only before its own kickoff. */
export async function clearEpl5Pick(userId, contestId, slot, { now = new Date() } = {}) {
  const contest = await contestRow(contestId);
  if (!contest) return { ok: false, reason: 'no_contest' };
  if (contest.settled) return { ok: false, reason: 'settled' };
  const [entry] = await sql`SELECT lineup FROM contest_entries WHERE contest_id = ${contestId} AND user_id = ${userId}`;
  if (!entry) return { ok: true, slot };
  const fx = await fixturesNow(contest.board);
  const reason = clearRefusal(entry.lineup ?? {}, slot, { board: contest.board ?? [], now, ...liveMaps(fx) });
  if (reason) return { ok: false, reason };
  await sql`UPDATE contest_entries SET lineup = lineup - ${slot}, updated_at = now()
             WHERE contest_id = ${contestId} AND user_id = ${userId}`;
  return { ok: true, slot };
}

/** A fixture's chip on a slot: "FT 2–0", "62'", or nothing (the time renders client-side). PURE. */
export function fixtureChip(m) {
  if (!m) return null;
  if (m.status === 'final') return { kind: 'ft', text: m.home_score != null ? `FT ${m.home_score}–${m.away_score}` : 'FT' };
  if (m.status === 'live') {
    const el = m.live_state?.elapsed;
    const ex = m.live_state?.extra;
    const ht = m.live_state?.period === 'HT' || m.live_state?.short === 'HT';
    return { kind: 'live', text: ht ? 'HT' : el != null ? `${el}${ex ? `+${ex}` : ''}'` : 'LIVE' };
  }
  if (m.status === 'postponed') return { kind: 'off', text: 'PPD' };
  if (m.status === 'cancelled') return { kind: 'off', text: 'OFF' };
  return null;
}

/**
 * THE PICK, THE LIVE AND THE FINAL SCREEN are one read: which one renders is a
 * function of the gameweek's state, not of a different query.
 */
export async function epl5View(userId, contest, { now = new Date(), withPool = true } = {}) {
  if (!contest) return null;
  const board = contest.board ?? [];
  const [entry] = userId == null ? [] : await sql`
    SELECT lineup, score, meta FROM contest_entries WHERE contest_id = ${contest.id} AND user_id = ${userId}`;
  const lineup = entry?.lineup ?? {};
  const fx = await fixturesNow(board);
  const maps = liveMaps(fx);
  const picks = SLOTS.map((s) => lineup[s]).filter((p) => p?.playerId);
  const [lines, pool, rank, top] = await Promise.all([
    linesFor(picks.map((p) => ({ matchId: p.matchId, playerId: p.playerId }))),
    withPool && !contest.settled ? poolFor(contest).catch(() => []) : Promise.resolve([]),
    userId == null ? null : rankOf(contest, userId).catch(() => null),
    contest.settled ? boardTop(contest, { limit: 3 }).catch(() => []) : Promise.resolve([]),
  ]);
  const progress = cardProgress(lineup, board, now, maps);
  const slots = SLOTS.map((slot, i) => {
    const pick = lineup[slot] ?? null;
    const m = pick ? fx.get(String(pick.matchId)) : null;
    const s = scorePick(pick, m, pick ? lines.get(`${pick.matchId}:${pick.playerId}`) : null);
    const g = pick ? board.find((x) => String(x.match_id) === String(pick.matchId)) : null;
    return {
      slot, label: SLOT_LABEL[slot], pip: progress.pips[i],
      ...(pick ? {
        playerId: pick.playerId, name: pick.name, club: pick.club, clubId: pick.clubId, pos: pick.pos, matchId: pick.matchId,
        kickoffAt: g ? new Date(kickoffOf(g, maps.kickoffBy)).toISOString() : null,
        chip: fixtureChip(m),
      } : {}),
      state: s.state, points: s.points, parts: s.parts, provisional: s.provisional ?? false,
    };
  });
  const total = slots.reduce((a, s) => a + (s.points ?? 0), 0);
  const kicked = board.filter((g) => !isOff(maps.statusBy, g.match_id) && kickoffOf(g, maps.kickoffBy) <= new Date(now).getTime()).length;
  const played = slots.filter((s) => s.state === 'final').length;
  const next = nextLock(board, now, maps);
  const phase = contest.settled ? 'final' : kicked === 0 ? 'pick' : 'live';
  const first = board.length ? board[0].kickoff_at : null;
  const last = board.length ? board[board.length - 1].kickoff_at : null;
  return {
    phase,
    contest: {
      id: contest.id, season: contest.season_year, week: contest.week,
      label: roundLabel(contest.week), short: roundShort(contest.week),
      firstKickoff: first, lastKickoff: last, games: board.length,
      settled: contest.settled, settledAt: contest.settled_at ?? null,
      maxPerClub: MAX_PER_CLUB, rules: RULES_LINES,
      perfect: contest.perfect?.score ?? null,
      perfectPlayers: contest.perfect?.players ?? [],
    },
    // THE BOARD AS IT STANDS, for the card's own refuseReason (the same pure
    // rules the server runs): live kickoff and status, nothing else.
    board: board.map((g) => ({
      match_id: g.match_id, kickoff_at: new Date(kickoffOf(g, maps.kickoffBy)).toISOString(),
      status: maps.statusBy.get(String(g.match_id)) ?? 'scheduled',
    })),
    slots, progress, total,
    played, filled: picks.length,
    score: entry?.score == null ? null : Number(entry.score),
    rank, top,
    nextLock: next ? { matchId: next.match_id, kickoffAt: new Date(next.ms).toISOString() } : null,
    pool: pool.map((p) => ({ ...p, kickoffAt: (() => {
      const g = board.find((x) => String(x.match_id) === String(p.matchId));
      return g ? new Date(kickoffOf(g, maps.kickoffBy)).toISOString() : p.kickoffAt;
    })(), open: (() => {
      const g = board.find((x) => String(x.match_id) === String(p.matchId));
      return !!g && !isOff(maps.statusBy, p.matchId) && kickoffOf(g, maps.kickoffBy) > new Date(now).getTime();
    })() })),
  };
}
