/**
 * /epl/standings - the Premier League table, and the platform's FIRST
 * standings surface.
 *
 * ROUTE + PLACEMENT, proposed and taken: /epl/standings mirrors the gridiron
 * shape (/nfl/rankings, /cfb) so the URL vocabulary stays one vocabulary, and
 * the primary nav's SOCCER tab points here - a league table is what "soccer"
 * means to a reader arriving with no fixture in mind, in a way a schedule
 * is not.
 *
 * READS THE STORED DOCUMENT, never the provider: the cron owns the fetch, the
 * page owns the render, and a provider outage costs a stale table rather than
 * a broken page.
 */

import Link from 'next/link';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import { getEplStandings, railFor } from '@/lib/soccer/standings';
import '@/components/gridiron/gridiron.css';
import './standings.css';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Premier League table - Sportsvyn',
  description: 'The Premier League table: played, won, drawn, lost, goal difference, points and form.',
};

function Form({ form }) {
  if (!form) return null;
  // The last five, newest LAST (the provider's order) - read left to right
  // like a sentence, which is how a form guide is read everywhere else.
  const five = String(form).slice(-5).split('');
  return (
    <span className="ep-form">
      {five.map((c, i) => <i key={i} className={`ep-f ep-f--${c.toLowerCase()}`}>{c}</i>)}
    </span>
  );
}

export default async function EplStandingsPage() {
  const table = await getEplStandings().catch(() => null);

  return (
    <>
      <GlobalHeaderServer activeNav="soccer" />
      <main className="gi" data-surface="ink">
        <div className="gi-wrap">
          <div className="gi-kicker">
            <span className="k">Premier League</span>
            <span className="rule" />
            <Link className="lnk" href="/scores?sport=epl">Scores &rarr;</Link>
          </div>

          {!table ? (
            <div className="gi-empty">The table lands with the first sync.</div>
          ) : (
            <>
              <div className="ep-table" role="table" aria-label="Premier League table">
                <div className="ep-row ep-row--h" role="row">
                  <span className="ep-rank">#</span>
                  <span className="ep-club">Club</span>
                  <span className="ep-n">P</span>
                  <span className="ep-n">W</span>
                  <span className="ep-n">D</span>
                  <span className="ep-n">L</span>
                  <span className="ep-n wide">GF</span>
                  <span className="ep-n wide">GA</span>
                  <span className="ep-n wide">GD</span>
                  <span className="ep-n pts">PTS</span>
                  <span className="ep-form-h">Form</span>
                </div>
                {table.rows.map((r) => (
                  <div className={`ep-row${railFor(r.note) ? ` rail-${railFor(r.note)}` : ''}`} role="row" key={r.teamId ?? r.rank}>
                    <span className="ep-rank">{r.rank}</span>
                    <span className="ep-club">{r.team}</span>
                    <span className="ep-n">{r.played}</span>
                    <span className="ep-n">{r.win}</span>
                    <span className="ep-n">{r.draw}</span>
                    <span className="ep-n">{r.lose}</span>
                    <span className="ep-n wide">{r.goalsFor}</span>
                    <span className="ep-n wide">{r.goalsAgainst}</span>
                    <span className="ep-n wide">{r.goalsDiff > 0 ? `+${r.goalsDiff}` : r.goalsDiff}</span>
                    <span className="ep-n pts">{r.points}</span>
                    <Form form={r.form} />
                  </div>
                ))}
              </div>
              <p className="ep-key">
                <i className="ep-swatch rail-ucl" /> Champions League
                <i className="ep-swatch rail-uel" /> Europa / Conference
                <i className="ep-swatch rail-drop" /> Relegation
              </p>
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
