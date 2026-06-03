/**
 * /signin/check-email — verifyRequest landing.
 *
 * Auth.js redirects here after a successful POST to
 * /api/auth/signin/resend (the form submit on /signin). Static server
 * component, sibling of /confirmed: Wordmark + headline + serif body +
 * mono note about expiry, matching the branded magic-link email's voice
 * from 1c-i.
 *
 * The actual sign-in completes when the user clicks the magic link in
 * their inbox → /api/auth/callback/resend → session created → redirect
 * to the originating callbackUrl. This page only confirms "the email is
 * sent" — it never sees the token.
 */

import Wordmark from '@/components/Wordmark';

export const metadata = {
  title: 'Check your email — Sportsvyn',
};

export default function CheckEmailPage() {
  return (
    <main className="max-w-md mx-auto py-24 px-6 text-center">
      <Wordmark sizeClassName="text-2xl sm:text-3xl" />
      <h1 className="font-display font-black text-3xl text-paper-warm mt-12">
        Check your email
      </h1>
      <p className="font-serif italic text-muted mt-4">
        A sign-in link is on its way to your inbox.
      </p>
      <p className="font-mono text-xs uppercase tracking-widest text-muted mt-6">
        The link expires shortly.
      </p>
      <a
        href="/"
        className="font-mono text-xs uppercase tracking-widest text-muted hover:text-volt mt-12 inline-block"
      >
        ← sportsvyn.com
      </a>
    </main>
  );
}
