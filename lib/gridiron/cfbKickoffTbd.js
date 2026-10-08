// lib/gridiron/cfbKickoffTbd.js - a CFB kickoff nobody has set yet (wed-6). PURE.
//
// CFBD says so two ways: `startTimeTBD: true`, or - like BDL's MLB feed - a
// startDate at exactly MIDNIGHT EASTERN, the date with no time. On 8 Oct 41
// games between 12 and 28 Oct sat at that placeholder with no flag, so they
// locked at 00:00 ET and took the top default confidence rank. Either signal
// now stores matches.metadata.kickoff_tbd = true, and the MLB machinery
// (lib/mlb/kickoffTbd.js isGameLocked, kickoffTimeLabel's "Time TBD") does the
// rest. The flag is recomputed on EVERY sync, so it clears itself the tick the
// real time posts.
//
// THE COST, ACKNOWLEDGED: a real 6 PM HST Hawaii kickoff is 00:00 EDT and is
// read as TBD. It then never locks on the clock - it stays pickable until the
// live feed moves its status off 'scheduled', a few minutes at most.

import { isPlaceholderKickoff } from '../mlb/kickoffTbd.js';

/** @param {{startTimeTBD?: boolean, kickoffAt?: any}} g */
export function cfbKickoffTbd({ startTimeTBD, kickoffAt } = {}) {
  return startTimeTBD === true || isPlaceholderKickoff(kickoffAt);
}
