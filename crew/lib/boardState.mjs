// crew/lib/boardState.mjs - board-state: the one line the Watcher's scheduler reads.
//
// PUBLIC BOARD (precise): a row of contests (the table that holds ONLY shared boards - Pick'em,
// Weekly, Draft, Draft game rooms, October, The Run, EPL Weekly 5; leagues' private drafts live in
// draft_configs / player_leagues, Survivor and the Daily in their own tables, and entries are
// per-user rows that are not read here) that is
//   OPENED   opens_at <= now()
//   OPEN     NOT settled
//   UNLOCKED locks_at IS NULL or locks_at > now()
// Output: `locks_in:<m>` if the soonest locks_at of those is within 120 minutes (m = whole
// minutes, 0-120), else `open` if any such board exists, else `closed`. Exit 0; on a setup error
// exit 2 and print NOTHING (stdout and stderr both empty) so a scheduler can never mistake an
// error line for a state.
import { parseArgs, requireReaderUrl } from './common.mjs';
import { query, num } from './db.mjs';

export const LOCK_SOON_MIN = 120;

/** PURE. openCount: public boards open now; minToLock: whole minutes to the soonest lock (null if none lock). */
export function decide({ openCount, minToLock }) {
  if (!(openCount > 0)) return 'closed';
  if (minToLock !== null && minToLock !== undefined && minToLock <= LOCK_SOON_MIN) return `locks_in:${Math.max(0, minToLock)}`;
  return 'open';
}

export const SQL = `SELECT count(*)::int AS open_count,
  floor(extract(epoch FROM (min(locks_at) - now())) / 60)::int AS min_to_lock
  FROM crew_stats.boards_v
 WHERE opens_at <= now() AND NOT settled AND (locks_at IS NULL OR locks_at > now())`;

/** Returns the state STRING; runCli prints it as the only line (summaryFn is identity). */
export async function main({ argv, env }) {
  parseArgs(argv, []);
  const [r] = await query(requireReaderUrl(env), SQL);
  return { lines: [], summary: decide({ openCount: num(r?.open_count) ?? 0, minToLock: num(r?.min_to_lock) }), code: 0 };
}
