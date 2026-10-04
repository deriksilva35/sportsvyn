/**
 * GET /api/widget/v1 - the iOS widgets' feed (sun-22). Contract:
 * docs/widgets/feed-v1.md; shape: lib/widget/shape.js; reads: lib/widget/reads.js.
 *
 * AUTH: `Authorization: Bearer <session token>` - the app's own Auth.js
 * session token, which the app copies from its web view's cookie into the
 * shared app group (lib/widget/session.js). The cookie works too.
 *
 * ALWAYS A 200 FOR WHO-ARE-YOU: no token, a bad or expired one, and an account
 * that has not passed the age screen each get the feed envelope with `state`
 * saying so and empty data. The only non-200 is a 429 for a token that is
 * hammering the endpoint.
 *
 * READ-ONLY: GET only, no write door (lib/auth/ageGateDoors.test.mjs counts
 * POST/PUT/PATCH/DELETE; this file has none).
 *
 * ?teams=<id,id,...> (optional, up to 4): the teams the widget was configured
 * with from GET /api/widget/v1/teams. Absent, the teams block is the reader's
 * follows.
 */

import { tokenFrom, tokenKey, resolveWidgetSession, rateLimit, FEED_HEADERS } from '@/lib/widget/session';
import { feedFor } from '@/lib/widget/reads';
import { signedOutFeed, ageFeed, parseTeamIds, STATE_OK, STATE_AGE } from '@/lib/widget/shape';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const json = (body, status = 200, extra = {}) => Response.json(body, { status, headers: { ...FEED_HEADERS, ...extra } });

export async function GET(request) {
  const now = new Date();
  const token = tokenFrom(request);
  if (!token) return json(signedOutFeed(now));

  const limited = rateLimit(tokenKey(token), now.getTime());
  if (!limited.ok) {
    return json({ v: 1, state: 'rate_limited', generatedAt: now.toISOString(), retryAfter: limited.retryAfter }, 429,
      { 'Retry-After': String(limited.retryAfter) });
  }

  const who = await resolveWidgetSession(token, { now });
  if (who.state === STATE_AGE) return json(ageFeed(now));
  if (who.state !== STATE_OK) return json(signedOutFeed(now));

  const teamIds = parseTeamIds(new URL(request.url).searchParams.get('teams'));
  const { payload } = await feedFor(who.userId, { now, teamIds });
  return json(payload);
}
