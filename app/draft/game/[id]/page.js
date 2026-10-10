/**
 * /draft/game/[id] - one game's draft room (thu-3 S1).
 *
 * The room is read (and its clock swept) server-side on every render
 * (lib/draftGame/room.js readRoom); the client island only shows it, sends a
 * pick and refreshes when the clock runs out.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import Wordmark from '@/components/gridiron/Wordmark';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import StandaloneDate from '@/components/StandaloneDate';
import { resolveShellMode, simViewport } from '@/lib/shell/shell';
import { requireSignInInShell } from '@/lib/shell/signedOut';
import { shellSigninHref } from '@/lib/shell/signinHref';
import { readRoom } from '@/lib/draftGame/room';
import { COPY } from '@/lib/draftGame/rules';
import GameDraftRoom from '@/components/draftGame/GameDraftRoom';
import StartGameDraft from '@/components/draftGame/StartGameDraft';
import '../../../daily/daily.css';
import '../../draft.css';
import '../game.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Draft one game - Sportsvyn', robots: { index: false } };

export async function generateViewport() {
  return simViewport(await resolveShellMode());
}

export default async function GameDraftRoomPage({ params }) {
  const { id } = await params;
  if (!/^\d+$/.test(String(id))) notFound();
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const isShell = await resolveShellMode();
  requireSignInInShell({ isShell, userId, dest: `/draft/game/${id}` });
  const r = await readRoom(userId, Number(id));
  if (!r.ok) notFound();
  const v = r.view;

  return (
    <div className="daily-shell">
      <GlobalHeaderServer activeNav="daily" />
      <div className="weekly" data-surface="ink">
        <header className="daily-head">
          <Wordmark href="/" />
          <span className="tag">The <b>Draft</b></span>
        </header>
        <main className="daily-main">
          <Link className="appcrumb" href="/draft/game">&larr; All games</Link>
          <section className="dgm-room-hd">
            <div className="dgm-match dgm-match--big"><b>{v.away}</b> <span className="dgm-at">@</span> <b>{v.home}</b></div>
            <div className="dgm-kick">Locks at kickoff · <StandaloneDate iso={v.kickoffAt} /></div>
          </section>
          {v.started ? (
            <GameDraftRoom view={v} />
          ) : v.locked ? (
            <p className="dgm-empty">This game has kicked off. The draft is closed.</p>
          ) : userId == null ? (
            <a className="dgm-btn" href={shellSigninHref(`/draft/game/${id}`, isShell)}>Sign in to draft</a>
          ) : (
            <div className="dgm-startbox">
              <p className="dgm-sub">{COPY.listSub}</p>
              <StartGameDraft contestId={v.contestId} />
            </div>
          )}
          <p className="dgm-foot">{COPY.poolFoot}</p>
        </main>
      </div>
    </div>
  );
}
