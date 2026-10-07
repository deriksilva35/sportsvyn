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
 * NON-MEMBERS GET A 404, AND NOTHING ELSE (ruling sun-12 item 8). Signed out,
 * signed in but not a member, or an id that was never issued: all three call
 * notFound(), and ./not-found.js renders the sign-in prompt or "This league is
 * private" - the same body and the same status for "not yours" and "does not
 * exist", because the id in this URL is serial and a probe must not learn which
 * ids are leagues. Not the name, not the member count, not the games: nothing
 * is read for a non-member at all. generateMetadata follows the same rule. The
 * invite link (/j/<key>) still shows the name - holding it is the invitation.
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
import { leagueDetail } from '@/lib/leagues/core';
import { parseLeagueTab, leagueHref } from '@/lib/leagues/nav';
import { leagueTable } from '@/lib/leagues/table';
import LeagueBoard from '@/components/leagues/LeagueBoard';
import '../../games/games.css';
import '../leagues.css';
import '../leaguesV1.css';
import '../leagueBoard.css';
import '../pickFormat.css';

export const dynamic = 'force-dynamic';

export async function generateViewport() {
  return simViewport(await resolveShellMode());
}

// THE TITLE IS A MEMBER'S. A non-member's tab, unfurl and search snippet read
// the generic title - the name only ever comes from the member-scoped reader.
// Never indexed: a league is private either way.
const LEAGUE_ROBOTS = Object.freeze({ index: false, follow: false });
const GENERIC_TITLE = 'Leagues - Sportsvyn';

export async function generateMetadata({ params }) {
  const { id } = await params;
  const leagueId = Number(id);
  const session = await auth().catch(() => null);
  const uid = session?.user?.id == null ? null : Number(session.user.id);
  const lg = uid == null || !Number.isInteger(leagueId)
    ? null
    : await leagueDetail(leagueId, uid).catch(() => null);
  return { title: lg ? `${lg.name} - Leagues - Sportsvyn` : GENERIC_TITLE, robots: LEAGUE_ROBOTS };
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

  // ---- NON-MEMBER, SIGNED OUT, OR NO SUCH LEAGUE: one 404 ---------------
  // Nothing about the league is read on this path - ./not-found.js is the body.
  if (!league) notFound();

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
