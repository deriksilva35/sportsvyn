// lib/six/rules.js - TONIGHT'S SIX, every rule in one place. PURE, client-safe.
//
// THE CARD AND THE SERVER ASK THIS FILE AND NOTHING ELSE. The sentence the card
// prints beside a greyed player and the refusal the save door returns are one
// function's answer (lib/october/rules.js's law), so they cannot disagree.
//
//   1. SIX SLOTS: G, G, F, F, C, UTIL - from tonight's NBA games only.
//   2. ELIGIBILITY FROM THE PROVIDER'S POSITION (ruling thu-17):
//        G    <- G, G-F, F-G
//        F    <- F, G-F, F-C, C-F
//        C    <- C, F-C, C-F
//        UTIL <- anyone
//   3. A PER-TEAM CAP of max(2, ceil(6 / teams on the slate)).
//   4. ROLLING LOCK PER SLOT at its player's game's CURRENT tip.
//   5. AN EMPTY SLOT WHEN THE NIGHT'S LAST TIP PASSES MAKES THE NIGHT A DNF.
//   6. A PLAYER LISTED OUT IS NOT PICKABLE.
//
// THE TIP IS THE ROW'S, NOT THE SNAPSHOT'S (Derik's Phase B ruling for every
// NBA lock). An NBA tip is not settled until it happens - the 20 Oct opener is
// filed at a placeholder - so every decision here takes `kickoffBy` and
// `statusBy`, read from matches by the caller at the moment it decides. The
// board's own kickoff_at is a fallback for a row the caller could not read and
// nothing else; lib/six/lockSource.test.mjs pins that every door supplies both.

export const SLOTS = Object.freeze(['g1', 'g2', 'f1', 'f2', 'c', 'util']);
export const SLOT_POS = Object.freeze({ g1: 'G', g2: 'G', f1: 'F', f2: 'F', c: 'C', util: 'UTIL' });
export const CARD_SIZE = SLOTS.length;
export const BASE_MAX_PER_TEAM = 2;
export const DNF = 'dnf';

/** Statuses that make a game VOID: not played tonight (lib/nba/dayRules.js). */
export const VOID_STATUSES = Object.freeze(['cancelled', 'not_needed', 'postponed']);
export const isVoidStatus = (s) => VOID_STATUSES.includes(String(s ?? ''));

// VERBATIM FROM THE RULING, including its one asymmetry: F-G is guard-eligible
// and NOT forward-eligible, while G-F is both. Flagged to Derik as a probable
// slip rather than silently corrected - one line here if he rules it.
const ELIGIBLE = Object.freeze({
  G: new Set(['G', 'G-F', 'F-G']),
  F: new Set(['F', 'G-F', 'F-C', 'C-F']),
  C: new Set(['C', 'F-C', 'C-F']),
});

const normPos = (p) => String(p ?? '').trim().toUpperCase();

/** Can a player of `position` sit in `slot`? PURE. UTIL takes anyone. */
export function eligible(slot, position) {
  const pos = SLOT_POS[slot];
  if (!pos) return false;
  if (pos === 'UTIL') return true;
  return ELIGIBLE[pos].has(normPos(position));
}

/** The slots a position can fill, specific slots before UTIL. PURE. */
export const slotsFor = (position) => SLOTS.filter((s) => eligible(s, position));

/** The teams on a slate - two per game. */
export function teamsOn(board = []) {
  const ids = new Set();
  for (const g of board ?? []) {
    if (g?.home_team_id != null) ids.add(String(g.home_team_id));
    if (g?.away_team_id != null) ids.add(String(g.away_team_id));
  }
  return ids.size;
}

/**
 * ─────────────────────────────────────────────────────────────────────────
 * THE CAP SCALES, THE CARD DOES NOT. (October's ruling B3, applied to teams.)
 * ─────────────────────────────────────────────────────────────────────────
 * "Two per NBA team" caps a night at 2 x teams. A one-game night has two
 * teams, so a fixed cap of two makes the card four of six - arithmetically
 * impossible to finish. So the cap gives, never the card:
 *
 *     cap = max(2, ceil(6 / teams on the slate))
 *
 *     1 game  (2 teams)   cap 3   3+3
 *     2 games (4 teams)   cap 2   2+2+2
 *     any bigger night    cap 2
 *
 * It never tightens below two. CONFIRMED by Derik (thu-40): this is the rule,
 * and this one function is what the card and the save door both call.
 *
 * VOID GAMES DO NOT COUNT. A postponed game's two teams cannot be picked from,
 * so a two-game night with one postponed is a one-game night for the cap.
 */
