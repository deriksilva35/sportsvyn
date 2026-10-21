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
import { nightlyHeadLines, roundLine, lineupLine, nextDay, tomorrowLine, startLine, waitingNote, waitingTitle } from '@/lib/draftGame/nightlyCopy';
import { nightlyContest } from '@/lib/draftGame/nightly';
import { PLAY_REGISTRY } from '@/lib/games/playRegistry';
import NightlyClock from '@/components/draftGame/NightlyClock';
import NightlyFinish from '@/components/draftGame/NightlyFinish';
import GameDraftRoom from '@/components/draftGame/GameDraftRoom';
import RoomHeader from '@/components/draftRoom/RoomHeader';
import GameDraftResult from '@/components/draftGame/GameDraftResult';
import StartGameDraft from '@/components/draftGame/StartGameDraft';
import '../../../daily/daily.css';
import '../../draft.css';
import '../game.css';
import '@/components/draftGame/nightly.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Draft one game - Sportsvyn' };

export async function generateViewport() {
  return simViewport(await resolveShellMode());
}

function Eyebrow({ v }) {
  if (v.nightly) {
    if (v.phase === 'final' || v.phase === 'void' || v.phase === 'live') return <>{nightlyHeadLines(v).line1} · {v.phase === 'final' ? 'FINAL' : v.phase === 'void' ? 'OFF' : 'LIVE'}</>;
    const { line1, line2 } = nightlyHeadLines(v);
    return <>{line1}<span className="nd-eyebrow-2">{line2}</span></>;
  }
  const match = `${v.away} @ ${v.home}`;
  if (v.phase === 'final') return <>{match} · FINAL {v.awayScore ?? 0}-{v.homeScore ?? 0}</>;
  if (v.phase === 'void') return <>{match} · OFF</>;
  if (v.phase === 'live') return <>{match} · {v.status === 'final' ? 'FINAL' : 'LIVE'} {v.awayScore ?? 0}-{v.homeScore ?? 0}</>;
  return <>{match} · <StandaloneTime iso={v.kickoffAt} weekday /></>;
}

const TITLE = { pre: 'Draft this game', waiting: 'Your four are in', void: 'This game was called off' };
const NIGHTLY_TITLE = { pre: "Draft tonight's NBA", void: "Tonight's games were called off" };

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
  // THE FINISH SCREEN's doors (wed-1b): the registry's hrefs, and tomorrow's room if there is one.
  const hrefOf = (key) => PLAY_REGISTRY.find((e) => e.key === key)?.href;
  const finishing = v.nightly && v.phase === 'waiting';
  const tomorrow = finishing && v.dayEt ? tomorrowLine((await nightlyContest(nextDay(v.dayEt)).catch(() => null))?.meta) : null;

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
          ) : finishing ? (
            <NightlyFinish view={v} eyebrow={<Eyebrow v={v} />} pickemHref={hrefOf('nba-pickem')} dailyHref={hrefOf('daily')} tomorrow={tomorrow} />
          ) : (
            <>
              <RoomHeader
                phase={v.phase}
                eyebrow={<Eyebrow v={v} />}
                title={v.phase === 'drafting' ? (v.nightly ? roundLine({ round: v.round, rounds: v.shape.rounds, yourTurn: v.yourTurn, onClockLabel: v.onClockLabel }) : v.header) : v.phase === 'live' ? 'Scoring starts with the first stat' : (v.nightly ? (v.phase === 'waiting' ? waitingTitle(v.shape.rounds) : NIGHTLY_TITLE[v.phase]) : TITLE[v.phase]) ?? ''}
                titleProps={v.nightly ? { 'data-room-header': '', 'data-nightly-title': '' } : { 'data-room-header': '' }}
                sub={v.phase === 'drafting' ? (v.nightly ? lineupLine(v.shape) : COPY.count) : null}
                right={v.nightly && v.phase === 'drafting' ? <NightlyClock deadline={v.deadline} yourTurn={v.yourTurn} /> : null}
              />
              {v.phase === 'drafting' ? (
                <GameDraftRoom view={v} />
              ) : v.phase === 'waiting' ? (
                <ul className="dgm-mine" data-draft-game-done>
                  {mine.map((p) => (
                    <li key={p.id}><span className={`dgm-pos dgm-pos--${String(p.pos).toLowerCase()}`}>{p.slot ?? p.pos}</span> <b>{p.name}</b> <small>{p.team}</small></li>
                  ))}
                  <li className="dgm-note">{v.nightly ? waitingNote(v.shape) : 'Your best three score. Points start at kickoff.'}</li>
                </ul>
              ) : v.phase === 'pre' && !v.locked ? (
                userId == null ? (
                  <a className="dgm-pill" href={shellSigninHref(`/draft/game/${id}`, isShell)}>Sign in to draft</a>
                ) : (
                  <div className="dgm-startbox">
                    <p className="dgm-sub">{v.nightly ? startLine(v.shape) : COPY.listSub}</p>
                    <StartGameDraft contestId={v.contestId} inRoom />
                  </div>
                )
              ) : (
                <p className="dgm-empty">{v.phase === 'void' ? 'Nobody scores. Your draft is kept.' : v.nightly ? 'The first game has tipped. The draft is closed.' : 'This game has kicked off. The draft is closed.'}</p>
              )}
            </>
          )}
          {!v.nightly && <p className="dgm-foot">{COPY.poolFoot}</p>}
        </main>
      </div>
    </div>
  );
}
