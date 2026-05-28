'use client';

/**
 * LivePoller — client component that fetches /api/sync/fixture/{id} every
 * 60 seconds and renders the current score + minute in place. Mounted by
 * the match page only when status='live', so a scheduled/finished match
 * never opens a polling loop.
 *
 * Server pre-populates initialState so the first render has real data and
 * we avoid a flash-of-loading on mount.
 */

import { useEffect, useState } from 'react';

export default function LivePoller({ fixtureId, initialState }) {
  const [state, setState] = useState(initialState);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const res = await fetch(`/api/sync/fixture/${fixtureId}`, { cache: 'no-store' });
        if (!res.ok) {
          if (!cancelled) setError(true);
          return;
        }
        const data = await res.json();
        if (!cancelled) {
          setError(false);
          setState((prev) => ({ ...prev, ...data }));
        }
      } catch {
        if (!cancelled) setError(true);
      }
    }

    const interval = setInterval(tick, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [fixtureId]);

  const { home_score, away_score, status, minute } = state;
  const home = home_score ?? 0;
  const away = away_score ?? 0;

  return (
    <div
      style={{
        display: 'inline-flex',
        gap: 14,
        alignItems: 'baseline',
        fontFamily: 'var(--font-mono)',
        fontSize: 13,
        color: 'var(--paper-warm)',
      }}
    >
      <span
        aria-label="live"
        style={{
          color: 'var(--live-red)',
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          fontWeight: 700,
          fontSize: 11,
        }}
      >
        ● LIVE
      </span>
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontStyle: 'italic',
          fontWeight: 900,
          fontSize: 28,
          letterSpacing: '-0.02em',
          color: 'var(--volt)',
        }}
      >
        {home} — {away}
      </span>
      {minute != null && (
        <span style={{ color: 'var(--muted)', fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase' }}>
          {minute}&apos;
        </span>
      )}
      {status && status !== 'live' && (
        <span style={{ color: 'var(--muted-dim)', fontSize: 10 }}>({status})</span>
      )}
      {error && (
        <span style={{ color: 'var(--terra)', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
          poll failed
        </span>
      )}
    </div>
  );
}
