/**
 * /draft/game/[id] - one game's draft: room, then result (S1; to the fri-1 mock in S2).
 *
 * The room is read (and its clock swept) server-side on every render
 * (lib/draftGame/room.js readRoom), which also says the PHASE: pre, drafting,
 * waiting (your four are in), live, final, void. A navy header carries the
 * lime eyebrow - "SF @ SEA · SUN 1:05 PM PT" before kickoff, "SF @ SEA · LIVE
 * 14-10" / "FINAL 27-24" after - and the phase's title.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import Wordmark from '@/components/gridiron/Wordmark';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import StandaloneTime from '@/components/StandaloneTime';
import { resolveShellMode, simViewport } from '@/lib/shell/shell';
import { requireSignInInShell } from '@/lib/shell/signedOut';
import { shellSigninHref } from '@/lib/shell/signinHref';
import { readRoom } from '@/lib/draftGame/room';
import { COPY } from '@/lib/draftGame/rules';
import GameDraftRoom from '@/components/draftGame/GameDraftRoom';
import GameDraftResult from '@/components/draftGame/GameDraftResult';
import StartGameDraft from '@/components/draftGame/StartGameDraft';
import '../../../daily/daily.css';
import '../../draft.css';
import '../game.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Draft one game - Sportsvyn' };

export async function generateViewport() {
  return simViewport(await resolveShellMode());
}

function Eyebrow({ v }) {
  const match = `${v.away} @ ${v.home}`;
  if (v.phase === 'final') return <>{match} · FINAL {v.awayScore ?? 0}-{v.homeScore ?? 0}</>;
  if (v.phase === 'void') return <>{match} · OFF</>;
  if (v.phase === 'live') return <>{match} · {v.status === 'final' ? 'FINAL' : 'LIVE'} {v.awayScore ?? 0}-{v.homeScore ?? 0}</>;
  return <>{match} · <StandaloneTime iso={v.kickoffAt} weekday /></>;
}

const TITLE = { pre: 'Draft this game', waiting: 'Your four are in', void: 'This game was called off' };

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
  const scored = (v.phase === 'live' || v.phase === 'final') && v.result;
  const mine = v.seats.find((s) => s.you)?.picks ?? [];

  return (
    <div className="daily-shell">
      <GlobalHeaderServer activeNav="daily" />
      <div className="weekly" data-surface="ink">
        <header className="daily-head">
          <Wordmark href="/" />
          <span className="tag">The <b>Draft</b></span>
        </header>
        <main className="daily-main dgm">
          <Link className="appcrumb" href="/draft/game">&larr; All games</Link>
          {scored ? (
            <GameDraftResult view={v} eyebrow={<Eyebrow v={v} />} />
          ) : (
            <>
              <section className="dgm-hd" data-draft-game-phase={v.phase}>
                <div className="dgm-eyebrow"><Eyebrow v={v} /></div>
                <h1 className="dgm-hd-title" data-room-header>
                  {v.phase === 'drafting' ? v.header : v.phase === 'live' ? 'Scoring starts with the first stat' : TITLE[v.phase] ?? ''}
                </h1>
                {v.phase === 'drafting' && <div className="dgm-hd-sub">{COPY.count}</div>}
              </section>
              {v.phase === 'drafting' ? (
                <GameDraftRoom view={v} />
              ) : v.phase === 'waiting' ? (
                <ul className="dgm-mine" data-draft-game-done>
                  {mine.map((p) => (
                    <li key={p.id}><span className={`dgm-pos dgm-pos--${String(p.pos).toLowerCase()}`}>{p.pos}</span> <b>{p.name}</b> <small>{p.team}</small></li>
                  ))}
                  <li className="dgm-note">Your best three score. Points start at kickoff.</li>
                </ul>
              ) : v.phase === 'pre' && !v.locked ? (
                userId == null ? (
                  <a className="dgm-pill" href={shellSigninHref(`/draft/game/${id}`, isShell)}>Sign in to draft</a>
                ) : (
                  <div className="dgm-startbox">
                    <p className="dgm-sub">{COPY.listSub}</p>
                    <StartGameDraft contestId={v.contestId} inRoom />
                  </div>
                )
              ) : (
                <p className="dgm-empty">{v.phase === 'void' ? 'Nobody scores. Your draft is kept.' : 'This game has kicked off. The draft is closed.'}</p>
              )}
            </>
          )}
          <p className="dgm-foot">{COPY.poolFoot}</p>
        </main>
      </div>
    </div>
  );
}
