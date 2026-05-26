'use client';

/**
 * Sportsvyn homepage — Session 3b polished brand version.
 *
 * Composes the Wordmark (SPORTSVȲN with macron-Y), the live vestaboard
 * countdown to the 2026 FIFA World Cup opener, and the email signup form.
 * Replaces the Session 3a "ugly but functional" placeholder.
 *
 * Brand tokens used: bg-graphite, text-volt, text-muted, text-paper-warm
 * (defined in app/globals.css via Tailwind v4 @theme). Body background is
 * --color-ink, set on <body> in globals.css.
 *
 * UTM capture: on mount, reads utm_source/utm_medium/utm_campaign from
 * window.location.search via an allowlist filter and forwards them with
 * the email to /api/email/signup.
 */

import { useEffect, useState } from 'react';
import Wordmark from '@/components/Wordmark';
import Countdown from '@/components/Countdown';

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
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <main className="w-full max-w-2xl flex flex-col items-center text-center">
        <Wordmark />

        <p className="font-serif italic text-xl sm:text-2xl text-paper-warm mt-4">
          Read the Game.
        </p>

        <div className="mt-12 sm:mt-16">
          <Countdown />
          <p className="font-mono text-xs text-muted tracking-widest uppercase mt-3">
            World Cup Begins · June 11, 2026
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="mt-12 sm:mt-16 w-full max-w-sm"
        >
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
            className="w-full px-4 py-3 bg-graphite border border-charcoal rounded text-paper-warm placeholder:text-muted focus:outline-none focus:border-volt disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={submitting}
            className="mt-3 w-full px-4 py-3 bg-volt text-ink font-mono font-medium uppercase tracking-widest text-sm rounded hover:bg-volt/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Sending…' : 'Notify me'}
          </button>

          <div className="mt-4 h-6 text-sm text-muted" aria-live="polite">
            {status === 'success' && "Thanks — we'll be in touch."}
            {status === 'invalid' && 'Please enter a valid email.'}
            {status === 'error' && 'Something went wrong. Try again.'}
          </div>
        </form>
      </main>
    </div>
  );
}
