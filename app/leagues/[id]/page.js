/**
 * /leagues/[id] - the league page (Leagues V1, canvas board League).
 *
 * MEMBERS get the board: the status kicker and INVITE, the three numbers, the
 * STANDINGS | THIS WEEK | MEMBERS rail (lib/leagues/nav - the scoresNav law,
 * so a link can open a tab) and the rule line. Every number is DERIVED by
 * lib/leagues/table.js from each game's own settled results - The Daily from
 * its live v2 runs (daily_board_runs), never the dead v1 puzzle_entries the
 * pre-V1 Daily tab read. ?invite=1 opens the share sheet (the create sheet
 * lands here with it up).
 *
 * NON-MEMBERS get the sealed preview: name, member count, the games, and a
 * field for the invite code - nothing else. No join by id: the id in this URL
 * is serial, so it is not an invitation - the code is. No identities, no
 * boards. Signed-out riders carry this exact destination through the sign-in
 * law.
 *
 * No ad-hoc entry SQL on this page (pinned by test): the readers are the
 * league modules'.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import { resolveShellMode, simViewport } from '@/lib/shell/shell';
import { requireSignInInShell } from '@/lib/shell/signedOut';
import { shellSigninHref } from '@/lib/shell/signinHref';
import { leagueDetail, leaguePreview } from '@/lib/leagues/core';
import { parseLeagueTab, leagueHref } from '@/lib/leagues/nav';
import { gameLabel } from '@/lib/leagues/settings';
import { leagueTable } from '@/lib/leagues/table';
import { JoinWithCodeForm } from '@/components/leagues/LeagueChrome';
import LeagueBoard from '@/components/leagues/LeagueBoard';
import '../../games/games.css';
import '../leagues.css';
import '../leaguesV1.css';
import '../leagueBoard.css';

export const dynamic = 'force-dynamic';

export async function generateViewport() {
  return simViewport(await resolveShellMode());
}

export async function generateMetadata({ params }) {
  const { id } = await params;
  const lg = await leaguePreview(Number(id)).catch(() => null);
  return { title: lg ? `${lg.name} - Leagues - Sportsvyn` : 'Leagues - Sportsvyn' };
}

export default async function LeaguePage({ params, searchParams }) {
  const { id } = await params;
  const leagueId = Number(id);
  if (!Number.isInteger(leagueId)) notFound();
  const sp = (await searchParams) ?? {};
  const tab = parseLeagueTab(sp);

  const session = await auth();
  const userId = session?.user?.id ?? null;
  const isShell = await resolveShellMode();
  const dest = leagueHref(leagueId, tab);
  requireSignInInShell({ isShell, userId, dest });

  const uid = userId == null ? null : Number(userId);
  const league = uid == null ? null : await leagueDetail(leagueId, uid).catch(() => null);

  // ---- NON-MEMBER (or signed-out web): the sealed preview -----------------
  if (!league) {
    const preview = await leaguePreview(leagueId).catch(() => null);
    if (!preview) notFound();
    return (
      <>
        <GlobalHeaderServer activeNav="leagues" />
        <main className="lob" data-surface="ink">
          <Link className="appcrumb" href="/leagues">&larr; Leagues</Link>
          <section className="lg-preview-hero">
            <div className="eb">You&rsquo;re invited</div>
            <h1 className="lg-hero-name">{preview.name}</h1>
            <p className="ctx">
              {preview.members} {preview.members === 1 ? 'member' : 'members'}
              {preview.games?.length ? <> &middot; {preview.games.map(gameLabel).join(', ')}</> : null}
            </p>
            {uid == null ? (
              <a className="lg-join-primary" href={shellSigninHref(dest, isShell)}>Sign in to join</a>
            ) : (
              <JoinWithCodeForm leagueId={leagueId} />
            )}
            <p className="muted lg-ask-code">Ask a member for the invite code.</p>
          </section>
          <p className="muted lg-hero-sub">
            Boards are members-only. Join and your next game counts.
          </p>
        </main>
        <SiteFooter />
      </>
    );
  }

  // ---- MEMBER: the board ----------------------------------------------------
  const table = await leagueTable(league).catch(() => null);
  return (
    <>
      <GlobalHeaderServer activeNav="leagues" />
      <main data-surface="ink">
        <div className="lv" style={{ paddingBottom: 0 }}>
          <Link className="lv-crumb" href="/leagues">&larr; Leagues</Link>
        </div>
        {table ? (
          <LeagueBoard league={league} table={table} uid={uid} tab={tab} openInvite={sp.invite === '1'} />
        ) : (
          <div className="lv"><p className="lv-empty">The table could not load. Pull to refresh.</p></div>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
