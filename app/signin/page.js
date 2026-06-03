/**
 * /signin — custom magic-link sign-in page.
 *
 * SERVER component (no 'use client'). Reads ?error= and ?callbackUrl=
 * from the async searchParams prop (Next 16 pattern, same as
 * /confirmed/page.js) and passes them as plain props into the client
 * island SignInForm. This shape exists for a specific reason:
 * useSearchParams() in a client component inside a statically-
 * prerenderable tree triggers Next.js's
 * BAILOUT_TO_CLIENT_SIDE_RENDERING, which served an empty HTML shell
 * to crawlers/curl/no-JS users (the form only appeared after JS
 * hydrated). Reading searchParams server-side and prop-drilling them
 * into a small client island removes the hook entirely; nothing for
 * Next to bail out on, and the form appears in the initial SSR HTML.
 *
 * Reading async searchParams implicitly makes this route dynamic
 * (no need for `export const dynamic = 'force-dynamic'`). The signal
 * is in the code shape itself, not a separate directive.
 *
 * Visual shell mirrors /confirmed: centered max-w-md, Wordmark at
 * the small utility-page scale, font-display headline, serif-italic
 * supporting line, mono back-link.
 */

import Wordmark from '@/components/Wordmark';
import SignInForm from './SignInForm';

export const metadata = {
  title: 'Sign in — Sportsvyn',
};

export default async function SignInPage({ searchParams }) {
  const params = await searchParams;
  const initialError =
    typeof params?.error === 'string' ? params.error : null;
  const callbackUrl =
    typeof params?.callbackUrl === 'string' ? params.callbackUrl : '/';

  return (
    <main className="max-w-md mx-auto py-24 px-6 text-center">
      <Wordmark sizeClassName="text-2xl sm:text-3xl" />
      <h1 className="font-display font-black text-3xl text-paper-warm mt-12">
        Sign in to Sportsvyn
      </h1>
      <p className="font-serif italic text-muted mt-4">
        We&apos;ll send a one-click sign-in link to your inbox.
      </p>

      <SignInForm initialError={initialError} callbackUrl={callbackUrl} />

      <a
        href="/"
        className="font-mono text-xs uppercase tracking-widest text-muted hover:text-volt mt-12 inline-block"
      >
        ← sportsvyn.com
      </a>
    </main>
  );
}
