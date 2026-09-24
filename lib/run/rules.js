// lib/run/rules.js - the nine, and every refusal. PURE.
//
// WRITTEN ONCE, ON THE CARD. Each rule below is printed on the mock's own
// steps note or its sub-line, so the sentence a reader sees and the sentence
// the server enforces are produced by the same module.
//
//   1. NINE: 2 ARMS AND 7 BATS, a 3x3 field.
//   2. ONLY FROM CLUBS ALIVE IN THIS ROUND. A bye club is not in the round-1
//      pool - "The 1 and 2 seeds sit this round out".
//   3. MAX THREE FROM ONE CLUB.
//   4. A PLAYER LOCKS WHEN HIS CLUB'S FIRST GAME OF THE ROUND STARTS. Not the
//      round: a club that has not played yet is still open to everyone, and
//      a slot holding a player whose club has started is sealed.
//   5. A SLOT STILL EMPTY WHEN THE ROUND IS DECIDED IS A DNF (0). A partial
//      nine scores what it scored; only a nine with nothing in it is a DNF
//      round.
//   6. THE BURN: a player used in any round is out of that user's pool for
//      the rest of the postseason.
//
// THE LOCK IS THE CLUB'S (ruling of 24 Sep, which replaced the whole-round
// lock, preview and postseason alike). A round's clubs start on different
// days - a Wild Card field is split across two - and sealing all nine at the
// first pitch of the first game shut readers out of clubs that had not thrown
// a ball. October's slots lock per game; the Run's lock per club, because the
// bet is on the club's whole round.
//
// A POINT IS NEVER BACKFILLED. A pick scores only the games that begin at or
// after the moment it was made (slot.at) - see lib/run/settle.js.

// THE TWO GAMES SHARE ONE ANSWER TO "IS THIS GAME CALLED OFF". isPostponed is
// October's, imported rather than copied: a club lock and a slot lock ask the
// same question of the same facts, and two copies would be two answers the
// first time a game was called off.
import { isPostponed } from '../october/rules.js';

export const ARM_SLOTS = Object.freeze(['arm1', 'arm2']);
export const BAT_SLOTS = Object.freeze(['bat1', 'bat2', 'bat3', 'bat4', 'bat5', 'bat6', 'bat7']);
export const SLOTS = Object.freeze([...ARM_SLOTS, ...BAT_SLOTS]);
export const ROSTER_SIZE = SLOTS.length;          // 9
export const MAX_PER_CLUB = 3;

export const ROUNDS = Object.freeze(['wild_card', 'division', 'championship', 'world_series']);
export const ROUND_LABEL = Object.freeze({
  wild_card: 'Wild Card', division: 'Division', championship: 'LCS', world_series: 'World Series',
});

export const DNF = 'dnf';

export const isSlot = (s) => SLOTS.includes(s);
export const kindOf = (s) => (ARM_SLOTS.includes(s) ? 'arm' : BAT_SLOTS.includes(s) ? 'bat' : null);
export const roundOf = (week) => ROUNDS[Number(week) - 1] ?? null;
export const weekOf = (round) => { const i = ROUNDS.indexOf(round); return i < 0 ? null : i + 1; };

const postponedG = (g, statusBy) => isPostponed(statusBy, g?.matchId) || String(g?.status ?? '') === 'postponed';
const koMs = (g) => new Date(g?.kickoffAt ?? NaN).getTime();
const clubOf = (g, teamId) => String(g?.homeTeamId) === String(teamId) || String(g?.awayTeamId) === String(teamId);

/**
 * WHEN A CLUB LOCKS, in ms. PURE. Its first game of the round that is actually
 * being played: a POSTPONED game is not a first pitch, so a called-off opener
 * moves the club's lock out to its next game rather than sealing it at a time
 * nothing happened. NaN when the club has no game to read.
 *
 * @param games  [{ matchId, kickoffAt, status, homeTeamId, awayTeamId }]
 */
