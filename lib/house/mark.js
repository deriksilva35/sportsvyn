// lib/house/mark.js - THE ONE PLACE A LEADERBOARD ROW BECOMES A HOUSE ROW.
//
// Seven readers show rows and every one of them already joins `users`, so the
// flag costs a column rather than a join. What it does NOT cost is seven
// different opinions about what a house row looks like - this function is the
// only one, and every reader calls it.
//
// THE FLAG COMES FROM THE DATABASE, THE WORDS COME FROM THE CODE. is_house is
// the fact; the persona name and the method line are copy, and copy belongs in
// a diff a human reads. The join between them is the handle.
//
// A HOUSE ROW ON A GAME ITS PERSONA DOES NOT PLAY CANNOT HAPPEN (ruling R1) -
// no entry is filed, so no row exists. If one ever appears anyway, methodLine
// returns null and the row renders as the house with no method rather than
// with a method it does not have.

import { personaByHandle, methodLine } from './personas.js';

/**
 * @param {object} row   anything carrying a raw handle and the is_house flag
 * @param {string} game  'daily' | 'pickem' | 'weekly' | 'draft'
 * @returns {{house: boolean, persona: string|null, personaName: string|null, method: string|null}}
 */
export function houseMark({ isHouse = false, handle = null } = {}, game = null) {
  if (!isHouse) return { house: false, persona: null, personaName: null, method: null };
  const p = personaByHandle(handle);
  return {
    house: true,
    persona: p?.key ?? null,
    personaName: p?.name ?? null,
    method: p && game ? methodLine(p.key, game) : null,
  };
}

/** Spread the mark onto a row. The shape every reader returns. */
export function withHouse(row, { isHouse = false, handle = null } = {}, game = null) {
  return { ...row, ...houseMark({ isHouse, handle }, game) };
}

/**
 * ELAPSED, WHERE A BOARD EVER SHOWS IT.
 *
 * A house Daily run is filed by a cron that starts and submits in the same
 * tick, so its elapsed is a second or two. That is true and it is also
 * meaningless - the house did not play fast, it did not play at all in the
 * sense the number is measuring - so a leaderboard that shows elapsed shows a
 * dash for a house row instead.
 *
 * NO LEADERBOARD SHOWS ELAPSED TODAY. Checked: the Daily's three boards render
 * rank, handle and score, and the only elapsed in the tree is the player's own
 * receipt clock in components/daily/season/SeasonBoard.js, which no house row
 * reaches. This exists so the rule is written down where the next person to
 * add an elapsed column will find it, and a test pins it.
 */
export function houseElapsed(row, elapsed) {
  return row?.house ? '-' : elapsed;
}
