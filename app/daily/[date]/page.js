/**
 * /daily/[date] - v1's reveal page, RETIRED (sat-5 Y1). Answers one 308 to
 * /daily/board, query dropped - see app/daily/page.js for the why.
 *
 * NOT /daily/board/[date]. A v1 date names a puzzle_days row, not a
 * daily_boards edition; the same date on the season board is a different
 * game, or no edition at all (a 404). The board is the honest landing.
 *
 * /daily/[date]/card STAYS. It is the PNG already embedded in every v1 share
 * preview that was posted; it reads only revealed v1 rows, which are history.
 * Redirecting an image to an HTML page would break those previews and gain
 * nothing.
 */

import { permanentRedirect } from 'next/navigation';
import { DAILY_V2_PATH } from '@/lib/daily/boardShape';

export const dynamic = 'force-dynamic';

export default function DailyV1RevealRetired() {
  permanentRedirect(DAILY_V2_PATH);
}
