// lib/october/rules.js - the five rules, in one place, PURE.
//
// WRITE ONCE, SHOW ON THE CARD, NEVER CHANGE MID-TOURNAMENT. Every refusal a
// player can hit is decided here and nowhere else, so the sentence the card
// prints and the sentence the server enforces are the same sentence.
//
//   1. ONE ARM AND FOUR BATS, only from that day's postseason games.
//   2. A PER-GAME CAP OF ceil(5 / games) - two on a normal slate, and more
//      when the slate is short enough that two would make five impossible.
//   3. ROLLING LOCK PER SLOT at that game's first pitch.
//   4. AN EMPTY SLOT AT FIRST PITCH IS A DNF FOR THE DAY - not a zero.
//   5. BURN: a player used once is gone for the rest of the postseason.

export const SLOTS = Object.freeze(['arm', 'bat1', 'bat2', 'bat3', 'bat4']);
export const SLOT_KIND = Object.freeze({
  arm: 'arm', bat1: 'bat', bat2: 'bat', bat3: 'bat', bat4: 'bat',
});
export const BASE_MAX_PER_GAME = 2;
export const CARD_SIZE = SLOTS.length;

/**
 * ─────────────────────────────────────────────────────────────────────────
 * THE CAP SCALES, THE CARD DOES NOT. (Ruling, B3.)
 * ─────────────────────────────────────────────────────────────────────────
 * "One arm and four bats" wants five players; a per-game cap of two caps a day
 * at 2 x games. On a two-game day that is four and on a one-game day it is
 * two, so a fixed cap made a full card ARITHMETICALLY IMPOSSIBLE on most of
 * the tournament - 21 of the 2025 postseason's 26 days had fewer than three
 * games, eleven had exactly one, and every World Series day has one.
 *
 * THE RULING: the CAP gives, not the card. cap = ceil(5 / games), so the
 * slate always has room for five and the five slots are always five.
 *
 *     1 game    cap 5   all five from it
 *     2 games   cap 3   3+2 is legal, 4+1 is not
 *     3 games   cap 2   2+2+1
 *     4 games   cap 2
 *
 * IT NEVER TIGHTENS BELOW TWO. Literally, ceil(5/5) is 1, which would forbid
 * two players from one game on a five-game day - a RESTRICTION the relay
 * never asked for and the opposite of what this rule is doing. The cap is
 * therefore the greater of the base two and the slate's own requirement. In
 * practice the two readings never differ: the busiest day of the 2025
 * postseason had four games, and MLB does not schedule five postseason games
 * in a day. The guard is for the rule's sake, not for a date in the calendar.
 */
export function maxPerGame(board = []) {
  const games = Array.isArray(board) ? board.length : 0;
  if (games <= 0) return BASE_MAX_PER_GAME;
  return Math.max(BASE_MAX_PER_GAME, Math.ceil(CARD_SIZE / games));
}

/** The card is always five. The cap is what moves. */
export const slotsFor = () => SLOTS;

export const isSlot = (s) => SLOTS.includes(s);
export const kindOf = (s) => SLOT_KIND[s] ?? null;

/**
 * A DNF IS NOT A ZERO, and the distinction is the whole reason this returns a
 * STATE rather than a number. A zero is a day you played badly; a DNF is a day
 * you did not field a card, and the board shows it as DNF while counting it as
 * 0 in the October total. Collapsing them would let an empty day hide inside a
 * bad one, and would make "best today" meaningless.
 */
export const DNF = 'dnf';

/**
 * WHICH SLOTS ARE SEALED. A slot locks at ITS OWN game's first pitch, taken
 * from the board SNAPSHOT - the 067 law: a rescheduled first pitch neither
 * steals editing time nor grants it. `<=` at the boundary instant.
 */
export function lockedSlots(lineup = {}, board = [], now = new Date()) {
  const t = new Date(now).getTime();
  const firstPitch = new Map(board.map((g) => [String(g.match_id), new Date(g.kickoff_at).getTime()]));
  const out = new Set();
  for (const slot of SLOTS) {
    const pick = lineup[slot];
    if (!pick) continue;
    const ko = firstPitch.get(String(pick.matchId));
    if (ko != null && ko <= t) out.add(slot);
  }
  return out;
}

