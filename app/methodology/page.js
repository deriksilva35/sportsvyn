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
        </article>
      </main>

      <SiteFooter />
    </div>
  );
}
