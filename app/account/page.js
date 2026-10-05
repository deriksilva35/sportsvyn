// app/account/page.js - /account is /you (sun-16 D).
//
// The proxy answers /account and /account/* with a 308 before this file is
// reached (lib/you/legacyRedirect.js). This is the second line, in case the
// matcher is ever narrowed: the same destination, the query kept.
//
// WHAT /account HAD, AND WHERE IT WENT (the audit, sun-16 D) - all on /you:
//   signed in as (email)              -> Settings, "Signed in as"
//   push notifications toggle (shell) -> Alerts, the same NotificationsRow
//   membership: status, plan, billed
//     through, renews, manage / what
//     is free (web only, 3.1.1)       -> Membership, for members AND free
//   your drafts                       -> "Your drafts", the same YourDrafts
//   teams you follow                  -> "Teams you follow" (each team's page
//                                        star undoes it; Follow a team adds)
//   draft settings, account deletion  -> Settings: Delete account inline (the
//                                        same DeleteAccount, 5.1.1(v)) and a
//                                        Draft settings row to /sim/account
//   privacy, terms                    -> the foot
//   sign out                          -> Settings, the same SignOutButton (it
//                                        also logs out of RevenueCat)

import { permanentRedirect } from 'next/navigation';
import { youRedirectFromParams } from '@/lib/you/legacyRedirect';

export const dynamic = 'force-dynamic';
// Private, like every route under the prefix (lib/seo/routes.js) - a fallback
// that ever rendered must not be the one indexable copy.
export const metadata = { robots: { index: false, follow: false } };

export default async function AccountPage({ searchParams }) {
  permanentRedirect(youRedirectFromParams('/account', (await searchParams) ?? {}));
}
