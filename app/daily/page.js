/**
 * /daily — the Daily puzzle.
 *
 * SERVER COMPONENT, force-dynamic: it reads auth() cookies and the day's state
 * on every request. The board itself is NEVER rendered here - it arrives from
 * POST /api/daily/start, after the clock has been stamped, so that opening the
 * page is not the same as starting the round.
 *
 * THE PREMISE, once: the answers are public record. A board with Peyton Manning
 * on it is 2015-2016 to anyone who follows football. THE CLOCK IS THE GAME.
 * Nothing below hides anything in the belief that hiding it defeats a
 * determined person; it is hidden so the round is honest for someone playing it
 * straight.
 *
 * FOUR STATES, and the page is only ever in one:
 *   signed out   the pitch, and a way in that returns here
 *   no entry     the rules, and START
 *   entered      your score, your band, when it closes - and nothing else
 *   closed       handled by the reveal (commit 3)
 */

import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import Wordmark from '@/components/gridiron/Wordmark';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import { resolveShellMode, simViewport } from '@/lib/shell/shell';
import { shellSigninHref } from '@/lib/shell/signinHref';
import { requireSignInInShell } from '@/lib/shell/signedOut';
import { todayEt, getDay, entryView } from '@/lib/daily/entries';
import { podium, overall } from '@/lib/daily/boards';
import { PodiumModule, OverallModule } from '@/components/daily/Leaderboard';
import HandleClaim from '@/components/daily/HandleClaim';
import { sql } from '@/lib/db';
import DailyRoom from '@/components/daily/DailyRoom';
import AnswerNudge from '@/components/push/AnswerNudge';
import './daily.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'The Daily - Sportsvyn',
  description: 'One board. Six slots. Three minutes.',
};

export async function generateViewport({ searchParams }) {
  return simViewport(await resolveShellMode((await searchParams) ?? {}));
}

export default async function DailyPage({ searchParams }) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const isShell = await resolveShellMode((await searchParams) ?? {});
  // Signed out in the container: the sign-in form, not this page's hero.
  requireSignInInShell({ isShell, userId, dest: '/daily' });

  const date = await todayEt();
  const { state } = await getDay(date);

  // SIGNED OUT: the pitch. shellSigninHref rather than a bare string from day
  // one - inside the native container the ?shell= marker has to ride inside the
  // encoded callbackUrl or the Apple round trip loses it.
  if (userId == null) {
    return (
      <div className="daily-shell">
        <GlobalHeaderServer activeNav="daily" />
        <div className="daily" data-surface="ink">
        <header className="daily-head"><Wordmark href="/" /><span className="tag">The <b>Daily</b></span></header>
        <main className="daily-main">
          {/* THE HERO - the app mock's "When are you?" pattern. One hook in
              display type, one context line, the PLAY primary. This screen's
              single hero and single primary (v1.2 s4, s5). */}
          <section className="hero">
            <div className="hero-eyebrow">The Daily &middot; same board for everyone</div>
            <div className="hero-q">When are<br />you?</div>
            <p className="hero-line">
              Sixty-four real performances from one real week of NFL history.
              {/* {' '} explicitly: JSX collapsed the space after </b> and it
                  shipped as "3:00clock". A literal space next to an element
                  boundary is not something to trust to whitespace handling. */}
              One attempt &middot; <b>3:00</b>{' '}on the clock &middot; closes midnight ET
            </p>
            <a className="btn--volt" href={shellSigninHref('/daily', isShell)}>Play today&rsquo;s Daily</a>
          </section>

          <section className="mod">
            <h2 className="eyebrow">How it works</h2>
            <div>
              <div className="row"><span>The board</span><span className="r">64 players</span></div>
              <div className="row"><span>Your lineup</span><span className="r">QB &middot; RB &middot; WR &middot; TE &middot; 2 FLEX</span></div>
              <div className="row"><span>The clock</span><span className="r">3:00, server-side</span></div>
              <div className="row"><span>Scoring</span><span className="r">PPR, worst pick dropped</span></div>
              <div className="row"><span>Bonus</span><span className="r">Name the season and week</span></div>
            </div>
            <p className="muted">
              Scored by the same module the draft sim uses. Everyone gets the same board;
              the clock starts when you do.
            </p>
          </section>
        </main>
        </div>
      </div>
    );
  }

  if (state === 'missing' || state === 'pending') {
    return (
      <div className="daily-shell">
        <GlobalHeaderServer activeNav="daily" />
        <div className="daily" data-surface="ink">
        <header className="daily-head"><Wordmark href="/" /><span className="tag">The <b>Daily</b></span></header>
        <main className="daily-main">
          <section className="mod">
            <h2 className="eyebrow">Today&rsquo;s board</h2>
            <p className="mod-lede">Not up yet. It lands at midnight ET.</p>
          </section>
        </main>
        </div>
      </div>
    );
  }

  if (state === 'closed') redirect(`/daily/${date}`);   // the reveal owns a closed day

  const view = await entryView(Number(userId), date);
  // Both boards are revealed-day reads (see boards.js) - neither can carry
  // today. Caught to null: a leaderboard is one module, never the page.
  const [podiumBoard, overallTable, me] = await Promise.all([
    podium(userId).catch(() => null),
    overall(userId, 10).catch(() => null),
    sql`SELECT handle, push_choice FROM users WHERE id = ${userId}`.then((r) => r[0] ?? null).catch(() => null),
  ]);

  // DNF: started, never locked, clock spent. The attempt is consumed - the
  // board was seen - so the page must not offer START again. It says what
  // happened rather than handing back a board that can no longer be submitted.
  if (view.dnf) {
    return (
      <div className="daily-shell">
        <GlobalHeaderServer activeNav="daily" />
        <div className="daily" data-surface="ink">
        <header className="daily-head"><Wordmark href="/" /><span className="tag">The <b>Daily</b></span></header>
        <main className="daily-main">
          <section className="mod mod--dnf">
            <h2 className="eyebrow">Today&rsquo;s board &mdash; no score</h2>
            <p className="mod-title" style={{ fontSize: '20px' }}>Ran out of clock</p>
            <p className="mod-lede">
              You opened today&rsquo;s board but never locked a lineup, so there&rsquo;s no score.
              One board a day &mdash; the answer and the perfect lineup unlock at midnight ET.
            </p>
          </section>
        </main>
        </div>
      </div>
    );
  }

  return (
    <div className="daily-shell">
      <GlobalHeaderServer activeNav="daily" />
      <div className="daily" data-surface="ink">
      <header className="daily-head">
        <Wordmark href="/" />
        <span className="tag">The <b>Daily</b></span>
      </header>
      <main className="daily-main">
        <DailyRoom
          puzzleDate={date}
          initialEntry={view.entry}
          closesAt={String(view.entry?.closesAt ?? '')}
          podium={view.entry ? null : <PodiumModule board={podiumBoard} userId={Number(userId)} />}
          overall={<OverallModule table={overallTable} userId={Number(userId)} />}
          claim={me && !me.handle ? <HandleClaim /> : null}
          nudge={<AnswerNudge offer={me != null && me.push_choice == null} />}
        />
      </main>
      </div>
    </div>
  );
}
