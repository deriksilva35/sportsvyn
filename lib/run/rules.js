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
//   4. THE ROUND LOCKS AT ITS FIRST PITCH, all nine at once. No changes until
//      the next round opens.
//   5. AN UNSET ROSTER AT LOCK IS A DNF (0) FOR THE ROUND.
//   6. THE BURN: a player used in any round is out of that user's pool for
//      the rest of the postseason.
//
// THE LOCK IS THE ROUND'S, NOT THE SLOT'S, and that is the clearest difference
// from October. October's card is a day of separate games and each pick seals
// at its own first pitch; a Run roster is ONE bet on a whole round, so it
// seals once, at the round's first pitch, and the reader lives with it for a
// week. Two games, two lock shapes, and neither borrows the other's.

// THE TWO GAMES SHARE ONE ANSWER TO "HAS THIS MOVED". effectiveKickoff and
// isPostponed are October's, imported rather than copied: a round lock and a
// slot lock ask the same question of the same two facts, and two copies would be
// two answers the first time a game was called off.
import { effectiveKickoff, isPostponed } from '../october/rules.js';

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

/**
 * WHEN THE ROUND ACTUALLY LOCKS, in ms. PURE.
 *
 * THE LATER OF THE FROZEN FIRST PITCH AND THE LIVE EARLIEST ONE. The frozen
 * time is meta.firstPitch, written when the round was created and never touched
 * again; the live time is the earliest first pitch still standing across the
 * round's games. Taking the LATER of the two is the 067 law read out loud, the
 * same rule October's slots follow: a reschedule may GRANT editing time and can
 * never STEAL it.
 *
 * A POSTPONED GAME IS NOT ONE OF THE ROUND'S FIRST PITCHES. It is excluded from
 * the live earliest, and that single exclusion is what makes both halves true:
 *
 *   IT NEVER LOCKS A ROUND EARLY. Round 1's frozen lock is its own earliest
 *   game. If that game is called off, its time is gone from the live set, the
 *   live earliest becomes the NEXT game's, and the lock moves out to meet it -
 *   so nobody's roster seals at the first pitch of a game that was not thrown.
 *
 *   IT NEVER HOLDS A ROUND OPEN PAST THE NEXT EARLIEST GAME. The live reading
 *   is a MINIMUM, so a postponed game replayed on Thursday cannot drag the lock
 *   to Thursday: Wednesday's game is earlier and wins. Rosters seal when the
 *   round's first ball is actually thrown, not when its last makeup is.
 *
 * WITHOUT `games` THIS IS THE OLD BEHAVIOUR EXACTLY - the frozen time alone -
 * so every caller that has no status to offer is unchanged.
 *
 * @param board  { firstPitch }
 * @param games  [{ matchId, kickoffAt, status }] - the round's own matches
 */
export function roundLockAt(board = {}, { games = null, statusBy = null } = {}) {
  const frozen = board?.firstPitch ?? null;
  if (!Array.isArray(games) || !games.length) return new Date(frozen ?? NaN).getTime();
  // A REOPENED PREVIEW'S STARTED GAMES ARE NOT ITS FIRST PITCHES any more -
  // they left the round when it reopened (reopenPreview), so their times
  // cannot pull the live earliest back behind the reopened lock.
  const gone = new Set((board?.reopen?.startedMatchIds ?? []).map(String));
  const live = games
    .filter((g) => !gone.has(String(g?.matchId)))
    .filter((g) => !isPostponed(statusBy, g?.matchId) && String(g?.status ?? '') !== 'postponed')
    .map((g) => new Date(g?.kickoffAt ?? NaN).getTime())
    .filter((ms) => Number.isFinite(ms));
  // EVERY GAME CALLED OFF is not an early lock either: with nothing live to
  // read, the frozen time is all there is, and the round stays as it was rather
  // than locking on a reading built from an empty set.
  if (!live.length) return new Date(frozen ?? NaN).getTime();
  return effectiveKickoff(frozen, new Date(Math.min(...live)).toISOString());
}

/**
 * THE ROUND'S LOCK. `<=` at the boundary instant: at the stated time the round
 * has begun. See roundLockAt() for which instant that is once a game has moved.
 */
export function isLocked(board = {}, now = new Date(), opts = {}) {
  const t = roundLockAt(board, opts);
  return Number.isFinite(t) && t <= new Date(now).getTime();
}

/**
 * THE ROUND'S VERDICT.
 *
 * A DNF IS A STATE, NOT A NUMBER. It scores 0, and it is SHOWN as DNF - the
 * mock's league board prints "DNF" in a round column beside a total of 0.0.
 * A round you did not set is a different fact from a round where your nine
 * were swept, and the board has to be able to say which.
 *
 * PARTIAL IS STILL A DNF. Eight of nine at first pitch is not "score the
 * eight": the roster is the bet, and a short one was never a legal entry.
 */
