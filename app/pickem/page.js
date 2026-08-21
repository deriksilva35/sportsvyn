/**
 * /pickem - the living board. Contract: draftvyn-pickem-entry-mock-v0_1,
 * AMENDED by the per-game-lock ruling: frames 1 and 2 are ONE page - each
 * game seals at its own kickoff, so the board is tappable and grading at
 * once all Saturday. Frame 3 is the settled receipt.
 *
 * NEVER A 404. No contest, or a contest not yet open, renders the ghost
 * grammar with the derived first-lock line - the same page a lobby tap
 * lands on the Monday before board 1 exists.
 *
 * SIGN-IN LAW: shell signed-out rides to the sign-in form with this
 * destination; WEB signed-out sees the board read-only (games are public
 * schedule facts) with one sign-in primary where the savebar sits - no
 * picks leave or arrive without a session.
 *
 * SEALED PER-GAME: the payload carries the viewer's own picks and nothing
 * of anyone else's - lib/pickem/entry owns that wire, pinned by leak test.
 */

import Link from 'next/link';
import { auth } from '@/auth';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import { resolveShellMode, simViewport } from '@/lib/shell/shell';
import { requireSignInInShell } from '@/lib/shell/signedOut';
import { shellSigninHref } from '@/lib/shell/signinHref';
import { pickemBoardView } from '@/lib/pickem/entry';
import { firstLockLabel, FIRST_LOCK_FALLBACK } from '@/lib/pickem/read';
import PickemBoard from '@/components/pickem/PickemBoard';
import '../games/games.css';
import './pickem.css';

export const dynamic = 'force-dynamic';

export async function generateViewport({ searchParams }) {
  return simViewport(await resolveShellMode((await searchParams) ?? {}));
}

export const metadata = { title: "Pick 'em - Sportsvyn" };

export default async function PickemPage({ searchParams }) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const sp = (await searchParams) ?? {};
  const isShell = await resolveShellMode(sp);
  requireSignInInShell({ isShell, userId, dest: '/pickem' });

  const uid = userId == null ? null : Number(userId);
  const view = await pickemBoardView(uid).catch(() => ({ phase: 'preopen', contest: null, games: [] }));

  return (
    <>
      <GlobalHeaderServer activeNav="games" />
      <main className="lob pk-main" data-surface="ink">
        <Link className="appcrumb" href="/games">&larr; Games</Link>

        {view.phase === 'preopen' && <PreOpen />}

        {view.phase === 'living' && (
          <PickemBoard
            view={view}
            signedIn={uid != null}
            signinHref={shellSigninHref('/pickem', isShell)}
          />
        )}

        {view.phase === 'settled' && (
          <section className="pk-hero pk-receipt">
            <div className="pk-eb">
              <span>Pick&rsquo;em &mdash; settled</span>
              <span className="pk-mono">{view.contest.sport.toUpperCase()} &middot; {view.contest.gamesCount} games</span>
            </div>
            <h1>{view.record.wins}-{view.record.losses}.</h1>
            {/* The field facts (Relay 3): rank over settled scores, and the
                rarest correct pick - aggregate counts only, nobody's board. */}
            {view.receipt ? (
              <div className="pk-ctx">
                Board rank <b>{view.receipt.rank}</b> of {view.receipt.field}
                {view.receipt.best && (
                  <> &middot; best pick {view.receipt.best.name} ({view.receipt.best.pct}% of field)</>
                )}
              </div>
            ) : (
              <div className="pk-ctx">
                {view.progress.picked} picked &middot; {view.games.filter((g) => g.nopick).length} no-pick
              </div>
            )}
          </section>
        )}
      </main>
      <SiteFooter />
    </>
  );
}

async function PreOpen() {
  const when = await firstLockLabel().catch(() => FIRST_LOCK_FALLBACK);
  return (
    <section className="pk-ghost">
      <div className="big">Pick&rsquo;em lights up with the board</div>
      <div className="when">first lock &middot; {when}</div>
    </section>
  );
}
