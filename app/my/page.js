// app/my/page.js - /my is /you (sun-16 D).
//
// The proxy answers /my and /my/* with a 308 before this file is reached
// (lib/you/legacyRedirect.js). This is the second line, in case the matcher is
// ever narrowed: the same destination, the query kept.
//
// WHAT /my HAD, AND WHERE IT WENT (the audit, sun-16 D):
//   followed players and their recent lines  -> /you, "Players you follow"
//   your schedule (each followed team's next) -> /you, beside each team
//   recent mock drafts (My Fantasy)           -> /you, "Your drafts"
//   contests, Pick'em, the urgency hero       -> /games (live state) and /you's
//                                                "Your season" (the record)
//   Today & Next, Live Now, Watch Scores      -> /scores (league-wide, not yours)
//   AP Top 25, ADP Movers                     -> /rankings, /market
//   the customize mode (panel order)          -> retired with the page; the
//                                                registry and user_dashboards
//                                                rows stay (Today's scope uses
//                                                the same machinery)

import { permanentRedirect } from 'next/navigation';
import { youRedirectFromParams } from '@/lib/you/legacyRedirect';

export const dynamic = 'force-dynamic';
// Private, like every route under the prefix (lib/seo/routes.js) - a fallback
// that ever rendered must not be the one indexable copy.
export const metadata = { robots: { index: false, follow: false } };

export default async function MyPage({ searchParams }) {
  permanentRedirect(youRedirectFromParams('/my', (await searchParams) ?? {}));
}
