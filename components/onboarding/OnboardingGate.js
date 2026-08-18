/**
 * components/onboarding/OnboardingGate.js — decides whether the sheet shows.
 *
 * SERVER COMPONENT, MOUNTED IN THE ROOT LAYOUT, so the sheet reaches every
 * route rather than the one tab that happened to import it. That is the whole
 * defect it fixes: the handle claim has only ever existed inside The Daily, and
 * two of sixty-one accounts have a handle.
 *
 * THE TRIGGER IS `handle IS NULL`. Not a cookie, not localStorage - those
 * re-prompt the same person on a second device, and the brief says never again
 * this season. The handle IS the completion state, so the sheet and the
 * database cannot disagree about whether somebody is done.
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
    SELECT id, handle, email, contact_email, name FROM users WHERE id = ${Number(userId)} LIMIT 1`
    .then((r) => r[0] ?? null)
    .catch(() => null);
  if (!user || !needsOnboarding(user)) return null;

  return <OnboardingSheet step2={emailStep(user)} initialName={user.name ?? ''} />;
}
