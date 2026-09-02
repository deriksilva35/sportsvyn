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
 * THE LEAGUE'S SEATING - fixed, the same in every run. teams is
 * draft_configs.teams (slot 1..N, fantraxTeamId, isMine); a team's column is
 * its real draft position, the one Fantrax's draftOrder gave it. Nothing about
 * a run moves it.
 *
 * RULING (2 Sep): SEAT = FRANCHISE, NOT A CHAIR. The keeper board is the real
 * league's map: every keeper renders in its OWNER'S real column in every run.
 * Choosing a seat chooses WHICH FRANCHISE you control - its column, its
 * keepers - not where you sit. The earlier per-run swap (a reader dragged into
 * another team's column, that team dragged into theirs, the keepers following)
 * is gone: it redrew the league to fit the reader.
 *
 * Returns seatOf: fantraxTeamId -> 0-based column, and teamAt: the teams in
 * slot order. Throws on a slot outside 1..N or an owner listed twice - both
 * mean the import wrote a league that cannot be drawn.
 */
export function leagueSeats(teams) {
  const list = [...(teams ?? [])].sort((a, b) => a.slot - b.slot);
  const N = list.length;
  const seatOf = new Map();
  for (const t of list) {
    const s = Number(t.slot);
    if (!Number.isInteger(s) || s < 1 || s > N) throw new Error(`slot ${t.slot} outside 1..${N}`);
    if (seatOf.has(t.fantraxTeamId)) throw new Error(`owner ${t.fantraxTeamId} seated twice`);
    seatOf.set(t.fantraxTeamId, s - 1);
  }
  return { seatOf, teamAt: list };
}

/**
 * Keepers per column, 1..N as an array (index = slot - 1), for the seat picker's
 * pills: "12 · 4 kept" says what choosing that franchise hands you. Keepers
 * whose owner is not in teams are not counted anywhere - they are the import's
 * problem (owner_not_seated at draft time), not a phantom on some pill.
 */
export function keptBySeat(keepers, teams) {
  const { seatOf, teamAt } = leagueSeats(teams);
  const out = Array.from({ length: teamAt.length }, () => 0);
  for (const k of keepers ?? []) {
    const i = seatOf.get(k.fantrax_team_id);
    if (i != null) out[i] += 1;
  }
  return out;
}

/** pickInRound (1-based) for a 0-based seat in a round, snake. Inverse of seatFor. */
export function pickInRoundFor(round, seatIndex, teamsCount) {
  return round % 2 === 1 ? seatIndex + 1 : teamsCount - seatIndex;
}

/**
 * Keeper rows -> engine pick records, ordered by overall pick.
 *
 * THE CELL IS DERIVED, NOT READ. A keeper row carries its owner
 * (fantrax_team_id) and its round; the column is that owner's real slot
 * (seatOf, from leagueSeats - the league's fixed map, identical in every run),
 * and the overall follows through the snake. The provider's own pick_in_round
 * on the row is not consulted here: it is the same fact stated a second way,
 * and one derivation from (owner, round) is the one that cannot drift.
 *
 * An owner missing from seatOf is a conflict, reported and skipped, never
 * placed on a guess: it means the teams list and the keeper rows disagree
 * about who is in the league.
 */
export function keeperPicks(keepers, teamsCount, seatOf) {
  const recs = []; const conflicts = [];
  for (const k of keepers ?? []) {
    const seat = seatOf?.get(k.fantrax_team_id);
    if (seat == null) {
      conflicts.push({ round: k.round, owner: k.fantrax_team_id ?? null, player: k.player_name, reason: 'owner_not_seated' });
      continue;
    }
    const pickInRound = pickInRoundFor(k.round, seat, teamsCount);
    recs.push({
      round: k.round,
      overallPick: overallFor(k.round, pickInRound, teamsCount),
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

/**
 * THE IMPORT-TIME CHECK, kept from the seat-keyed design. Fantrax states both
 * the owning team's slot (from draftOrder) and the pick's position in its
 * round; under snake those must agree, and when they do not the provider's
 * order changed under us. Refused at import, where it is still a statement
 * about Fantrax's seating - never at draft time, where the seating is ours.
 */
export function providerSeatConflicts(keepers, teamsCount) {
  const conflicts = [];
  for (const k of keepers ?? []) {
    const seat = seatFor(k.round, k.pick_in_round, teamsCount);
    if (seat !== k.team_slot - 1) {
      conflicts.push({ round: k.round, pickInRound: k.pick_in_round,
        seatFromOrder: k.team_slot - 1, seatFromSnake: seat, player: k.player_name });
    }
  }
  return conflicts;
}
