/**
 * /daily/[date] — the reveal. PUBLIC once the day has closed.
 *
 * No auth to read the answer: that is the point of a reveal, and it is what
 * lets a share link work for someone who has not played. Signing in only adds
 * YOUR breakdown to the page.
 */

import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import Wordmark from '@/components/gridiron/Wordmark';
import { resolveShellMode, simViewport } from '@/lib/shell/shell';
import { revealView } from '@/lib/daily/close';
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
  if (v.state === 'missing') notFound();
  if (v.state === 'open') redirect('/daily');

  return (
    <div className="daily" data-surface="ink">
      <header className="daily-head">
        <Wordmark href="/" />
        <span className="tag">The <b>Daily</b> · {date}</span>
      </header>
      <main className="daily-main">

        <section className="mod">
          <h1 className="mod-title">{v.season} · Week {v.week}</h1>
          <p className="mod-lede">That&rsquo;s the week. Perfect lineup was <b>{fmt(v.perfect?.total)}</b>.</p>
        </section>

        {v.you?.dnf && (
          <section className="mod mod--dnf">
            <h2 className="mod-sub">Ran out of clock</h2>
            <p className="mod-lede">
              You opened the board but never locked a lineup, so there&rsquo;s no score for today.
              The answer is below all the same.
            </p>
          </section>
        )}

        {v.you && !v.you.dnf && (
          <section className="mod mod--you">
            <div className="score-row">
              <div className="score-big">{fmt(v.you.score)}</div>
              <div className="score-meta">
                <span className="band">{v.you.tier?.label}</span>
                <span className="muted">{v.you.tier?.pct}% of perfect · {v.you.entrants} entries</span>
              </div>
            </div>
            <table className="brk">
              <tbody>
                {v.you.picks.map((p) => (
                  <tr key={p.slot} className={p.dropped ? 'brk--dropped' : ''}>
                    <td className="brk-slot">{p.slot.replace('FLEX2', 'FLEX')}</td>
                    <td className="brk-name">{p.name}</td>
                    <td className="brk-pts">{fmt(p.points)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted">Struck row is your dropped pick — five of six count.</p>
            {v.you.guess && (
              <p className="muted">
                You guessed {v.you.guess.guessedSeason} Week {v.you.guess.guessedWeek} —{' '}
                {v.you.guess.seasonRight && v.you.guess.weekRight ? 'both right'
                  : v.you.guess.seasonRight ? 'season right'
                  : v.you.guess.weekRight ? 'week right' : 'neither'}
                {v.you.guess.bonusPct > 0 && ` · +${Math.round(v.you.guess.bonusPct * 100)}%`}
              </p>
            )}
          </section>
        )}

        <section className="mod">
          <h2 className="mod-sub">The perfect lineup</h2>
          <table className="brk">
            <tbody>
              {(v.perfect?.picks ?? []).map((p) => (
                <tr key={p.slot} className={p.dropped ? 'brk--dropped' : ''}>
                  <td className="brk-slot">{p.slot.replace('FLEX2', 'FLEX')}</td>
                  <td className="brk-name">{p.name} <span className="muted">{p.team}</span></td>
                  <td className="brk-pts">{fmt(p.points)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="mod">
          <h2 className="mod-sub">The whole board</h2>
          <table className="brk brk--full">
            <tbody>
              {v.board.map((p) => (
                <tr key={p.id}>
                  <td className="brk-slot">{p.pos}</td>
                  <td className="brk-name">{p.name} <span className="muted">{p.team}</span></td>
                  <td className="brk-pts">{fmt(p.points)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="mod mod--about">
          <h2 className="mod-sub">How this is scored</h2>
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
  );
}
