'use client';

/**
 * SignInForm — the client island inside /signin.
 *
 * Receives initialError + callbackUrl as PLAIN PROPS from the server
 * page (app/signin/page.js reads them from async searchParams). No
 * useSearchParams() hook here — that's deliberate: useSearchParams in
 * a client component inside a statically-prerenderable tree triggers
 * Next.js's BAILOUT_TO_CLIENT_SIDE_RENDERING, which emptied the
 * /signin static HTML of all form markup. Reading via prop from a
 * server parent removes the hook entirely; nothing for Next to bail
 * out on, and the form lives in the initial HTML.
 *
 * Everything else is identical to the prior single-file 'use client'
 * page: controlled email state, signIn('resend', { email, redirect:
 * false, redirectTo: callbackUrl }), inline aria-live error row, and
 * router.push('/signin/check-email') on success.
 *
 * ERROR_MESSAGES lives here (not in page.js) because this is where the
 * map is consumed — keep data near its use site.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';

const ERROR_MESSAGES = {
  EmailSignin:     "Couldn't send the link. Try again.",
  Callback:        'That sign-in link expired or was invalid. Send a fresh one below.',
  Verification:    'That sign-in link expired or was invalid. Send a fresh one below.',
  SessionRequired: 'You need to sign in to view that. Send yourself a link below.',
};

export default function SignInForm({ initialError = null, callbackUrl = '/' }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setStatus(null);
    try {
      const res = await signIn('resend', {
        email,
        redirect: false,
        redirectTo: callbackUrl,
      });
      if (!res || res.error) {
        setStatus('error');
        return;
      }
      router.push('/signin/check-email');
    } catch {
      setStatus('error');
    } finally {
      setSubmitting(false);
    }
  }

  const errorText =
    status === 'error'
      ? 'Something went wrong. Try again.'
      : initialError
        ? (ERROR_MESSAGES[initialError] ?? 'Something went wrong. Try again.')
        : null;

  return (
    <form onSubmit={handleSubmit} className="mt-12 w-full">
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
        {submitting ? 'Sending…' : 'Send sign-in link'}
      </button>

      <div className="mt-4 h-6 text-sm text-muted" aria-live="polite">
        {errorText}
      </div>
    </form>
  );
}
