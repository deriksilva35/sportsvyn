'use client';

/**
 * Session 3a coming-soon homepage.
 *
 * Intentionally minimal — "ugly but functional." Brand polish (Saira Condensed
 * wordmark with macron-Y treatment, color tokens, countdown timer, hero imagery)
 * is deferred to Session 3b.
 *
 * UTM capture: on mount, we read window.location.search and forward any
 * allow-listed utm_* params along with the email to /api/email/signup so
 * attribution survives the signup.
 */

import { useEffect, useState } from 'react';

export default function Home() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState(null);
  const [utmParams, setUtmParams] = useState({});

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const captured = {};
    const allowed = ['utm_source', 'utm_medium', 'utm_campaign'];
    for (const key of allowed) {
      const value = params.get(key);
      if (value !== null) {
        captured[key] = value;
      }
    }
    setUtmParams(captured);
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setStatus(null);

    try {
      const response = await fetch('/api/email/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, ...utmParams }),
      });

      if (response.ok) {
        setStatus('success');
        setEmail('');
      } else if (response.status === 400) {
        setStatus('invalid');
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100 px-4">
      <main className="w-full max-w-md flex flex-col items-center gap-8 text-center">
        <h1 className="text-5xl font-bold tracking-tight">Sportsvyn</h1>
        <p className="text-lg text-zinc-400">
          Sports editorial. Coming June 2026.
        </p>

        <form onSubmit={handleSubmit} className="w-full flex flex-col gap-3">
          <label htmlFor="email" className="sr-only">
            Email address
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            disabled={submitting}
            className="w-full px-4 py-2 rounded bg-zinc-900 border border-zinc-700 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={submitting}
            className="w-full px-4 py-2 rounded bg-zinc-100 text-zinc-950 font-medium hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Submitting…' : 'Notify me'}
          </button>
        </form>

        <div className="min-h-[1.5rem] text-sm" aria-live="polite">
          {status === 'success' && (
            <p className="text-green-400">Thanks — we&apos;ll be in touch.</p>
          )}
          {status === 'invalid' && (
            <p className="text-amber-400">Please enter a valid email.</p>
          )}
          {status === 'error' && (
            <p className="text-red-400">Something went wrong. Try again.</p>
          )}
        </div>
      </main>
    </div>
  );
}
