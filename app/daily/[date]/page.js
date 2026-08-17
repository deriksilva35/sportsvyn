/**
 * /daily/[date] — the reveal. PUBLIC once the day has closed.
 *
 * No auth to read the answer: that is the point of a reveal, and it is what
 * lets a share link work for someone who has not played. Signing in only adds
 * YOUR breakdown to the page.
 */

import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import { resolveShellMode, simViewport } from '@/lib/shell/shell';
import { revealView } from '@/lib/daily/close';
import { tierClass } from '@/lib/daily/reveal';
import { dayBoard } from '@/lib/daily/boards';
import { DayBoardModule } from '@/components/daily/Leaderboard';
import HandleClaim from '@/components/daily/HandleClaim';
import { sql } from '@/lib/db';
import '../daily.css';

export const dynamic = 'force-dynamic';

export async function generateViewport({ searchParams }) {
  return simViewport(await resolveShellMode((await searchParams) ?? {}));
}

export async function generateMetadata({ params }) {
  const { date } = await params;
  const v = await revealView(date);
  if (v.state !== 'revealed') return { title: 'The Daily - Sportsvyn' };
  return {
    title: `The Daily · ${date} - Sportsvyn`,
    description: `${v.season} Week ${v.week}. Perfect lineup: ${v.perfect?.total}.`,
    openGraph: { images: [`/daily/${date}/card`] },
  };
}

const fmt = (n) => (Math.round(Number(n) * 10) / 10).toFixed(1);

