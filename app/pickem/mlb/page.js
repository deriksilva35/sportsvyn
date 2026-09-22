/**
 * /pickem/mlb - the postseason round board.
 *
 * A STATIC SEGMENT, NOT A BRANCH INSIDE /pickem/[sport]. Next resolves
 * `/pickem/mlb` here before it ever reaches the dynamic segment, so the two
 * football boards' page - which carries a sport switch, a leaderboard, a
 * season percentage and a per-game save bar, none of which mean anything for
 * a round of series - is not touched by this relay at all. The sibling law,
 * applied to a route.
 *
 * NEVER A 404 FOR "NO BOARD YET", the same contract the football route has:
 * before the bracket is set this page says so.
 *
 * SIGN-IN LAW, unchanged: signed-out sees the board read-only (the bracket is
 * a public fact) with one sign-in primary where the picks would be.
 */

import Link from 'next/link';
import { auth } from '@/auth';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import StandaloneDate from '@/components/StandaloneDate';
import { resolveShellMode } from '@/lib/shell/shell';
import { shellSigninHref } from '@/lib/shell/signinHref';
import { seriesBoardView } from '@/lib/mlb/seriesPickem';
import SeriesBoard from '@/components/pickem/SeriesBoard';
import '../../games/games.css';
import '../pickem.css';
import './series.css';

export const dynamic = 'force-dynamic';

export const metadata = { title: "Pick'em MLB - Sportsvyn" };

export default async function MlbPickemPage() {
  const session = await auth();
  const uid = session?.user?.id ?? null;
  const shell = await resolveShellMode();
  const signinHref = shellSigninHref('/pickem/mlb', shell?.isShell ?? false);

  const v = await seriesBoardView(uid == null ? null : Number(uid), { now: new Date() })
    .catch(() => ({ phase: 'preopen', contest: null, rows: [] }));

  return (
    <div className="gi sbpage" data-surface="ink">
      <GlobalHeaderServer activeNav="games" />
      <div className="sb-wrap">
        <div className="sb-crumb">
          <Link href="/mlb/bracket">&#8249; Bracket</Link>
        </div>
        <header className="sb-title">
          <h1>Postseason Pick&apos;em</h1>
          <div className="sb-tsub">
            Pick the club that comes out of every series. Wild Card 1 point,
            Division 2, Championship 3, World Series 4.
          </div>
        </header>

        {!v.contest ? (
          /* THE HONEST GAP. No board is not an error and not a 404 - the
             bracket simply is not set yet, and saying the day is more use
             than an empty frame. */
          <p className="sb-none">
            No round is open yet. The first board goes up when the Wild Card
            field is set.
          </p>
        ) : (
          <>
            <div className="sb-lock">
              {v.phase === 'settled'
                ? <>Graded · <b>{v.score ?? 0}</b> of {v.contest.maxPoints}</>
                : <>Locks at first pitch · <StandaloneDate iso={v.contest.locksAt} /></>}
            </div>
            <SeriesBoard
              contest={{ ...v.contest, phase: v.phase, made: v.made, total: v.total, score: v.score }}
              rows={v.rows}
              signedIn={uid != null}
              signinHref={signinHref}
            />
          </>
        )}
      </div>
      <SiteFooter />
    </div>
  );
}