export function rosterState(lineup = {}, board = {}, now = new Date(), opts = {}) {
  const filled = SLOTS.filter((s) => lineup?.[s]?.playerId != null).length;
  if (filled === ROSTER_SIZE) return { state: 'set', filled };
  if (isLocked(board, now, opts)) return { state: DNF, filled };
  return { state: 'open', filled };
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
  board = {}, used = new Map(), now = new Date(), games = null, statusBy = null,
} = {}) {
  if (!isSlot(slot)) return 'bad_slot';
  if (player?.playerId == null || player?.teamId == null) return 'bad_player';

  // 1. THE SLOT'S KIND. Two arms and seven bats is the shape of the roster,
  //    not a suggestion; an arm in a bat slot is a different team.
  if (kindOf(slot) !== player.kind) return 'wrong_kind';

  // 4. THE ROUND'S LOCK, before anything else that could be worked around -
  //    and at the instant roundLockAt() says, not at a frozen time a called-off
  //    game left behind.
  if (isLocked(board, now, { games, statusBy })) return 'round_locked';

  // 2a. A REOPENED PREVIEW'S STARTED GAMES. Their clubs left the pool when the
  //     round reopened - a player whose game is already under way is a pick
  //     made with the answer showing.
  if ((board?.reopen?.outClubIds ?? []).map(String).includes(String(player.teamId))) return 'game_started';

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

/** The header's "7 of 9" and the four round pips. */
export function progress(lineup = {}, board = {}, now = new Date(), opts = {}) {
  const filled = SLOTS.filter((s) => lineup?.[s]?.playerId != null).length;
  return {
    filled, total: ROSTER_SIZE, toGo: ROSTER_SIZE - filled,
    locked: isLocked(board, now, opts),
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

/**
 * PURE. THE PREVIEW'S MERCY, as ruled on 24 Sep: reopen a preview round whose
 * lock has passed.
 *
 * PREVIEW ONLY. A real round's lock is the bet; nobody reopens the Wild Card.
 *
 * THE LOCK BECOMES THE EARLIEST FIRST PITCH NOT YET THROWN, frozen at the
 * reopen - not a moving "next game", which would slide forward every time a
 * game started and never lock at all. A postponed game is not a first pitch,
 * the same exclusion roundLockAt() makes.
 *
 * GAMES ALREADY STARTED LEAVE THE ROUND, and their clubs leave the pool for
 * everyone - the board every reader sees and the door every pick goes
 * through. A doubleheader club with its second game still ahead leaves too:
 * its players are already scoring in the first one.
 *
 * @param meta   the round's meta (firstPitch, preview, ...)
 * @param clubs  contests.board, the club array
 * @param games  [{ matchId, kickoffAt, status, homeTeamId, awayTeamId }]
 * @returns { ok, reason } or { ok, clubs, meta } - meta is the PATCH to merge
 */
export function reopenPreview({ meta = {}, clubs = [], games = [], now = new Date() } = {}) {
  if (meta?.preview !== true) return { ok: false, reason: 'not-preview' };
  const t = new Date(now).getTime();
  const postponed = (g) => String(g?.status ?? '') === 'postponed';
  const kick = (g) => new Date(g?.kickoffAt ?? NaN).getTime();
  const started = games.filter((g) => !postponed(g)
    && (['live', 'final'].includes(String(g?.status ?? '')) || (Number.isFinite(kick(g)) && kick(g) <= t)));
  const startedIds = new Set(started.map((g) => String(g.matchId)));
  const ahead = games.filter((g) => !postponed(g) && !startedIds.has(String(g.matchId)) && Number.isFinite(kick(g)))
    .sort((a, b) => kick(a) - kick(b));
  if (!ahead.length) return { ok: false, reason: 'nothing-left' };

  const out = new Set(started.flatMap((g) => [g.homeTeamId, g.awayTeamId]).filter((v) => v != null).map(String));
  const kept = clubs.filter((c) => !out.has(String(c.teamId)));
  const firstPitch = new Date(kick(ahead[0])).toISOString();
  return {
    ok: true,
    clubs: kept,
    meta: {
      firstPitch,
      clubs: kept.length,
      alive: kept.filter((c) => !c.bye).length,
      reopen: {
        at: new Date(t).toISOString(),
        from: meta.reopen?.from ?? meta.firstPitch ?? null,
        startedMatchIds: [...startedIds],
        outClubIds: [...out],
      },
    },
  };
}
