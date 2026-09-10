/**
 * /pickem/nfl, /pickem/cfb - the living board, one sport at a time (relay 2c
 * item 6). Everything below is app/pickem/page.js's own contract, unchanged:
 * frames 1 and 2 are ONE page (each game seals at its own kickoff), frame 3
 * is the settled receipt, and NEVER A 404 for "no board yet" - only an
 * unknown SPORT segment 404s, not an unopened board.
 *
 * SIGN-IN LAW: shell signed-out rides to the sign-in form with THIS sport's
 * own destination; WEB signed-out sees the board read-only (games are public
 * schedule facts) with one sign-in primary where the savebar sits - no picks
 * leave or arrive without a session.
 *
 * SEALED PER-GAME: the payload carries the viewer's own picks and nothing of
 * anyone else's - lib/pickem/entry owns that wire, pinned by leak test.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import { resolveShellMode, simViewport } from '@/lib/shell/shell';
import { requireSignInInShell } from '@/lib/shell/signedOut';
import { shellSigninHref } from '@/lib/shell/signinHref';
import { pickemBoardView, PICKEM_SPORTS } from '@/lib/pickem/entry';
import { boardPlan } from '@/lib/pickem/create';
import { plannedBoardNumberFor } from '@/lib/pickem/sequence';
import { sql } from '@/lib/db';
import PickemBoard from '@/components/pickem/PickemBoard';
import PickemGrade from '@/components/pickem/PickemGrade';
import { GAME_NAMES } from '@/lib/games/lobby';
import { pickemBoardLeaderboard } from '@/lib/games/leaderboard';
import { userHasHandle } from '@/lib/onboarding';
import StandaloneDate from '@/components/StandaloneDate';
import StandaloneDateOnly from '@/components/StandaloneDateOnly';
import '../../games/games.css';
import '../pickem.css';
import '@/components/games/grade.css';

// ONE TIME ZONE PER SCREEN (relay 3b item 2) - see app/weekly/page.js. Every
// clock this page renders goes through StandaloneDate/StandaloneTime.

export const dynamic = 'force-dynamic';

export async function generateViewport() {
  return simViewport(await resolveShellMode());
}

export async function generateMetadata({ params }) {
  const { sport } = await params;
  if (!PICKEM_SPORTS.includes(sport)) return { title: `${GAME_NAMES.pickem} - Sportsvyn` };
  return { title: `${GAME_NAMES.pickem} ${sport.toUpperCase()} - Sportsvyn` };
}

export default async function PickemSportPage({ params, searchParams }) {
  const { sport } = await params;
  // THE ONLY TWO SPORTS THIS BOARD KNOWS (relay 2c item 6) - a third
  // segment 404s rather than silently rendering an empty/global board.
  if (!PICKEM_SPORTS.includes(sport)) notFound();

  const session = await auth();
  const userId = session?.user?.id ?? null;
  const sp = (await searchParams) ?? {};
  const isShell = await resolveShellMode();
  const dest = `/pickem/${sport}`;
  requireSignInInShell({ isShell, userId, dest });

  const uid = userId == null ? null : Number(userId);
  const now = new Date();
  const view = await pickemBoardView(uid, { sport, now }).catch(() => ({ phase: 'preopen', contest: null, games: [] }));
  const hasHandle = await userHasHandle(uid, sql);

  return (
    <>
      <GlobalHeaderServer activeNav="games" />
      <main className="lob pk-main" data-surface="ink">
        <Link className="appcrumb" href="/games">&larr; Games</Link>

        {view.phase === 'preopen' && <PreOpen sport={sport} now={now} />}

        {view.phase === 'living' && (
          <PickemBoard
            view={view}
            signedIn={uid != null}
            signinHref={shellSigninHref(dest, isShell)}
            hasHandle={hasHandle}
            initialConfirmedAt={view.confirmedAt ?? null}
            locksAt={view.contest.locksAt}
          />
        )}

        {view.phase === 'settled' && (
          <PickemSettled sport={sport} view={view} uid={uid} now={now} />
        )}
      </main>
      <SiteFooter />
    </>
  );
}

/**
 * THE GRADE CARD (relay 2b item 4). The field facts view.receipt already
 * carried (rank, rarest correct pick) stay untouched below the fold as the
 * old receipt's own summary line - the grade card is the new, full
 * per-game verdict treatment, not a replacement for a fact receiptFor()
 * already computes correctly.
 */
async function PickemSettled({ sport, view, uid, now }) {
  const leaderboard = await pickemBoardLeaderboard(view.contest.id, uid, { limit: 5 });
  // NULL WHEN THE NEXT BOARD ALREADY EXISTS (relay 4 item 2). boardPlan now
  // refuses to plan a board that is already in the table, so this line
  // stops advertising an opening for a board a reader could already play -
  // which is what it was doing on PROD, under a settled board's grade card.
  const { plan: nextPlan } = await boardPlan({ leagueSlug: sport, now }).catch(() => ({ plan: null }));
  const next = nextPlan ? { opensAt: nextPlan.opensAt } : null;
  const nextNumber = nextPlan
    ? await plannedBoardNumberFor({ sport, locksAt: nextPlan.locksAt })
    : null;
  return (
    <>
      <PickemGrade
        view={view} sport={sport} settledAtIso={view.contest.settledAt}
        leaderboard={leaderboard} next={next} nextBoardNumber={nextNumber}
        userId={uid}
      />
      {view.receipt?.best && (
        <div className="gg-mathline">
          Rarest correct pick: {view.receipt.best.name} ({view.receipt.best.pct}% of field).
        </div>
      )}
    </>
  );
}

/**
 * THE GHOST DERIVES FROM THE SCHEDULE, NOT A STATIC LINE (relay 2c-fix
 * item 1) - boardPlan() is the exact read-only half of the creation the
 * cron will eventually run, so "Board {n} opens ... first lock ..." can
 * never disagree with what actually gets created. Board number uses the
 * same per-sport formula ensurePickemBoard() applies at creation and
 * lib/games/read.js's own lobby-row ghost already uses: 1 + the count of
 * this sport's pickem contests that opened earlier. Nothing renders at all
 * when boardPlan() itself finds nothing (no upcoming games for this sport
 * whatsoever) - no chip may claim knowledge it doesn't have.
 */
async function PreOpen({ sport, now }) {
  const { plan } = await boardPlan({ leagueSlug: sport, now }).catch(() => ({ plan: null }));
  if (!plan) {
    return (
      <section className="pk-ghost">
        <div className="big">Pick&rsquo;em lights up with the board</div>
      </section>
    );
  }
  const n = await plannedBoardNumberFor({ sport, locksAt: plan.locksAt });
  return (
    <section className="pk-ghost">
      <div className="big">Pick&rsquo;em lights up with the board</div>
      <div className="when">
        Board {n} opens <StandaloneDateOnly iso={plan.opensAt} /> &middot; first lock <StandaloneDate iso={plan.firstKickoff ?? plan.locksAt} />
      </div>
    </section>
  );
}
