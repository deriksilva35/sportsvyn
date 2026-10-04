/**
 * /six - TONIGHT'S SIX: six NBA players a night, G G F F C UTIL.
 *
 * NEVER A 404 FOR "NO CARD TONIGHT", the house contract: a night with no NBA
 * games says so. Signed-out sees the card read-only - the slate, the pool and
 * the scoring are public facts - with one sign-in primary where the picks
 * would be.
 */

import Link from 'next/link';
import { auth } from '@/auth';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import LiveRefresh from '@/components/scores/LiveRefresh';
import { resolveShellMode } from '@/lib/shell/shell';
import { shellSigninHref } from '@/lib/shell/signinHref';
import { currentSixNight } from '@/lib/six/night';
import { sixView } from '@/lib/six/entry';
import SixCard from '@/components/six/SixCard';
import { ViewerTzProvider } from '@/components/time/ViewerTz';
import { readViewerTz } from '@/lib/gridiron/serverTz';
import '../games/games.css';
import './six.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: "Tonight's Six · NBA - Sportsvyn" };

export default async function SixPage() {
  const session = await auth();
  const uid = session?.user?.id ?? null;
  const shell = await resolveShellMode();
  // The reader's zone (sv_tz): every tip time on the card paints in it.
  const tz = await readViewerTz();
  const signinHref = shellSigninHref('/six', shell?.isShell ?? false);
  const now = new Date();

  const contest = await currentSixNight({ now }).catch(() => null);
  const view = contest
    ? await sixView(uid == null ? null : Number(uid), contest, { now }).catch(() => null)
    : null;

  return (
    <div className="gi sxpage" data-surface="ink">
      <GlobalHeaderServer activeNav="games" />
      <div className="sx-wrap">
        <div className="sx-crumb">
          <Link href="/games">&#8249; Games</Link>
          <span className="sx-crumb-sep" aria-hidden="true">·</span>
          <Link href="/pickem/nba">NBA Pick&apos;em &#8250;</Link>
        </div>
        {!view ? (
          <p className="sx-none">
            No NBA games tonight, so no card. Tonight&apos;s Six opens at 6 AM ET on
            every night the NBA plays.
          </p>
        ) : (
          <>
            <ViewerTzProvider tz={tz}>
              <SixCard view={view} signedIn={uid != null} signinHref={signinHref} />
            </ViewerTzProvider>
            {view.anyLive ? <LiveRefresh everyMs={60_000} /> : null}
          </>
        )}
      </div>
      <SiteFooter />
    </div>
  );
}
