/**
 * /epl-weekly-5 - EPL Weekly 5: five Premier League players a gameweek.
 *
 * NEVER A 404 FOR "NO GAMEWEEK YET" (the house contract): before the first
 * gameweek opens the page says so. ?gw=N shows that gameweek (a final a reader
 * wants to look back at); without it the page shows the one in play, else the
 * one open for picks, else the latest (lib/eplWeekly5/create.js).
 *
 * SIGN-IN LAW: signed-out sees the pool and the rules read-only, with the
 * sign-in door where the picks would be.
 */

import Link from 'next/link';
import { auth } from '@/auth';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import { resolveShellMode } from '@/lib/shell/shell';
import { shellSigninHref } from '@/lib/shell/signinHref';
import { currentGameweek, gameweek } from '@/lib/eplWeekly5/create';
import { epl5View } from '@/lib/eplWeekly5/entry';
import { GAME_NAME, roundShort } from '@/lib/eplWeekly5/rules';
import EplWeekly5Card from '@/components/eplWeekly5/EplWeekly5Card';
import './eplWeekly5.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: `${GAME_NAME} - Sportsvyn`, description: 'Five Premier League players a gameweek. Each pick locks at its kickoff.' };

export default async function EplWeekly5Page({ searchParams }) {
  const q = await searchParams;
  const session = await auth();
  const uid = session?.user?.id ?? null;
  const shell = await resolveShellMode();
  const signinHref = shellSigninHref('/epl-weekly-5', shell?.isShell ?? false);
  const now = new Date();

  const gw = Number(q?.gw);
  const current = await currentGameweek({ now }).catch(() => null);
  const contest = Number.isInteger(gw) && gw > 0 && current
    ? (await gameweek(current.season_year, gw).catch(() => null)) ?? current
    : current;
  const view = contest ? await epl5View(uid == null ? null : Number(uid), contest, { now }).catch(() => null) : null;
  const other = view && current && contest && current.id !== contest.id ? current : null;

  return (
    <div className="gi e5page" data-surface="ink">
      <GlobalHeaderServer activeNav="games" />
      <div className="e5-wrap">
        <div className="e5-top">
          <Link href="/games" aria-label="Back to Games">&larr;</Link>
          <span>{GAME_NAME.toUpperCase()}{view ? ` · ${view.contest.label.toUpperCase()}` : ''}</span>
          {view && view.phase !== 'pick' ? <Link className="r" href={`/epl-weekly-5/board?gw=${view.contest.week}`}>Board &rsaquo;</Link> : null}
        </div>
        {other ? <p className="e5-other"><Link href="/epl-weekly-5">Back to {roundShort(other.week)} &rsaquo;</Link></p> : null}
        {!view ? (
          <p className="e5-none">
            {GAME_NAME} opens with the next Premier League gameweek. Five players, at most two from
            one club, each locking at its own kickoff.
          </p>
        ) : (
          <EplWeekly5Card view={view} signedIn={uid != null} signinHref={signinHref}
            boardHref={`/epl-weekly-5/board?gw=${view.contest.week}`} />
        )}
        {view && view.contest.week > 1 && view.phase !== 'final' ? (
          <p className="e5-prev"><Link href={`/epl-weekly-5?gw=${view.contest.week - 1}`}>Last gameweek&apos;s result &rsaquo;</Link></p>
        ) : null}
      </div>
      <SiteFooter />
    </div>
  );
}
