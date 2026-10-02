// lib/leagues/boardScope.js - ?league=<id> on a board, resolved for ONE reader.
//
// The rule every league-filtered board follows (BoardPage, /october/board,
// /run/board): the chips are the reader's own leagues, ?league= can only ever
// pick one of them, and anything else - signed out, a guessed id, a league the
// reader is not in - is the national board (memberIds null). A non-member never
// learns who is in a private league by putting its id in a URL.
//
// memberIds is sorted numbers; an EMPTY array (the member read failed) is an
// empty league board, never the nation - the house rule, lib/leagues/core.test.

import { myLeagues, leagueMemberIds } from './core.js';
import { pickLeague } from '../boards/view.js';

export async function boardScope(uid, wanted = null) {
  const leagues = uid == null ? [] : await myLeagues(Number(uid)).catch(() => []);
  const picked = pickLeague(leagues, wanted);
  const memberIds = picked
    ? (await leagueMemberIds(picked.id).catch(() => [])).map(Number).sort((a, b) => a - b)
    : null;
  return { leagues, picked, memberIds };
}