export function clubLockAt(teamId, { games = [], statusBy = null } = {}) {
  const ms = (games ?? []).filter((g) => clubOf(g, teamId) && !postponedG(g, statusBy))
    .map(koMs).filter((t) => Number.isFinite(t));
  return ms.length ? Math.min(...ms) : NaN;
}

/**
 * HAS THIS CLUB STARTED ITS ROUND? `<=` at the boundary instant. A game the
 * feed already calls live or final counts whatever its clock says - a first
 * pitch thrown early is thrown.
 */
export function clubStarted(teamId, now = new Date(), { games = [], statusBy = null } = {}) {
  const mine = (games ?? []).filter((g) => clubOf(g, teamId));
  if (mine.some((g) => ['live', 'final'].includes(String(g?.status ?? '')))) return true;
  const t = clubLockAt(teamId, { games, statusBy });
  return Number.isFinite(t) && t <= new Date(now).getTime();
}

/**
 * THE NEXT LOCK - what the header counts down to. The earliest first pitch,
 * among games still ahead, of a club that has not started. A game between two
 * clubs that have both started already (a series' game 2) locks nobody.
 * null when every club in the round has started.
 *
 * @param board  { clubs } - abbreviations for the label, byes skipped
 */
export function nextClubLock(board = {}, now = new Date(), { games = [], statusBy = null } = {}) {
  const t = new Date(now).getTime();
  const abbr = new Map((board?.clubs ?? []).map((c) => [String(c.teamId), c.abbr]));
  const open = new Set((board?.clubs ?? []).filter((c) => !c.bye)
    .filter((c) => !clubStarted(c.teamId, now, { games, statusBy })).map((c) => String(c.teamId)));
  const ahead = (games ?? [])
    .filter((g) => !postponedG(g, statusBy) && Number.isFinite(koMs(g)) && koMs(g) > t)
    .filter((g) => open.has(String(g.homeTeamId)) || open.has(String(g.awayTeamId)))
    .sort((a, b) => koMs(a) - koMs(b));
  const g = ahead[0];
  if (!g) return null;
  const away = abbr.get(String(g.awayTeamId)) ?? null;
  const home = abbr.get(String(g.homeTeamId)) ?? null;
  return {
    matchId: String(g.matchId), kickoffAt: new Date(koMs(g)).toISOString(), ms: koMs(g),
    label: away && home ? `${away} @ ${home}` : null,
  };
}

/** EVERY CLUB IN THE ROUND HAS STARTED - the only moment the card says LOCKED. */
export function allClubsStarted(board = {}, now = new Date(), opts = {}) {
  const clubs = (board?.clubs ?? []).filter((c) => !c.bye);
  return clubs.length > 0 && clubs.every((c) => clubStarted(c.teamId, now, opts));
}

/**
 * THE ROUND'S VERDICT.
 *
 * DNF IS DECIDED WHEN THE ROUND IS, never at a first pitch. Until then an
 * unfilled nine is simply 'open' - some club may still be ahead. At the end:
 *   nine filled          'set'
 *   some filled          'short' - it scores what it scored; the empty slots
 *                        are the DNF, 0 each
 *   none filled          DNF - the whole round, shown as DNF
 *
 * @param opts.final  the round is decided (the settle's reading)
 */
export function rosterState(lineup = {}, { final = false } = {}) {
  const filled = SLOTS.filter((s) => lineup?.[s]?.playerId != null).length;
  const dnfSlots = final ? ROSTER_SIZE - filled : 0;
  if (filled === ROSTER_SIZE) return { state: 'set', filled, dnfSlots };
  if (!final) return { state: 'open', filled, dnfSlots };
  return { state: filled === 0 ? DNF : 'short', filled, dnfSlots };
}

/**
 * EVERY REFUSAL, in one function, each with a NAMED reason the card can print.
 *
 * @param lineup  the roster as it stands, { slot: { playerId, teamId } }
 * @param slot    the slot being filled
 * @param player  { playerId, teamId, kind }
 * @param opts    { board, used: Map(playerId -> round), now }
 */
