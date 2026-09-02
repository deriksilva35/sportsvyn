// app/join/[code]/page.js - the share target for an imported league (085).
//
// /join/CODE is what rides the group chat. Signed out, the reader goes to
// sign-in with THIS URL as the callback (the code must survive the round trip,
// or a friend would authenticate into a page that forgot why they came - the
// same law as /leagues?join=). Signed in, the claim screen: the league's
// franchises with the taken ones marked, tap yours, in. A dud/expired/full
// code renders a sentence naming the league when it can, never a 404 - a bad
// link punishes the FRIEND for the owner's typo.
//
// NO WRITE ON THIS RENDER. Joining is the tap on the claim screen
// (redeemInvite action), so a preview is a preview.

import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import Wordmark from '@/components/gridiron/Wordmark';
import HideInShell from '@/components/shell/HideInShell';
import ShellPersist from '@/components/sim/ShellPersist';
import JoinClaim from '@/components/sim/JoinClaim';
import OnboardingGate from '@/components/onboarding/OnboardingGate';
import { resolveShellMode, simViewport } from '@/lib/shell/shell';
import { shellSigninHref } from '@/lib/shell/signinHref';
import { invitePreview, normalizeInviteCode } from '@/lib/fantasy/leagueShare';
import '@/components/gridiron/gridiron.css';
import '@/components/sim/sim.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Join a league - Sportsvyn', robots: { index: false, follow: false } };

export async function generateViewport() {
  return simViewport(await resolveShellMode());
}

export default async function JoinPage({ params }) {
  const { code: raw } = await params;
  const code = normalizeInviteCode(raw) ?? String(raw ?? '').slice(0, 16);
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const isShell = await resolveShellMode();
  // Signed out on EVERY surface: sign-in first, then back here. There is no
  // web hero for a join link - the link is the pitch.
  if (userId == null) redirect(shellSigninHref(`/join/${encodeURIComponent(code)}`, isShell));

  const preview = await invitePreview(code, userId);

  return (
    <div className={`sim sim--stack${isShell ? ' sim--shell' : ''}`} data-surface="ink">
      {isShell && <ShellPersist />}
      <OnboardingGate />
      <HideInShell>
        <header className="sim-head"><Wordmark href="/sim" /></header>
      </HideInShell>
      <main className="sim-main">
        <div className="sim-kicker">You&rsquo;re invited</div>
        <JoinClaim code={code} preview={preview} />
      </main>
    </div>
  );
}
