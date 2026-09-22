/**
 * /run - the nine, frames 1 and 2 of the mock.
 *
 * NEVER A 404 FOR "NO ROUND YET": before the bracket is set this page says so.
 * SIGN-IN LAW: signed-out sees the roster read-only - the clubs, the pool and
 * the scoring are public facts - with one sign-in primary where the picks go.
 */

import Link from 'next/link';
import { auth } from '@/auth';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import { resolveShellMode } from '@/lib/shell/shell';
import { shellSigninHref } from '@/lib/shell/signinHref';
import { currentRunRound } from '@/lib/run/create';
import { runView } from '@/lib/run/entry';
import { myLeagues } from '@/lib/leagues/core';
import RunRoster from '@/components/run/RunRoster';
import '../games/games.css';
import './run.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'The Run - Sportsvyn' };

export default async function RunPage() {
  const session = await auth();
  const uid = session?.user?.id ?? null;
  const shell = await resolveShellMode();
  const signinHref = shellSigninHref('/run', shell?.isShell ?? false);

  const contest = await currentRunRound({ now: new Date() }).catch(() => null);
  const [view, leagues] = await Promise.all([
    contest ? runView(uid == null ? null : Number(uid), contest, { now: new Date() }).catch(() => null) : null,
    uid == null ? [] : myLeagues(Number(uid)).catch(() => []),
  ]);
  const leagueLine = leagues.length ? `${leagues[0].name}` : null;

  return (
    <div className="gi rnpage" data-surface="ink">
      <GlobalHeaderServer activeNav="games" />
      <div className="rn-wrap">
        <div className="rn-crumb">
          <Link href="/mlb/bracket">&#8249; Bracket</Link>
          {view ? <Link className="r" href="/run/board">League board &#8250;</Link> : null}
        </div>
        {!view ? (
          <p className="rn-none">
            The Run has not started. Round 1 opens with the Wild Card field and
            locks at the first pitch of the round.
          </p>
        ) : (
          <RunRoster view={view} signedIn={uid != null} signinHref={signinHref} leagueLine={leagueLine} />
        )}
      </div>
      <SiteFooter />
    </div>
  );
}