export function refuseReason(lineup, slot, player, {
  board = {}, used = new Map(), now = new Date(), games = [], statusBy = null,
} = {}) {
  if (!isSlot(slot)) return 'bad_slot';
  if (player?.playerId == null || player?.teamId == null) return 'bad_player';

  // 1. THE SLOT'S KIND. Two arms and seven bats is the shape of the roster,
  //    not a suggestion; an arm in a bat slot is a different team.
  if (kindOf(slot) !== player.kind) return 'wrong_kind';

  // 4. THE CLUB'S LOCK. The slot's own player first: once his club has started
  //    he is sealed there, and neither a swap nor a clear may move him.
  const lockOpts = { games, statusBy };
  const sitting = lineup?.[slot];
  if (sitting?.playerId != null && sitting?.teamId != null && clubStarted(sitting.teamId, now, lockOpts)) {
    return 'game_started';
  }
  //    And the incoming player: a club under way is a pick made with the
  //    answer showing. Only that club - never the round.
  if (clubStarted(player.teamId, now, lockOpts)) return 'game_started';

  // 2. ALIVE IN THIS ROUND. A bye club is simply not in the round-1 pool, and
  //    an eliminated club is not in any later one - the same check, because
  //    "alive in this round" is the only question either asks.
  const alive = new Set((board?.clubs ?? []).filter((c) => !c.bye).map((c) => String(c.teamId)));
  if (!alive.has(String(player.teamId))) {
    return (board?.clubs ?? []).some((c) => String(c.teamId) === String(player.teamId) && c.bye)
      ? 'club_has_bye' : 'club_not_alive';
  }

  // 6. THE BURN. Used in ANY earlier round, gone for the rest of October.
  if (used.has(String(player.playerId))) return 'used';

  // Not twice on one roster either, which the burn would only catch next round.
  for (const s of SLOTS) {
    if (s === slot) continue;
    if (String(lineup?.[s]?.playerId ?? '') === String(player.playerId)) return 'already_on_roster';
  }

  // 3. MAX THREE FROM ONE CLUB, counted over the roster as it WOULD be - the
  //    slot being overwritten does not count against its own replacement.
  const fromClub = SLOTS.filter((s) => s !== slot)
    .filter((s) => String(lineup?.[s]?.teamId ?? '') === String(player.teamId)).length;
  if (fromClub >= MAX_PER_CLUB) return 'max_per_club';

  return null;
}

/** Per-club used count, for the grid's volt corner number. */
export function clubCounts(lineup = {}) {
  const out = new Map();
  for (const s of SLOTS) {
    const id = lineup?.[s]?.teamId;
    if (id == null) continue;
    out.set(String(id), (out.get(String(id)) ?? 0) + 1);
  }
  return out;
}

/** The header's "7 of 9", and whether every club has started (the card's LOCKED). */
export function progress(lineup = {}, board = {}, now = new Date(), opts = {}) {
  const filled = SLOTS.filter((s) => lineup?.[s]?.playerId != null).length;
  return {
    filled, total: ROSTER_SIZE, toGo: ROSTER_SIZE - filled,
    locked: allClubsStarted(board, now, opts),
    arms: ARM_SLOTS.filter((s) => lineup?.[s]?.playerId != null).length,
    bats: BAT_SLOTS.filter((s) => lineup?.[s]?.playerId != null).length,
  };
}

/**
 * THE FOUR PIPS. done / on / ahead, from the round this card is and which
 * rounds have settled - not from a date, because a round ends when its last
 * series is decided and that is a fact about games, not about the calendar.
 */
export function roundPips(currentRound, settledRounds = []) {
  const done = new Set(settledRounds);
  return ROUNDS.map((r) => ({
    round: r,
    label: ROUND_LABEL[r],
    state: done.has(r) ? 'done' : r === currentRound ? 'on' : 'ahead',
  }));
}
