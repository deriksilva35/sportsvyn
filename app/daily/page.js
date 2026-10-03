/**
 * /daily - RETIRED (sat-5 Y1). v1 of The Daily (six slots, drop worst, a
 * season/week guess) is no longer played; The Daily is the season board at
 * /daily/board. This path answers one 308 there.
 *
 * WHY HERE AND NOT proxy.js. lib/retired.js matches a key AND EVERY PATH
 * BENEATH IT, so '/daily' there would also catch /daily/board and
 * /daily/leaderboards, the live game. Widening the proxy matcher widens the
 * admin gate's reach too. A route-level permanentRedirect is the narrow tool:
 * it touches this one path and nothing under it.
 *
 * THE QUERY IS DROPPED. Anything on a v1 URL addressed v1, and v2's board
 * reads its own params (?season= is a practice board) - passing a stale one
 * through could open the wrong board. Pinned by app/daily/v1Retired.test.mjs.
 *
 * THE DATA STAYS. puzzle_days and puzzle_entries are history: no table is
 * dropped and no row deleted. The v1 cron (/api/cron/daily-puzzle) is
 * unscheduled; its route stays, Bearer-gated, like the data it wrote.
 */

import { permanentRedirect } from 'next/navigation';
import { DAILY_V2_PATH } from '@/lib/daily/boardShape';

export const dynamic = 'force-dynamic';

export default function DailyV1Retired() {
  permanentRedirect(DAILY_V2_PATH);
}
