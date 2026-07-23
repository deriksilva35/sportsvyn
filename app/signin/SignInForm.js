'use client';

/**
 * SignInForm — the client island inside /signin.
 *
 * Two phases, one component (web AND shell — the code path is harmless on web
 * and keeps a single flow):
 *   1. email: sends the magic-link email (signIn('resend', redirect:false)).
 *   2. code:  after send, a 6-digit code field — "Or enter the code from the
 *             email here." Verified by the verifyEmailCode server action, which
 *             redeems the SAME token as the link (whichever is used first wins)
 *             and sets the session cookie. On success we navigate to callbackUrl
 *             entirely in-app — no email-link-opens-Safari detour (the reason
 *             this exists for the shell).
 *
 * Receives initialError + callbackUrl as PLAIN PROPS from the server page (no
 * useSearchParams — that triggered BAILOUT_TO_CLIENT_SIDE_RENDERING and emptied
 * the static HTML). The magic link keeps working unchanged.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { verifyEmailCode } from '@/app/actions/emailOtp';

const ERROR_MESSAGES = {
  EmailSignin:     "Couldn't send the link. Try again.",
  Callback:        'That sign-in link expired or was invalid. Send a fresh one below.',
  Verification:    'That sign-in link expired or was invalid. Send a fresh one below.',
  SessionRequired: 'You need to sign in to view that. Send yourself a link below.',
};

const CODE_ERRORS = {
  wrong:    'That code is not right. Check the email and try again.',
  too_many: 'Too many tries. Send yourself a fresh link below.',
  expired:  'That code expired. Send a fresh one.',
  invalid:  'That code is not valid. Send a fresh one.',
};

export default function SignInForm({ initialError = null, callbackUrl = '/' }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [phase, setPhase] = useState('email'); // 'email' | 'code'
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState(null);

  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [codeError, setCodeError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setStatus(null);
    try {
      const res = await signIn('resend', { email, redirect: false, redirectTo: callbackUrl });
      if (!res || res.error) {
        setStatus('error');
        return;
      }
      setPhase('code'); // reveal the code field; the link is also on its way
    } catch {
      setStatus('error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerify(e) {
    e.preventDefault();
    setVerifying(true);
    setCodeError(null);
    try {
      const res = await verifyEmailCode(email, code);
      if (res?.ok) {
        router.push(callbackUrl);
        router.refresh();
        return;
      }
      setCodeError(CODE_ERRORS[res?.reason] ?? 'Could not verify. Try again.');
    } catch {
      setCodeError('Could not verify. Try again.');
    } finally {
      setVerifying(false);
    }
  }

  const errorText =
    status === 'error'
      ? 'Something went wrong. Try again.'
      : initialError
        ? (ERROR_MESSAGES[initialError] ?? 'Something went wrong. Try again.')
        : null;

  if (phase === 'code') {
    return (
      <div className="mt-6 w-full">
        <p className="text-sm text-muted leading-snug">
          Check your email for a sign-in link. Or enter the code from the email here.
        </p>
        <form onSubmit={handleVerify} className="mt-4">
          <label htmlFor="code" className="sr-only">6-digit code</label>
          <input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="123456"
            disabled={verifying}
            className="w-full px-4 py-3 bg-graphite border border-charcoal rounded text-paper-warm text-center text-lg tracking-[0.4em] placeholder:text-muted placeholder:tracking-normal focus:outline-none focus:border-volt disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={verifying || code.length !== 6}
            className="mt-3 w-full px-4 py-3 bg-volt text-ink font-mono font-medium uppercase tracking-widest text-sm rounded hover:bg-volt/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {verifying ? 'Verifying…' : 'Verify code'}
          </button>
          <div className="mt-4 h-6 text-sm text-muted" aria-live="polite">{codeError}</div>
        </form>
        <button
          type="button"
          onClick={() => { setPhase('email'); setCode(''); setCodeError(null); }}
          className="font-mono text-[11px] uppercase tracking-widest text-muted hover:text-volt"
        >
          ← use a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 w-full">
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
