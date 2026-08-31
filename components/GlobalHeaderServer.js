/**
 * GlobalHeaderServer - resolves session, shell mode and MEMBERSHIP on the
 * server and prop-drills all three into the client header.
 *
 * Replaces SiteHeaderServer. Every page imports THIS rather than the client
 * component, so the header never calls useSession(), never needs a
 * SessionProvider, and costs no hydration round trip for state the server
 * already knows.
 *
 * THE MEMBER READ IS THE NEW PART, and it is the reason this file exists
 * rather than the header reading a boolean off the session. The old ink header
 * hardcoded a MEMBER chip in its markup, so it rendered for signed-out
 * visitors too. `sim` from getEntitlements is the same entitlement the draft
 * gates flip on - an active subscription OR an unexpired pass - so the badge
 * and the product now agree by construction rather than by memory.
 */

import { auth } from '@/auth';
import { resolveShellMode } from '@/lib/shell/shell';
import { getEntitlements } from '@/lib/membership';
import GlobalHeader from '@/components/GlobalHeader';
import OnboardingGate from '@/components/onboarding/OnboardingGate';
import PushReRegister from '@/components/push/PushReRegister';

export default async function GlobalHeaderServer({ activeNav = null }) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const [isShell, ent] = await Promise.all([
    resolveShellMode(),
    // A membership read must never be able to cost a header. Signed-out users
    // skip it entirely; a failure reads as "not a member", which is the safe
    // direction for a badge.
    userId ? getEntitlements(userId).catch(() => null) : Promise.resolve(null),
  ]);
  return (
    <>
      <GlobalHeader
        session={session}
        activeNav={activeNav}
        shell={isShell}
        isMember={!!ent?.sim}
      />
      {/* THE SHEET RIDES WITH THE CHROME. Mounting it in the ROOT LAYOUT would
          be tidier, but OnboardingGate calls auth() and cookies() in a root
          layout turns every prerendered page dynamic - /privacy and /terms
          included, which is the same trap the app tab bar hit. This component
          is already async, already resolves the session, and already renders on
          every chrome-bearing surface, so the sheet costs one indexed read on
          pages that are dynamic anyway. The five /sim pages draw their own
          header and mount it separately. */}
      <OnboardingGate />
      <PushReRegister />
    </>
  );
}
