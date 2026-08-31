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
// DEBT, LOGGED RATHER THAN CHURNED (Aug chrome sweep): this page renders
// components/Wordmark, while every ink header renders
// components/gridiron/Wordmark and the app container renders a third in
// GlobalHeader. Three implementations of one mark. This one is already
// shell-aware (it varies its size class) so nothing is broken, and
// consolidating it is a polish-pass item, not worth the churn mid-block.


import Link from 'next/link';
import Wordmark from '@/components/Wordmark';
import SignInForm from './SignInForm';
import AppleSignInButton from './AppleSignInButton';
import { resolveShellMode, simViewport } from '@/lib/shell/shell';

// noindex: an auth flow has nothing to rank and should never be a search result.
// This was PUBLICLY INDEXABLE until the noindex-lift audit — it had no robots block
// at all, so it was never covered by the blanket noindex it appeared to be under.
// Policy: lib/seo/routes.js (NOINDEX_PREFIXES includes '/signin').
export const metadata = {
  title: 'Sign in — Sportsvyn',
  robots: { index: false, follow: false },
};

// In the Draftvyn shell, opt into viewport-fit:cover so env(safe-area-inset-*)
// resolves; web returns the same base viewport (unchanged).
export async function generateViewport() {
  return simViewport(await resolveShellMode());
}

export default async function SignInPage({ searchParams }) {
  const params = await searchParams;
  const initialError =
    typeof params?.error === 'string' ? params.error : null;
  const callbackUrl =
    typeof params?.callbackUrl === 'string' ? params.callbackUrl : '/';
  // Shell-aware (via ?shell=sim-app param, or the sv_shell cookie set on /sim).
  // Web version is unaffected — isShell is false there.
  const isShell = await resolveShellMode();

  return (
    <main
      className={`max-w-md mx-auto px-6 text-center ${isShell ? '' : 'py-24'}`}
      style={isShell ? { paddingTop: 'calc(2.5rem + env(safe-area-inset-top))', paddingBottom: 'calc(2.5rem + env(safe-area-inset-bottom))' } : undefined}
    >
      <Wordmark sizeClassName={isShell ? 'text-xl' : 'text-2xl sm:text-3xl'} />
      <h1 className="font-display font-black text-3xl text-paper-warm mt-12">
        Sign in or create your account
      </h1>
      {/* ONE LINE OF IDENTITY, SHELL ONLY. In the container this screen is now
          the launch surface - the App Store listing did the selling, so there is
          no hero in front of it any more - and a bare form is a form with no
          reason attached. It is the hero's identity line and nothing else: what
          signing in gets you, not a pitch for the product they already
          installed. The web still arrives here from a hero that said all this,
          so repeating it there would be the same sentence twice. */}
      {isShell && (
        <p className="font-serif italic text-paper-warm mt-4">
          Pick a handle - the name beside your score in every game.
        </p>
      )}
      <p className={`font-serif italic text-muted ${isShell ? 'mt-2' : 'mt-4'}`}>
        Use your Apple&nbsp;ID, or we&apos;ll email you a 6-digit sign-in code.
      </p>

      <div className="mt-12 w-full">
        <AppleSignInButton callbackUrl={callbackUrl} />

        <div className="mt-8">
          <div className="h-px bg-charcoal" />
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted mt-4">
            or get a sign-in code by email
          </p>
        </div>

        <SignInForm initialError={initialError} callbackUrl={callbackUrl} />
      </div>

      {/* SHELL (App Store 3.1.1): the pricing page is a purchase path, so the
          link is not rendered inside the app at all. Web unchanged. */}
      {!isShell && (
        <p className="font-mono text-[11px] uppercase tracking-widest text-muted mt-8">
          Everything is free this season.{' '}
          <a href="/membership" className="underline hover:text-volt">What that means →</a>
        </p>
      )}

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
