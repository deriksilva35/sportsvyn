/**
 * /draft/game - the per-game Draft's list of open games (thu-3 S1).
 *
 * One card per open board (lib/draftGame/room.js listOpenBoards): the game, its
 * kickoff, and the reader's state in it. Not linked from the lobby yet - S2
 * adds the lobby row and the game-page entry once boards settle.
 */

import Link from 'next/link';
import { auth } from '@/auth';
import Wordmark from '@/components/gridiron/Wordmark';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import StandaloneDate from '@/components/StandaloneDate';
import { resolveShellMode, simViewport } from '@/lib/shell/shell';
import { requireSignInInShell } from '@/lib/shell/signedOut';
import { shellSigninHref } from '@/lib/shell/signinHref';
import { listOpenBoards } from '@/lib/draftGame/room';
import { COPY, ROUNDS } from '@/lib/draftGame/rules';
import StartGameDraft from '@/components/draftGame/StartGameDraft';
import '../../daily/daily.css';
import '../draft.css';
import './game.css';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Draft one game - Sportsvyn',
  description: COPY.listSub,
  robots: { index: false },
};

export async function generateViewport() {
  return simViewport(await resolveShellMode());
}

export default async function GameDraftList() {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const isShell = await resolveShellMode();
  requireSignInInShell({ isShell, userId, dest: '/draft/game' });
  const boards = await listOpenBoards(userId).catch(() => []);

  return (
    <div className="daily-shell">
      <GlobalHeaderServer activeNav="daily" />
      <div className="weekly" data-surface="ink">
        <header className="daily-head">
          <Wordmark href="/" />
          <span className="tag">The <b>Draft</b></span>
        </header>
        <main className="daily-main">
          <Link className="appcrumb" href="/games">&larr; Games</Link>
          <section className="hero">
            <h1 className="dgm-title">{COPY.listTitle}</h1>
            <p className="dgm-sub">{COPY.listSub}</p>
          </section>
          {boards.length === 0 ? (
            <p className="dgm-empty" data-draft-game-empty>No games open to draft right now. Boards open three days before kickoff.</p>
          ) : (
            <ul className="dgm-list" data-draft-game-list>
              {boards.map((b) => (
                <li key={b.contestId} className="dgm-card">
                  <div className="dgm-match">
                    <b>{b.away}</b> <span className="dgm-at">@</span> <b>{b.home}</b>
                  </div>
                  <div className="dgm-kick"><StandaloneDate iso={b.kickoffAt} /></div>
                  {userId == null ? (
                    <a className="dgm-btn" href={shellSigninHref('/draft/game', isShell)}>Sign in to draft</a>
                  ) : b.started ? (
                    <Link className="dgm-btn" href={`/draft/game/${b.contestId}`}>
                      {b.picks >= ROUNDS ? 'Your team' : `Resume · ${b.picks} of ${ROUNDS} picked`}
                    </Link>
                  ) : (
                    <StartGameDraft contestId={b.contestId} />
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="dgm-foot">{COPY.poolFoot}</p>
        </main>
      </div>
    </div>
  );
}
