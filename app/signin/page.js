'use client';

/**
 * /signin — custom magic-link sign-in form.
 *
 * Sibling of /confirmed in shell: centered max-w-md, Wordmark at the
 * small utility-page scale, font-display headline, serif-italic body.
 * Form reuses app/page.js's homepage-signup field styles exactly
 * (bg-graphite border-charcoal focus:border-volt input + bg-volt text-ink
 * font-mono uppercase tracking-widest button + aria-live status row),
 * so /signin reads as a sibling of the homepage form, not a new look.
 *
 * Client component because:
 *   - controlled <input> state for the email field
 *   - signIn('resend', { email, redirect: false }) handles the response
 *     in-page (errors render inline; success router.pushes to check-email)
 *   - useSearchParams reads ?error= (from a bounced protected route or
 *     a failed callback) and ?callbackUrl= (preserve where the user came
 *     from so the magic-link click returns them there)
 *
 * Wrapped in a Suspense boundary because Next.js requires useSearchParams
 * to be inside one (the searchParams reading is a client-only async point;
 * static prerendering of the rest of the page would otherwise complain).
 *
 * ?error= → ERROR_MESSAGES map (EmailSignin = Resend send failed,
 * Callback = token invalid/expired, SessionRequired = bounced from a
 * protected route). Anything else falls to the generic message. Auth.js's
 * own /signin error param surface is mirrored into our inline aria-live
 * row instead of a separate error page.
 */

import { Suspense, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import Wordmark from '@/components/Wordmark';

const ERROR_MESSAGES = {
  EmailSignin:     "Couldn't send the link. Try again.",
  Callback:        'That sign-in link expired or was invalid. Send a fresh one below.',
  Verification:    'That sign-in link expired or was invalid. Send a fresh one below.',
  SessionRequired: 'You need to sign in to view that. Send yourself a link below.',
};

function SignInPageInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState(null);

  const inboundError = params.get('error');
  const callbackUrl = params.get('callbackUrl') ?? '/';

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
      : inboundError
        ? (ERROR_MESSAGES[inboundError] ?? 'Something went wrong. Try again.')
        : null;

  return (
    <main className="max-w-md mx-auto py-24 px-6 text-center">
      <Wordmark sizeClassName="text-2xl sm:text-3xl" />
      <h1 className="font-display font-black text-3xl text-paper-warm mt-12">
        Sign in to Sportsvyn
      </h1>
      <p className="font-serif italic text-muted mt-4">
        We&apos;ll send a one-click sign-in link to your inbox.
      </p>

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

      <a
        href="/"
        className="font-mono text-xs uppercase tracking-widest text-muted hover:text-volt mt-12 inline-block"
      >
        ← sportsvyn.com
      </a>
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInPageInner />
    </Suspense>
  );
}