export function teamCap(board = [], { statusBy = null } = {}) {
  const live = (board ?? []).filter((g) => !isVoidStatus(statusOf(statusBy, g?.match_id)));
  const teams = teamsOn(live);
  if (teams <= 0) return BASE_MAX_PER_TEAM;
  return Math.max(BASE_MAX_PER_TEAM, Math.ceil(CARD_SIZE / teams));
}

function lookup(map, id) {
  if (!map) return undefined;
  return typeof map.get === 'function' ? map.get(String(id)) : map[String(id)];
}
const statusOf = (statusBy, id) => lookup(statusBy, id) ?? 'scheduled';

/** A game's tip as the caller just read it; the snapshot only when no row was read. */
export function tipOf(g, kickoffBy) {
  const live = lookup(kickoffBy, g?.match_id);
  const t = new Date(live ?? g?.kickoff_at ?? NaN).getTime();
  return Number.isFinite(t) ? t : NaN;
}

/**
 * IS THIS GAME LOCKED? Its current tip has passed, or it has left 'scheduled'
 * (tipped early, gone final, been called off). `<=` at the boundary - the
 * dayGameLocked rule of lib/nba/dayPickem.js, on the same two facts.
 */
export function gameLocked(g, now, { statusBy = null, kickoffBy = null } = {}) {
  if (!g) return true;
  const t = tipOf(g, kickoffBy);
  return !Number.isFinite(t) || t <= new Date(now).getTime() || statusOf(statusBy, g.match_id) !== 'scheduled';
}

const gameById = (board, id) => (board ?? []).find((g) => String(g.match_id) === String(id)) ?? null;

/** WHICH SLOTS ARE SEALED: a filled slot whose player's game is locked. */
export function lockedSlots(lineup = {}, board = [], now = new Date(), opts = {}) {
  const out = new Set();
  for (const slot of SLOTS) {
    const pick = lineup?.[slot];
    if (!pick?.playerId) continue;
    const g = gameById(board, pick.matchId);
    if (g && gameLocked(g, now, opts)) out.add(slot);
  }
  return out;
}

/** How many on the card from one team, not counting `exceptSlot`. */
export function countFromTeam(lineup = {}, teamId, exceptSlot = null) {
  return SLOTS.filter((s) => s !== exceptSlot)
    .filter((s) => lineup?.[s]?.playerId && String(lineup[s].teamId ?? '') === String(teamId)).length;
}

/**
 * EVERY REFUSAL, in one function, so the card and the server agree.
 *
 * @param lineup  { slot: { playerId, matchId, teamId, position } }
 * @param slot    the slot being filled
 * @param player  { playerId, matchId, teamId, position }
 * @param opts    { board, now, statusBy, kickoffBy, outIds }
 *                outIds: a Set of provider player ids listed Out right now
 */
export function refuseReason(lineup, slot, player, {
  board = [], now = new Date(), statusBy = null, kickoffBy = null, outIds = null,
} = {}) {
  if (!SLOTS.includes(slot)) return 'bad_slot';
  if (player?.playerId == null || player?.matchId == null || player?.teamId == null) return 'bad_player';

  const game = gameById(board, player.matchId);
  if (!game) return 'not_tonight';
  // THE TEAM MUST BE ONE OF THE GAME'S TWO. A client can send any teamId, and
  // the cap below counts by it - a lie here would buy a third from one team.
  if (![game.home_team_id, game.away_team_id].map(String).includes(String(player.teamId))) return 'bad_player';

  if (!eligible(slot, player.position)) return 'wrong_position';

  // OUT IS OUT. The pool shows him dimmed with the tag; this is the server's copy.
  if (outIds && (typeof outIds.has === 'function' ? outIds.has(String(player.playerId)) : false)) return 'player_out';

  if (isVoidStatus(statusOf(statusBy, player.matchId))) return 'not_played';
  // THE LOCK, on the game being picked from AND on the slot being written: a
  // sealed slot cannot be changed, and a tipped game cannot be entered even
  // into an open slot.
  if (gameLocked(game, now, { statusBy, kickoffBy })) return 'game_started';
  if (lockedSlots(lineup, board, now, { statusBy, kickoffBy }).has(slot)) return 'slot_locked';

  for (const s of SLOTS) {
    if (s === slot) continue;
    if (String(lineup?.[s]?.playerId ?? '') === String(player.playerId)) return 'already_on_card';
  }

  // THE CAP, counted over the card as it WOULD be: the slot being overwritten
  // does not count against its own replacement.
  if (countFromTeam(lineup, player.teamId, slot) >= teamCap(board, { statusBy })) return 'max_from_team';

  return null;
}