export default async function DailyReveal({ params, searchParams }) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();
  const session = await auth();
  const userId = session?.user?.id ?? null;

  const v = await revealView(date, userId == null ? null : Number(userId));
  // The day is closed by the time this renders, so its board is public.
  const board = await dayBoard(date, userId, 25).catch(() => null);
  const me = userId == null ? null
    : await sql`SELECT handle FROM users WHERE id = ${userId}`.then((r) => r[0] ?? null).catch(() => null);
  if (v.state === 'missing') notFound();
  if (v.state === 'open') redirect('/daily');

  return (
    <div className="daily-shell">
      <GlobalHeaderServer activeNav="daily" />
      <div className="daily" data-surface="ink">
      <main className="daily-main">

        {/* THE HERO, and the only one on this screen (v1.2 s5). This is the
            surface people screenshot, so the answer is the display statement
            and everything else is a module beneath it. */}
        <section className="hero">
          <div className="hero-eyebrow">The answer &middot; {date}</div>
          <div className="dh-answer">{v.season} <span className="wk">&middot; Week {v.week}</span></div>
          <div className="pair">
            <div className="pair-cell">
              <div className="n">{fmt(v.perfect?.total)}</div>
              <div className="k">perfect lineup</div>
            </div>
            {v.you && !v.you.dnf && (
              <>
                <span className={`tierbadge ${tierClass(v.you.tier?.label)}`}>{v.you.tier?.label}</span>
                <div className="pair-cell pair-cell--dim">
                  <div className="n">{fmt(v.you.score)}</div>
                  <div className="k">your score &middot; {v.you.tier?.pct}%</div>
                </div>
              </>
            )}
          </div>
        </section>

        {v.you?.dnf && (
          <section className="mod mod--dnf">
            <h2 className="eyebrow">Your entry &mdash; no score</h2>
            <p className="mod-lede">
              You opened the board but never locked a lineup, so there&rsquo;s no score for today.
              The answer is below all the same.
            </p>
          </section>
        )}

        {v.you && !v.you.dnf && (
          <section className="mod mod--you">
            <h2 className="eyebrow">Your lineup <span className="ctx">&mdash; {v.you.entrants} {v.you.entrants === 1 ? 'entry' : 'entries'}</span></h2>
            <div>
              {v.you.picks.map((p) => (
                <div key={p.slot} className={`row${p.dropped ? ' row--dropped' : ''}`}>
                  <span className="row-label">
                    <span className="row-slot">{p.slot.replace('FLEX2', 'FLEX')}</span>
                    <span className="row-name">{p.name}</span>
                    {p.line && <span className="row-line">{p.line}</span>}
                  </span>
                  <span className="r">{fmt(p.points)}</span>
                </div>
              ))}
            </div>
            <p className="muted">Struck row is your dropped pick &mdash; five of six count.</p>
            {v.you.guess && (
              <div className="chiprow">
                <span className="chip">Guessed {v.you.guess.guessedSeason} &middot; Wk {v.you.guess.guessedWeek}</span>
                <span className={`chip ${v.you.guess.seasonRight ? 'chip--on' : 'chip--off'}`}>
                  Season {v.you.guess.seasonRight ? 'right' : 'wrong'}
                </span>
                <span className={`chip ${v.you.guess.weekRight ? 'chip--on' : 'chip--off'}`}>
                  Week {v.you.guess.weekRight ? 'right' : 'wrong'}
                </span>
                {v.you.guess.bonusPct > 0 && (
                  <span className="chip chip--on">+{Math.round(v.you.guess.bonusPct * 100)}% bonus</span>
                )}
              </div>
            )}
          </section>
        )}

        <DayBoardModule board={board} userId={userId == null ? null : Number(userId)} />

        {/* The claim is re-offered here and only here: this is the moment the
            unclaimed reader has just seen their own row sitting grey among the
            handles, which is the only honest time to ask. */}
        {me && !me.handle && (
          <section className="mod">
            <h2 className="eyebrow">Claim your handle</h2>
            <p className="mod-lede">
              You appear as a Player number on every board until you pick one.
            </p>
            <HandleClaim compact />
          </section>
        )}

        <section className="mod">
          <h2 className="eyebrow">The perfect lineup <span className="ctx">&mdash; {fmt(v.perfect?.total)}</span></h2>
          <div>
            {(v.perfect?.picks ?? []).map((p) => (
              <div key={p.slot} className={`row${p.dropped ? ' row--dropped' : ''}`}>
                <span className="row-label">
                  <span className="row-slot">{p.slot.replace('FLEX2', 'FLEX')} &middot; {p.team}</span>
                  <span className="row-name">{p.name}</span>
                  {p.line && <span className="row-line">{p.line}</span>}
                </span>
                <span className="r">{fmt(p.points)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="mod">
          <h2 className="eyebrow">The whole board <span className="ctx">&mdash; all {v.board.length}, by score</span></h2>
          {/* The designated long-list module: the one module permitted to
              scroll internally on mobile (v1.2 s1). */}
          <div className="list--long">
            {v.board.map((p) => (
              <div key={p.id} className="row">
                <span className="row-label">
                  <span className="row-slot">{p.pos} &middot; {p.team}</span>
                  <span className="row-name">{p.name}</span>
                  {p.line && <span className="row-line">{p.line}</span>}
                </span>
                <span className="r">{fmt(p.points)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="mod mod--about">
          <h2 className="eyebrow">How this is scored</h2>
          <p className="mod-lede">
            PPR, computed by the same module the draft sim uses: 1 point per 25 passing yards,
            4 per passing touchdown, −2 per interception, 1 per 10 rushing or receiving yards,
            6 per rushing or receiving touchdown, 1 per reception, −2 per fumble lost.
            Six slots are filled and the worst is dropped, so five count.
          </p>
          <p className="mod-lede">
            Every number comes from the box-score line, not from anyone&rsquo;s published total.
            Where a third party&rsquo;s season total disagrees with the sum of its own game logs,
            we take the game logs.
          </p>
          <p className="muted">
            Player positions and biographical data from{' '}
            <a href="https://github.com/nflverse/nflverse-data" rel="noopener noreferrer" target="_blank">nflverse</a>,
            used under{' '}
            <a href="https://creativecommons.org/licenses/by/4.0/" rel="noopener noreferrer" target="_blank">CC BY 4.0</a>.
            Not affiliated with or endorsed by the National Football League.
          </p>
        </section>

      </main>
      </div>
    </div>
  );
}
