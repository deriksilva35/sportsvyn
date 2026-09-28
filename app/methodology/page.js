/**
 * /methodology - how the numbers on Sportsvyn are made. PAPER-surface prose,
 * server component (no state), the /terms chrome and legal.css.
 *
 * ONE SECTION FOR NOW: win probability, the one model a reader sees live. It
 * says what the model is, what it is anchored on, and why it carries the
 * Calibrating label - model/winprob/GATE-nfl.md is the record behind it.
 */

import Link from 'next/link';
import SiteFooter from '@/components/SiteFooter';
import '@/components/legal.css';

export const metadata = {
  title: 'Methodology — Sportsvyn',
  description: 'How the numbers on Sportsvyn are made.',
};

export default function MethodologyPage() {
  return (
    <div data-surface="ink" className="legal-page">
      <header className="legal-header">
        <div className="legal-header-inner">
          <Link href="/" className="legal-wordmark" aria-label="Sportsvyn home">
            SPORTSV<span className="lw-y">Y</span>N
          </Link>
        </div>
      </header>

      <main className="legal-main">
        <article className="legal-prose">
          <p className="legal-eyebrow">Methodology</p>
          <h1>How our numbers are made</h1>

          <h2 id="win-probability">Win probability</h2>
          <p>
            The live win probability on an NFL game page is our own in-game model.
            It reads the state of the game &mdash; the score, the clock, down and
            distance, field position and who has the ball &mdash; and is anchored on
            the pre-game market spread, taken once at kickoff. A game with no
            pre-game line gets no number.
          </p>
          <p>
            It is labelled <strong>Calibrating</strong> until our own 2026 results
            validate it. Every live reading is kept, so the model can be checked
            against how the games actually ended. It is context for following a
            game, not advice: we explain, we don&rsquo;t pick.
          </p>

          <h2 id="power-ranking">NFL power ranking</h2>
          <p>
            Our NFL power ranking uses this season&rsquo;s games only &mdash; nothing
            carries over from last year &mdash; and is recomputed after each
            week&rsquo;s last game, once Monday night is final. Early weeks are small
            samples, and the ranking says so.
          </p>
          <p>It combines four measures of each team&rsquo;s season so far:</p>
          <ul>
            <li>
              <strong>Scoring, adjusted (25%).</strong> Points per game against what
              those opponents usually allow. Scoring 30 on a defence that usually
              allows 20 counts as +10.
            </li>
            <li>
              <strong>Defence, adjusted (12%).</strong> Points allowed per game against
              what those opponents usually score, turned so that higher is better.
            </li>
            <li>
              <strong>Win percentage (55%).</strong> Wins over games played; a tie
              counts as half a win.
            </li>
            <li>
              <strong>Quality of record (8%).</strong> Each result against what a
              typical team would expect against that opponent. Beating a team that
              wins 80% of its games is worth +0.8; losing to it costs only 0.2; losing
              to a team that wins 20% of its games costs 0.8.
            </li>
          </ul>
          <p>
            Every opponent figure leaves out the opponent&rsquo;s game against the
            team being rated, so no team helps rate itself. A game against an
            opponent with no other games yet is left out of the three adjusted
            measures, but still counts toward win percentage. Each measure is put on
            the same scale &mdash; how many standard deviations a team sits from the
            league average &mdash; and the four are combined with the weights above.
            A power of 0 is a league-average team.
          </p>
        </article>
      </main>

      <SiteFooter />
    </div>
  );
}
