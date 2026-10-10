/**
 * /draft/game - the per-game Draft's list of open games (S1, to the fri-1 mock in S2).
 *
 * "Draft one game." and its subline, then one group per ET game day under a
 * lime chip "NFL · Sunday · N of M drafted", one row per game: the matchup bold,
 * the kickoff in the reader's zone under it, and a pill on the right - "Draft"
 * (filled) or "Your draft" (outline) once the reader has a room.
 */

import Link from 'next/link';
import { auth } from '@/auth';
import Wordmark from '@/components/gridiron/Wordmark';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import StandaloneTime from '@/components/StandaloneTime';
import { resolveShellMode, simViewport } from '@/lib/shell/shell';
import { requireSignInInShell } from '@/lib/shell/signedOut';
import { shellSigninHref } from '@/lib/shell/signinHref';
import { listOpenBoards } from '@/lib/draftGame/room';
import { COPY, groupByDay, dayChip } from '@/lib/draftGame/rules';
import StartGameDraft from '@/components/draftGame/StartGameDraft';
import '../../daily/daily.css';
import '../draft.css';
import './game.css';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Draft one game - Sportsvyn',
  description: COPY.listSub,
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
  const days = groupByDay(boards);

  return (
    <div className="daily-shell">
      <GlobalHeaderServer activeNav="daily" />
      <div className="weekly" data-surface="ink">
        <header className="daily-head">
          <Wordmark href="/" />
          <span className="tag">The <b>Draft</b></span>
        </header>
        <main className="daily-main dgm">
          <Link className="appcrumb" href="/games">&larr; Games</Link>
          <h1 className="dgm-title">{COPY.listTitle}</h1>
          <p className="dgm-sub">{COPY.listSub}</p>
          {days.length === 0 ? (
            <p className="dgm-empty" data-draft-game-empty>No games open to draft right now. Boards open three days before kickoff.</p>
          ) : days.map((d) => (
            <section key={d.dayKey} className="dgm-day" data-draft-game-day={d.dayKey}>
              <span className="dgm-chip">{dayChip('nfl', d.day, d.boards.filter((b) => b.started).length, d.boards.length)}</span>
              <ul className="dgm-list" data-draft-game-list>
                {d.boards.map((b) => (
                  <li key={b.contestId} className="dgm-row">
                    <div className="dgm-row-main">
                      <div className="dgm-match"><b>{b.away} @ {b.home}</b></div>
                      <div className="dgm-kick"><StandaloneTime iso={b.kickoffAt} /></div>
                    </div>
                    {userId == null ? (
                      <a className="dgm-pill" href={shellSigninHref('/draft/game', isShell)}>Draft</a>
                    ) : b.started ? (
                      <Link className="dgm-pill dgm-pill--outline" href={`/draft/game/${b.contestId}`}>Your draft</Link>
                    ) : (
                      <StartGameDraft contestId={b.contestId} />
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <p className="dgm-foot">{COPY.poolFoot}</p>
        </main>
      </div>
    </div>
  );
}
