// lib/eplWeekly5/entry.js - the card against the database.
//
// THE DOOR IS THIN AND THE RULES ARE NOT HERE: every refusal is
// lib/eplWeekly5/rules.js refuseReason(). What this file adds is the server
// clock, the LIVE fixture times and statuses (read at the moment of the save,
// never a frozen copy), and the player as the DATABASE knows him - a client
// sends a player id and nothing else, so the club the two-per-club cap counts
// and the fixture the lock reads cannot be supplied by a browser.

import { isVoidAll } from '../settle/voidRule.js';
import { sql } from '../db.js';
import {
  GAME_KEY, SLOTS, SLOT_LABEL, refuseReason, clearRefusal, cardProgress, nextLock, kickoffOf,
  roundLabel, roundShort, MAX_PER_CLUB, isOff, pickFixtures, pickLockAt,
} from './rules.js';
import { RULES_LINES } from './scoring.js';
import { fixturesNow, linesFor, scoreSlot, pickPairs, poolFor, cleanName } from './data.js';
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
  // His club's FIRST fixture on the board; a second one (a double gameweek)
  // is found by club at every read (rules.js pickFixtures), never stored.
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
  if (m.status === 'moved') return { kind: 'off', text: 'MOVED' };
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
  const t = new Date(now).getTime();
  const [lines, pool, rank, top] = await Promise.all([
    linesFor(picks.flatMap((p) => pickPairs(p, board))),
    withPool && !contest.settled ? poolFor(contest).catch(() => []) : Promise.resolve([]),
    userId == null ? null : rankOf(contest, userId).catch(() => null),
    contest.settled ? boardTop(contest, { limit: 3 }).catch(() => []) : Promise.resolve([]),
  ]);
  const progress = cardProgress(lineup, board, now, maps);
  const slots = SLOTS.map((slot, i) => {
    const pick = lineup[slot] ?? null;
    const s = scoreSlot(pick, board, fx, lines);
    const games = pick ? pickFixtures(pick, board) : [];
    const lockAt = pick ? pickLockAt(pick, board, maps) : NaN;
    const firstKo = games.length ? kickoffOf(games[0], maps.kickoffBy) : NaN;
    // DOUBLE GAMEWEEK (ruling sat-5 E2): each fixture's own line under the slot.
    const fixtures = games.length > 1 ? games.map((g) => {
      const m = fx.get(String(g.match_id));
      const f = s.fixtures.find((x) => String(x.matchId) === String(g.match_id)) ?? {};
      const home = String(g.home?.id) === String(pick.clubId);
      return {
        matchId: Number(g.match_id), opp: `${home ? 'vs' : '@'} ${(home ? g.away?.abbr : g.home?.abbr) ?? ''}`.trim(),
        kickoffAt: new Date(kickoffOf(g, maps.kickoffBy)).toISOString(), chip: fixtureChip(m),
        state: f.state ?? 'pending', points: f.points ?? null, parts: f.parts ?? [],
      };
    }) : null;
    // THE SLOT'S CHIP: the fixture in play, else the next to come, else the last played.
    const chipOf = () => {
      const ms = games.map((g) => fx.get(String(g.match_id)));
      if (!ms.length) return null;
      const live = ms.find((m) => m?.status === 'live');
      if (live) return fixtureChip(live);
      const on = ms.filter((m) => !isOff(maps.statusBy, m?.id));
      if (!on.length) return fixtureChip(ms[0]);
      if (on.some((m) => m?.status !== 'final')) return null;
      return fixtureChip(on[on.length - 1]);
    };
    const nextKo = games.map((g) => ({ g, ko: kickoffOf(g, maps.kickoffBy) }))
      .filter(({ g, ko }) => !isOff(maps.statusBy, g.match_id) && ko > t).sort((a, b) => a.ko - b.ko)[0]?.ko;
    const shownKo = Number.isFinite(lockAt) && lockAt > t ? lockAt : Number.isFinite(nextKo) ? nextKo : Number.isFinite(lockAt) ? lockAt : firstKo;
    return {
      slot, label: SLOT_LABEL[slot], pip: progress.pips[i],
      ...(pick ? {
        playerId: pick.playerId, name: pick.name, club: pick.club, clubId: pick.clubId, pos: pick.pos, matchId: pick.matchId,
        kickoffAt: Number.isFinite(shownKo) ? new Date(shownKo).toISOString() : null,
        chip: chipOf(),
        fixtures,
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
      // AN ALL-VOID CLOSE (ruling sun-12 a): the card prints VOID_ALL_LABEL.
      voidAll: contest.settled === true && isVoidAll(contest),
      maxPerClub: MAX_PER_CLUB, rules: RULES_LINES,
      perfect: contest.perfect?.score ?? null,
      perfectPlayers: contest.perfect?.players ?? [],
    },
    // THE BOARD AS IT STANDS, for the card's own refuseReason (the same pure
    // rules the server runs): live kickoff and status, nothing else.
    // The two clubs' ids ride along so pickFixtures() finds a club's SECOND
    // fixture on the client exactly as it does here.
    board: board.map((g) => ({
      match_id: g.match_id, kickoff_at: new Date(kickoffOf(g, maps.kickoffBy)).toISOString(),
      status: maps.statusBy.get(String(g.match_id)) ?? 'scheduled',
      home: { id: g.home?.id ?? null }, away: { id: g.away?.id ?? null },
    })),
    slots, progress, total,
    played, filled: picks.length,
    score: entry?.score == null ? null : Number(entry.score),
    rank,
    // VIEWER-SCOPED: handles and totals, never another reader's id.
    top: (top ?? []).map((r) => ({ rank: r.rank, handle: r.handle, total: r.total, house: r.house, mine: userId != null && String(r.userId) === String(userId) })),
    nextLock: next ? { matchId: next.match_id, kickoffAt: new Date(next.ms).toISOString() } : null,
    // A POOL ROW LOCKS WHEN HIS SLOT WOULD: his club's first fixture still on.
    pool: pool.map((p) => {
      const lock = pickLockAt(p, board, maps);
      return { ...p, kickoffAt: Number.isFinite(lock) ? new Date(lock).toISOString() : p.kickoffAt, open: Number.isFinite(lock) && lock > t };
    }),
  };
}