/** Clearing a slot: refused once it is sealed. PURE. */
export function clearReason(lineup, slot, { board = [], now = new Date(), statusBy = null, kickoffBy = null } = {}) {
  if (!SLOTS.includes(slot)) return 'bad_slot';
  if (lockedSlots(lineup, board, now, { statusBy, kickoffBy }).has(slot)) return 'slot_locked';
  return null;
}

/**
 * THE NIGHT'S VERDICT. A night is a DNF if any slot is EMPTY once the last
 * game that will be played has tipped - an empty slot can still be filled from
 * a later game right up to that game's tip, so only the last tip closes it.
 * (October's dayState, on the current tips.)
 */
export function nightState(lineup = {}, board = [], now = new Date(), { statusBy = null, kickoffBy = null } = {}) {
  const filled = SLOTS.filter((s) => lineup?.[s]?.playerId != null).length;
  if (filled === CARD_SIZE) return { state: 'complete', filled };
  const playable = (board ?? []).filter((g) => !isVoidStatus(statusOf(statusBy, g?.match_id)));
  if (!playable.length) return { state: 'open', filled };
  const allLocked = playable.every((g) => gameLocked(g, now, { statusBy, kickoffBy }));
  return { state: allLocked ? DNF : 'open', filled };
}

/** The next lock a reader can still act on: the soonest unlocked, playable tip. */
export function nextLock(board = [], now = new Date(), { statusBy = null, kickoffBy = null } = {}) {
  const ahead = (board ?? [])
    .filter((g) => !isVoidStatus(statusOf(statusBy, g?.match_id)))
    .filter((g) => !gameLocked(g, now, { statusBy, kickoffBy }))
    .map((g) => ({ ...g, ms: tipOf(g, kickoffBy) }))
    .sort((a, b) => a.ms - b.ms);
  return ahead[0] ?? null;
}

/** The pips and counts the header prints. */
export function cardProgress(lineup = {}, board = [], now = new Date(), opts = {}) {
  const locked = lockedSlots(lineup, board, now, opts);
  const pips = SLOTS.map((s) => (locked.has(s) ? 'locked' : lineup?.[s]?.playerId != null ? 'picked' : 'open'));
  return {
    pips,
    filled: pips.filter((p) => p !== 'open').length,
    locked: locked.size,
    picked: pips.filter((p) => p === 'picked').length,
    open: pips.filter((p) => p === 'open').length,
    total: CARD_SIZE,
  };
}

/**
 * WHICH SLOT A TAP FILLS: the first open, unlocked, eligible slot - a specific
 * position before UTIL, so a guard does not spend the one slot a centre could
 * have used. `prefer` (a slot the reader tapped first) wins when it fits.
 */
export function targetSlot(lineup = {}, position, { locked = new Set(), prefer = null } = {}) {
  const free = (s) => !lineup?.[s]?.playerId && !locked.has(s);
  if (prefer && free(prefer) && eligible(prefer, position)) return prefer;
  return slotsFor(position).find(free) ?? null;
}

/** "GSW @ HOU" from a board entry. */
export function gameLabel(g) {
  const away = g?.away?.abbr ?? null;
  const home = g?.home?.abbr ?? null;
  return away && home ? `${away} @ ${home}` : null;
}
