/**
 * /age/blocked - the plain refusal. Reached after an under-13 answer (the
 * account is already deleted and the session cleared by then) or a retry from
 * a browser that was refused before. Says what Sportsvyn is for and nothing
 * else: no form, no "try again", no sign-in link.
 *
 * Signed-out browsing of scores and boards stays open; this page does not
 * pretend otherwise, it just does not invite a second answer.
 */

import Link from 'next/link';
import Wordmark from '@/components/Wordmark';
import { resolveShellMode, simViewport } from '@/lib/shell/shell';
import { MIN_AGE } from '@/lib/auth/ageGate';
import BlockedFlag from './BlockedFlag';
import '../age.css';

export const metadata = {
  title: 'Sportsvyn',
  robots: { index: false, follow: false },
};

export async function generateViewport() {
  return simViewport(await resolveShellMode());
}

export default async function AgeBlockedPage() {
  const isShell = await resolveShellMode();
  return (
    <main
      className={`age-page max-w-md mx-auto px-6 text-center ${isShell ? '' : 'py-24'}`}
      style={isShell ? { paddingTop: 'calc(2.5rem + env(safe-area-inset-top))', paddingBottom: 'calc(2.5rem + env(safe-area-inset-bottom))' } : undefined}
      data-age-screen="blocked"
    >
      <BlockedFlag />
      <Wordmark sizeClassName={isShell ? 'text-xl' : 'text-2xl sm:text-3xl'} />
      <h2 className="font-display font-black text-3xl text-paper-warm mt-12">
        Sportsvyn is for ages {MIN_AGE} and up
      </h2>
      <p className="font-serif italic text-muted mt-4">
        We can&rsquo;t create an account for you, and we haven&rsquo;t kept any of the details you entered.
      </p>
      <Link
        href="/scores"
        className="font-mono text-xs uppercase tracking-widest text-muted hover:text-volt mt-12 inline-block"
      >
        Back to scores
      </Link>
    </main>
  );
}
