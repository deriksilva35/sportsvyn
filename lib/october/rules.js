// lib/october/rules.js - the five rules, in one place, PURE.
//
// WRITE ONCE, SHOW ON THE CARD, NEVER CHANGE MID-TOURNAMENT. Every refusal a
// player can hit is decided here and nowhere else, so the sentence the card
// prints and the sentence the server enforces are the same sentence.
//
//   1. ONE ARM AND FOUR BATS, only from that day's postseason games.
//   2. MAX TWO PLAYERS FROM ONE GAME.
//   3. ROLLING LOCK PER SLOT at that game's first pitch.
//   4. AN EMPTY SLOT AT FIRST PITCH IS A DNF FOR THE DAY - not a zero.
//   5. BURN: a player used once is gone for the rest of the postseason.

export const SLOTS = Object.freeze(['arm', 'bat1', 'bat2', 'bat3', 'bat4']);
export const SLOT_KIND = Object.freeze({
  arm: 'arm', bat1: 'bat', bat2: 'bat', bat3: 'bat', bat4: 'bat',
});
export const MAX_PER_GAME = 2;
export const CARD_SIZE = SLOTS.length;

/**
 * ─────────────────────────────────────────────────────────────────────────
 * TWO RULES COLLIDE ON A SHORT SLATE, and the postseason is full of them.
 * ─────────────────────────────────────────────────────────────────────────
 * "One arm and four bats" wants five players. "Max two from one game" caps a
 * day at 2 x games. On a TWO-GAME day that is four, and on the World Series'
 * ONE-GAME days it is two - so a five-slot card is not merely hard to fill,
 * it is arithmetically impossible, and every entry on those days would be a
 * DNF through no fault of the reader.
 *
 * THIS IS NOT A CORNER CASE, it is most of October. Counted against the real
 * 2025 bracket, now imported: of its 26 days, TWENTY-ONE had fewer than three
 * games - eleven of them had exactly one. A rigid five-slot card would have
 * been a DNF for every player on 81% of the tournament, including every day
 * of the World Series.
 *
 * THE CARD IS THEREFORE min(5, 2 x games). Both stated rules survive intact -
 * the cap is a fairness rule and is never relaxed, and the card is still one
 * arm and then bats - and DNF goes back to meaning what the relay wants it to
 * mean: you did not fill the slots that were fillable.
 *
 * FLAGGED FOR A RULING rather than assumed silently. The alternatives are to
 * lift the cap on short slates (which lets one game decide a whole day) or to
 * run no card at all on them (which skips the World Series). This is the one
 * that keeps every day playable and every rule true, but it is a change to
 * the shape of the card and it is the user's call.
 */
export function cardSizeFor(board = []) {
  const games = Array.isArray(board) ? board.length : 0;
  return Math.max(0, Math.min(SLOTS.length, MAX_PER_GAME * games));
}

/** The slots a given day actually has: the arm first, then bats. */
export function slotsFor(board = []) {
  return SLOTS.slice(0, cardSizeFor(board));
}

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
  const slots = slotsFor(board);
  const filled = slots.filter((s) => lineup?.[s]?.playerId != null);
  if (filled.length === slots.length) return { state: 'complete', filled: filled.length };
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

  // 2. MAX TWO FROM ONE GAME, counted over the card as it WOULD be - the slot
  //    being overwritten does not count against its own replacement.
  const fromGame = SLOTS.filter((s) => s !== slot)
    .filter((s) => String(lineup?.[s]?.matchId ?? '') === String(player.matchId)).length;
  if (fromGame >= MAX_PER_GAME) return 'max_two_from_game';

  return null;
}

/** The card's own count, for the header's "3 of 5" and its pips. */
export function cardProgress(lineup = {}, board = [], now = new Date()) {
  const locked = lockedSlots(lineup, board, now);
  const pips = slotsFor(board).map((s) => {
    if (locked.has(s)) return 'locked';
    return lineup?.[s]?.playerId != null ? 'picked' : 'open';
  });
  return {
    pips,
    filled: pips.filter((p) => p !== 'open').length,
    locked: locked.size,
    picked: pips.filter((p) => p === 'picked').length,
    open: pips.filter((p) => p === 'open').length,
    total: pips.length,
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
