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

import Link from 'next/link';
import Wordmark from '@/components/Wordmark';
import SignInForm from './SignInForm';
import AppleSignInButton from './AppleSignInButton';
import { resolveShellMode, simViewport } from '@/lib/shell/shell';

export const metadata = {
  title: 'Sign in — Sportsvyn',
};

// In the Draftvyn shell, opt into viewport-fit:cover so env(safe-area-inset-*)
// resolves; web returns the same base viewport (unchanged).
export async function generateViewport({ searchParams }) {
  return simViewport(await resolveShellMode((await searchParams) ?? {}));
}

export default async function SignInPage({ searchParams }) {
  const params = await searchParams;
  const initialError =
    typeof params?.error === 'string' ? params.error : null;
  const callbackUrl =
    typeof params?.callbackUrl === 'string' ? params.callbackUrl : '/';
  // Shell-aware (via ?shell=sim-app param, or the sv_shell cookie set on /sim).
  // Web version is unaffected — isShell is false there.
  const isShell = await resolveShellMode(params ?? {});

  return (
    <main
      className={`max-w-md mx-auto px-6 text-center ${isShell ? '' : 'py-24'}`}
      style={isShell ? { paddingTop: 'calc(2.5rem + env(safe-area-inset-top))', paddingBottom: 'calc(2.5rem + env(safe-area-inset-bottom))' } : undefined}
    >
      <Wordmark sizeClassName={isShell ? 'text-xl' : 'text-2xl sm:text-3xl'} />
      <h1 className="font-display font-black text-3xl text-paper-warm mt-12">
        Sign in or create your account
      </h1>
      <p className="font-serif italic text-muted mt-4">
        Use your Apple&nbsp;ID, or we&apos;ll email you a one-click sign-in link.
      </p>

      <div className="mt-12 w-full">
        <AppleSignInButton callbackUrl={callbackUrl} />

        <div className="mt-8">
          <div className="h-px bg-charcoal" />
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted mt-4">
            or get a sign-in link by email
          </p>
          {isShell && (
            <p className="text-[11px] text-muted mt-2 leading-snug">
              Email links open in your browser - use Apple to stay in the app.
            </p>
          )}
        </div>

        <SignInForm initialError={initialError} callbackUrl={callbackUrl} />
      </div>

      <p className="font-mono text-[11px] uppercase tracking-widest text-muted mt-8">
        Membership?{' '}
        <a href="/membership" className="underline hover:text-volt">See plans →</a>
      </p>

      {/* Website escape hatch — hidden in the shell so /signin reads as the app
          front door, not the website. */}
      {!isShell && (
        <Link
          href="/"
          className="font-mono text-xs uppercase tracking-widest text-muted hover:text-volt mt-12 inline-block"
        >
          ← sportsvyn.com
        </Link>
      )}
    </main>
  );
}
