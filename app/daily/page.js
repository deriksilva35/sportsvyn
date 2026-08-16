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
import { resolveShellMode, simViewport } from '@/lib/shell/shell';
import { shellSigninHref } from '@/lib/shell/signinHref';
import { todayEt, getDay, entryView } from '@/lib/daily/entries';
import DailyRoom from '@/components/daily/DailyRoom';
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

  const date = await todayEt();
  const { state } = await getDay(date);

  // SIGNED OUT: the pitch. shellSigninHref rather than a bare string from day
  // one - inside the native container the ?shell= marker has to ride inside the
  // encoded callbackUrl or the Apple round trip loses it.
  if (userId == null) {
    return (
      <div className="daily" data-surface="ink">
        <header className="daily-head"><Wordmark href="/" /><span className="tag">The <b>Daily</b></span></header>
        <main className="daily-main">
          <section className="mod mod--pitch">
            <h1 className="mod-title">One board. Six slots. Three minutes.</h1>
            <p className="mod-lede">
              Every day, sixty-four real performances from one real week of NFL history.
              Build the best six-man lineup you can before the clock runs out.
              Your worst pick is dropped. Guess the week for a bonus.
            </p>
            <ul className="mod-list">
              <li>PPR scoring, computed from box-score lines by the same module the draft sim uses.</li>
              <li>Everyone gets the same board. The clock starts when you do.</li>
              <li>Closes at midnight ET, then the answer and the perfect lineup.</li>
            </ul>
            <a className="btn btn--volt" href={shellSigninHref('/daily', isShell)}>Play today&rsquo;s Daily</a>
          </section>
        </main>
      </div>
    );
  }

  if (state === 'missing' || state === 'pending') {
    return (
      <div className="daily" data-surface="ink">
        <header className="daily-head"><Wordmark href="/" /><span className="tag">The <b>Daily</b></span></header>
        <main className="daily-main">
          <section className="mod">
            <h1 className="mod-title">Not yet</h1>
            <p className="mod-lede">Today&rsquo;s board isn&rsquo;t up. It lands at midnight ET.</p>
          </section>
        </main>
      </div>
    );
  }

  if (state === 'closed') redirect(`/daily/${date}`);   // the reveal owns a closed day

  const view = await entryView(Number(userId), date);

  // DNF: started, never locked, clock spent. The attempt is consumed - the
  // board was seen - so the page must not offer START again. It says what
  // happened rather than handing back a board that can no longer be submitted.
  if (view.dnf) {
    return (
      <div className="daily" data-surface="ink">
        <header className="daily-head"><Wordmark href="/" /><span className="tag">The <b>Daily</b></span></header>
        <main className="daily-main">
          <section className="mod mod--dnf">
            <h1 className="mod-title">Ran out of clock</h1>
            <p className="mod-lede">
              You opened today&rsquo;s board but never locked a lineup, so there&rsquo;s no score.
              One board a day &mdash; the answer and the perfect lineup unlock at midnight ET.
            </p>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="daily" data-surface="ink">
      <header className="daily-head">
        <Wordmark href="/" />
        <span className="tag">The <b>Daily</b></span>
      </header>
      <main className="daily-main">
        <DailyRoom puzzleDate={date} initialEntry={view.entry} closesAt={String(view.entry?.closesAt ?? '')} />
      </main>
    </div>
  );
}
