/**
 * app/not-found.js - the ink 404 (defect 6c).
 *
 * WHY THIS EXISTS. Next's built-in not-found is a white page with black
 * system text. Inside the Draftvyn shell - a dark, full-bleed webview with
 * no browser chrome - that reads as the app having crashed rather than as a
 * missing page: white flash, no wordmark, no way back except the OS gesture.
 * The AlertBell's team link 404'd into exactly that for weeks.
 *
 * data-surface="ink" is the same hook every other dark surface uses, so this
 * inherits the shell's own background rather than declaring a second one.
 * The 404 BODY needs no client JS: it must render even when something else on
 * the page is what failed. The HEADER is the static one (GlobalHeaderClient):
 * Next builds the root not-found element for EVERY route, so the auth() and
 * cookies() inside GlobalHeaderServer here made every route in the app
 * dynamic - /privacy and /terms included.
 */

import Link from 'next/link';
import GlobalHeaderClient from '@/components/GlobalHeaderClient';
import { arcadeOn } from '@/lib/brand/theme';
import './daily/daily.css';

export const metadata = { title: 'Not found - Sportsvyn' };

export default function NotFound() {
  return (
    <div className="daily-shell">
      <GlobalHeaderClient arcade={arcadeOn()} />
      <main className="daily-main" data-surface="ink" style={{ minHeight: '70vh' }}>
        <section className="hero">
          <div className="hero-eyebrow">404</div>
          <div className="hero-q">That page<br />is not here.</div>
          <p className="hero-line">
            The link may be old, or the page may have moved. Nothing is wrong
            with your account and nothing you have saved is affected.
          </p>
          {/* THREE WAYS OUT, all of which exist. A 404 whose only escape is
              the back gesture is the thing that reads as a crash. */}
          <Link className="btn" href="/games">Go to Games</Link>
          <Link className="btn ghost" href="/">Home</Link>
        </section>
      </main>
    </div>
  );
}
