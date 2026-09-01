// lib/fantrax/keeperSeed.js — keepers become pre-made picks. PURE.
//
// THE ENGINE ALREADY KNOWS HOW TO HAVE PICKS BEFORE THE USER'S TURN: that is
// what advanceAi does on every interactive start. Keepers use the same shape,
// through the same single writer (drafts.js pickInsert), with one difference -
// they are not chosen, they are given, so they are seeded BEFORE any AI runs
// and marked is_keeper.
//
// THE PICK NUMBER IS NOT STORED BY FANTRAX IN OUR TERMS. Its results carry
// round + pickInRound, which is a POSITION IN A ROUND, and under snake order
// the mapping from that to an overall pick reverses on even rounds. Deriving it
// wrong would put every even-round keeper on the wrong seat - and it would
// still look like a valid draft.

/**
 * Overall pick number for a round and a position within it, under snake.
 *
 * Fantrax's pickInRound is 1-based and already SNAKE-ORDERED - its round 2
 * pick 1 belongs to the team that picked last in round 1. So the overall is a
 * straight walk, and the seat is what reverses.
 */
export function overallFor(round, pickInRound, teamsCount) {
  return (round - 1) * teamsCount + pickInRound;
}

/** Seat (0-based team index) that owns a given round + pickInRound, snake. */
export function seatFor(round, pickInRound, teamsCount) {
  const i = pickInRound - 1;
  return round % 2 === 1 ? i : teamsCount - 1 - i;
}

/**
 * Keeper rows -> engine pick records, ordered by overall pick.
 *
 * THE SEAT IS CHECKED, NOT ASSUMED. Fantrax gives us both the team that owns
 * the pick (team_slot, derived from draftOrder) and the position in the round.
 * Under snake those two must agree; when they do not, something in the
 * provider's order changed and seeding anyway would hand a keeper to the wrong
 * manager. Reported, never guessed.
 */
export function keeperPicks(keepers, teamsCount) {
  const recs = []; const conflicts = [];
  for (const k of keepers ?? []) {
    const overall = overallFor(k.round, k.pick_in_round, teamsCount);
    const seat = seatFor(k.round, k.pick_in_round, teamsCount);
    if (seat !== k.team_slot - 1) {
      conflicts.push({ round: k.round, pickInRound: k.pick_in_round,
        seatFromOrder: k.team_slot - 1, seatFromSnake: seat, player: k.player_name });
      continue;
    }
    recs.push({
      round: k.round,
      overallPick: overall,
      rosterSlot: null,          // filled by the engine when it applies the pick
      ffcPlayerId: k.fantrax_player_id,
      playerName: k.player_name,
      position: k.position,
      pickedBy: 'logged',        // not 'user' and not 'ai' - nobody chose it
      // The market price and team ride on the keeper row (083 §4b): the pool
      // does not carry a kept player, so the pick cannot look them up.
      adpAtPick: k.adp == null ? null : Number(k.adp),
      team: k.team ?? null,
      isKeeper: true,
    });
  }
  recs.sort((a, b) => a.overallPick - b.overallPick);
  return { recs, conflicts };
}
