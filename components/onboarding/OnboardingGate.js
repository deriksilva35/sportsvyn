/**
 * components/onboarding/OnboardingGate.js — decides whether the sheet shows.
 *
 * SERVER COMPONENT, MOUNTED ON SIX PAGES - NOT the root layout, whatever an
 * earlier version of this comment claimed. app/layout.js does not reference
 * it. The real mount points are:
 *
 *   app/sim/page.js            app/sim/tracker/page.js
 *   app/sim/history/page.js    app/sim/account/page.js
 *   app/sim/draft/[id]/page.js app/join/[code]/page.js
 *
 * so the sheet reaches /sim and /join and no other route. That is now the
 * intended scope rather than a shortfall: THE HANDLE IS NO LONGER ASKED FOR
 * HERE. It moved to the first write to a ranked contest - the first Weekly
 * slot, seat, Pick'em pick or Daily commit - which is where somebody has
 * actually made something worth naming. See components/handle/HandleGate.js.
 * What survives on these six pages is the REST of the sheet: the optional
 * contact address, the optional name, and the push pre-warm.
 *
 * THE TRIGGER IS NOW `onboarded_at IS NULL`, not `handle IS NULL`. With the
 * handle gone from step 1 this sheet no longer writes that column, so the
 * old trigger could never be satisfied by finishing - it would have
 * re-shown on every load forever. completeOnboarding() sets onboarded_at.
 * Still not a cookie and not localStorage: those re-prompt the same person
 * on a second device, and the brief says never again this season.
 *
 * IT COSTS ONE QUERY, AND ONLY WHEN SIGNED IN. auth() is already resolved on
 * every page that renders chrome; the extra work is a single indexed read, and
 * it stops entirely once a handle exists.
 *
 * CAUGHT TO NULL. An onboarding sheet must never be the reason a page fails to
 * render - the worst outcome of a failure here is that we ask tomorrow.
 */

import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { needsOnboarding, emailStep } from '@/lib/onboarding';
import OnboardingSheet from './OnboardingSheet';
import './onboarding.css';

export default async function OnboardingGate() {
  const session = await auth().catch(() => null);
  const userId = session?.user?.id ?? null;
  if (userId == null) return null;

  const user = await sql`
    SELECT id, handle, email, contact_email, name, onboarded_at FROM users WHERE id = ${Number(userId)} LIMIT 1`
    .then((r) => r[0] ?? null)
    .catch(() => null);
  if (!user || !needsOnboarding(user)) return null;

  return <OnboardingSheet step2={emailStep(user)} initialName={user.name ?? ''} />;
}