/**
 * THE DAY'S VERDICT. Called at settle and at read.
 *
 * A DAY IS A DNF IF ANY SLOT WAS EMPTY WHEN ITS CHANCE PASSED - and "its
 * chance" is the LAST first pitch of the day, not each slot's own. An empty
 * slot can still be filled from a later game right up to that game's start;
 * only when every game has begun is the card unfillable.
 */
export function dayState(lineup = {}, board = [], now = new Date()) {
  const filled = SLOTS.filter((s) => lineup?.[s]?.playerId != null);
  if (filled.length === CARD_SIZE) return { state: 'complete', filled: filled.length };
  const t = new Date(now).getTime();
  const last = board.reduce((a, g) => Math.max(a, new Date(g.kickoff_at).getTime()), -Infinity);
  if (Number.isFinite(last) && last <= t) return { state: DNF, filled: filled.length };
  return { state: 'open', filled: filled.length };
}

/**
 * EVERY REFUSAL, in one function, so the card and the server agree.
 *
 * @param lineup   the entry as it stands, { slot: {playerId, matchId} }
 * @param slot     the slot being filled
 * @param player   { playerId, matchId, kind }  kind: 'arm' | 'bat'
 * @param opts     { board, used: Set(playerId), now }
 */
export function refuseReason(lineup, slot, player, { board = [], used = new Set(), now = new Date() } = {}) {
  if (!isSlot(slot)) return 'bad_slot';
  if (player?.playerId == null || player?.matchId == null) return 'bad_player';

  // 1. THE SLOT'S KIND. An arm in a bat slot is not a near miss, it is a
  //    different game - four bats and one arm is the shape of the card.
  if (kindOf(slot) !== player.kind) return 'wrong_kind';

  // ONLY FROM TODAY'S GAMES. The board is the day's snapshot; a player whose
  // game is not on it cannot be scored by this contest at all.
  const game = board.find((g) => String(g.match_id) === String(player.matchId));
  if (!game) return 'not_today';

  // 3. THE ROLLING LOCK, on the slot being filled AND on the game being
  //    picked from. Both matter: a sealed slot cannot be changed, and a game
  //    that has started cannot be entered even into an open slot.
  const t = new Date(now).getTime();
  if (new Date(game.kickoff_at).getTime() <= t) return 'game_started';
  if (lockedSlots(lineup, board, now).has(slot)) return 'slot_locked';

  // 5. THE BURN. A player used on any earlier day is gone for the rest of the
  //    postseason - the rule the whole pool bar on the mock exists to show.
  if (used.has(String(player.playerId))) return 'used';

  // No player twice on one card either, which the burn would otherwise only
  // catch tomorrow.
  for (const s of SLOTS) {
    if (s === slot) continue;
    if (String(lineup?.[s]?.playerId ?? '') === String(player.playerId)) return 'already_on_card';
  }

  // 2. THE DAY'S OWN CAP, counted over the card as it WOULD be - the slot
  //    being overwritten does not count against its own replacement.
  const fromGame = SLOTS.filter((s) => s !== slot)
    .filter((s) => String(lineup?.[s]?.matchId ?? '') === String(player.matchId)).length;
  if (fromGame >= maxPerGame(board)) return 'max_from_game';

  return null;
}

/** The card's own count, for the header's "3 of 5" and its pips. */
export function cardProgress(lineup = {}, board = [], now = new Date()) {
  const locked = lockedSlots(lineup, board, now);
  const pips = SLOTS.map((s) => {
    if (locked.has(s)) return 'locked';
    return lineup?.[s]?.playerId != null ? 'picked' : 'open';
  });
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
 * THE NEXT LOCK - what the Daily's flip clock counts down to on this card.
 * NOT midnight: each slot locks at its own first pitch, so the clock's job is
 * to name the soonest one a reader can still act on.
 *
 * It is the next kickoff among games that have NOT started, whether or not the
 * reader has picked from them - a game they have not picked yet is precisely
 * the one they are about to lose.
 */
export function nextLock(board = [], now = new Date()) {
  const t = new Date(now).getTime();
  const ahead = board
    .map((g) => ({ ...g, ms: new Date(g.kickoff_at).getTime() }))
    .filter((g) => Number.isFinite(g.ms) && g.ms > t)
    .sort((a, b) => a.ms - b.ms);
  return ahead[0] ?? null;
}
