'use client';

// app/global-error.js — the last unbranded failure surface.
//
// WHAT REACHES HERE, AND WHY THE SEGMENT BOUNDARY COULD NOT. A throw during the
// INITIAL server render kills the streamed shell before any nested boundary
// exists to receive it - measured in a production build against the draft room:
// HTTP 500 with none of app/sim/draft/[id]/error.js's markup. Only a global
// boundary is mounted early enough to answer that, and Next requires it to
// replace the ROOT LAYOUT, which is why this file renders its own <html> and
// <body>.
//
// STYLES ARE INLINE ON PURPOSE. Replacing the root layout means globals.css and
// its :root custom properties are not guaranteed to be present, so var(--ink)
// would resolve to nothing and the page would render as unstyled black-on-white
// at the exact moment we least want it to. The hex values below are the same
// tokens, written out - the same trade www/error.html makes for the same reason.
//
// SAME REGISTER AS THE SEGMENT BOUNDARY: one plain sentence, a way back, no
// stack and no raw error text on screen. The digest is a correlation id, not
// error text, and it is the id Next stamps on the server-side log line.
//
// It must never make failures quieter for us: the full error goes to
// console.error before anything renders.

import { useEffect } from 'react';

const INK = '#0A0A0A';
const PAPER = '#F5F5F2';
const MUTED = '#888888';
const VOLT = '#D4FF00';

export default function GlobalError({ error, reset }) {
  useEffect(() => {
    console.error('[global] render failed', {
      message: error?.message,
      digest: error?.digest,
      stack: error?.stack,
      path: typeof window === 'undefined' ? null : window.location.pathname,
    });
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, background: INK, color: PAPER, minHeight: '100vh',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
        WebkitFontSmoothing: 'antialiased' }}
      >
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 24 }}
        >
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.28em',
            textTransform: 'uppercase', color: VOLT, marginBottom: 12 }}
          >
            Sportsvyn
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-.01em', margin: '0 0 12px', lineHeight: 1.15 }}>
            This page stopped loading
          </h1>
          <p style={{ fontSize: 15, lineHeight: 1.55, color: MUTED, margin: '0 0 26px', maxWidth: 320 }}>
            Nothing you have saved is affected. Reloading usually clears it.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{ font: 'inherit', fontSize: 13, fontWeight: 700, letterSpacing: '.12em',
                textTransform: 'uppercase', color: INK, background: VOLT, border: 'none',
                padding: '13px 26px', cursor: 'pointer' }}
            >
              Try again
            </button>
            {/* An absolute path, not history.back(): back can land on another
                dead document, and this screen must never be a dead end.
                A plain <a>, NOT next/link, and the rule is disabled rather than
                satisfied: Link does a client-side navigation through the very
                router tree that just failed hard enough to reach this boundary.
                A full document load is the only exit that does not depend on
                the thing that broke. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              style={{ font: 'inherit', fontSize: 13, fontWeight: 700, letterSpacing: '.12em',
                textTransform: 'uppercase', color: MUTED, textDecoration: 'none',
                border: '1px solid #2E2E2E', padding: '13px 26px' }}
            >
              Home
            </a>
          </div>
          {error?.digest ? (
            <div style={{ marginTop: 22, fontSize: 11, color: '#5A5A5A', letterSpacing: '.08em' }}>
              Reference {error.digest}
            </div>
          ) : null}
        </div>
      </body>
    </html>
  );
}
