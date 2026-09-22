/**
 * /october - the five-a-day card, frames 1 and 2 of the mock.
 *
 * NEVER A 404 FOR "NO DAY YET", the house contract: before the bracket is set
 * this page says so rather than disappearing.
 *
 * SIGN-IN LAW, unchanged: signed-out sees the card read-only - the slate, the
 * pool and the scoring are public facts - with one sign-in primary where the
 * picks would be.
 */

import Link from 'next/link';
import { auth } from '@/auth';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import { resolveShellMode } from '@/lib/shell/shell';
import { shellSigninHref } from '@/lib/shell/signinHref';
import { currentOctoberDay } from '@/lib/october/create';
import { octoberView } from '@/lib/october/entry';
import OctoberCard from '@/components/october/OctoberCard';
import '../games/games.css';
import './october.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'October · five-a-day - Sportsvyn' };

export default async function OctoberPage() {
  const session = await auth();
  const uid = session?.user?.id ?? null;
  const shell = await resolveShellMode();
  const signinHref = shellSigninHref('/october', shell?.isShell ?? false);

  const contest = await currentOctoberDay({ now: new Date() }).catch(() => null);
  const view = contest
    ? await octoberView(uid == null ? null : Number(uid), contest, { now: new Date() }).catch(() => null)
    : null;

  return (
    <div className="gi ocpage" data-surface="ink">
      <GlobalHeaderServer activeNav="games" />
      <div className="oc-wrap">
        <div className="oc-crumb">
          <Link href="/mlb/bracket">&#8249; Bracket</Link>
          {view ? <Link className="r" href="/october/board">Standings &#8250;</Link> : null}
        </div>
        {!view ? (
          <p className="oc-none">
            October has not started. The first card goes up when the Wild Card
            field is set, and locks at the first pitch of the day.
          </p>
        ) : (
          <OctoberCard view={view} signedIn={uid != null} signinHref={signinHref} />
        )}
      </div>
      <SiteFooter />
    </div>
  );
}
