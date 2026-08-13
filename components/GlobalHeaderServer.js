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

export default async function GlobalHeaderServer({ activeNav = null }) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const [isShell, ent] = await Promise.all([
    resolveShellMode(null),
    // A membership read must never be able to cost a header. Signed-out users
    // skip it entirely; a failure reads as "not a member", which is the safe
    // direction for a badge.
    userId ? getEntitlements(userId).catch(() => null) : Promise.resolve(null),
  ]);
  return (
    <GlobalHeader
      session={session}
      activeNav={activeNav}
      shell={isShell}
      isMember={!!ent?.sim}
    />
  );
}
