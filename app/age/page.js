/**
 * /age - the age screen. Asked once of every account, before any game: new
 * sign-ups land here straight after auth, existing accounts on their next
 * visit (proxy.js -> /age/check -> here, only while no birth date is stored).
 *
 * NEUTRAL BY DESIGN (COPPA). A date of birth, three empty pickers, no default
 * and no adult pre-fill, and no copy that hints at the cutoff - the number
 * appears only on /age/blocked, after the answer. lib/auth/ageGate.test.mjs
 * reads this file and AgeForm.js and fails on any digit-age wording.
 *
 * SERVER component: the session and the "already answered" read happen here;
 * the form is a client island (AgeForm).
 */

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { auth } from '@/auth';
import Wordmark from '@/components/Wordmark';
import { resolveShellMode, simViewport } from '@/lib/shell/shell';
import { hasPassed } from '@/lib/auth/ageGateDb';
import { AGE_BLOCK_COOKIE, AGE_BLOCKED_PATH, AGE_CHECK_PATH, safeNext } from '@/lib/auth/ageGate';
import AgeForm from './AgeForm';
import '../signin/signin.css';
import './age.css';

export const metadata = {
  title: 'Your date of birth — Sportsvyn',
  robots: { index: false, follow: false },
};

export async function generateViewport() {
  return simViewport(await resolveShellMode());
}

export default async function AgePage({ searchParams }) {
  const params = await searchParams;
  const next = safeNext(params?.next);
  const jar = await cookies();
  const session = await auth();
  const userId = session?.user?.id ?? null;

  if (userId == null) {
    redirect(jar.get(AGE_BLOCK_COOKIE)?.value ? AGE_BLOCKED_PATH : '/');
  }
  if (jar.get(AGE_BLOCK_COOKIE)?.value || await hasPassed(userId)) {
    redirect(`${AGE_CHECK_PATH}?next=${encodeURIComponent(next)}`);
  }
  const isShell = await resolveShellMode();

  return (
    <main
      className={`age-page max-w-md mx-auto px-6 text-center ${isShell ? '' : 'py-24'}`}
      style={isShell ? { paddingTop: 'calc(2.5rem + env(safe-area-inset-top))', paddingBottom: 'calc(2.5rem + env(safe-area-inset-bottom))' } : undefined}
      data-age-screen="dob"
    >
      <Wordmark sizeClassName={isShell ? 'text-xl' : 'text-2xl sm:text-3xl'} />
      <h2 className="font-display font-black text-3xl text-paper-warm mt-12">
        What&rsquo;s your date of birth?
      </h2>
      <p className="font-serif italic text-muted mt-4">
        We ask everyone once, before their first game. It stays private.
      </p>
      <AgeForm next={next} />
      <p className="font-mono text-[11px] uppercase tracking-widest text-muted mt-10">
        <Link href="/privacy" className="underline hover:text-volt">Privacy Policy</Link>
      </p>
    </main>
  );
}
