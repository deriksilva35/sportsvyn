/**
 * GET /api/widget/v1/teams - the widget's team picker (sun-22).
 * { v, state, generatedAt, cta, followed: [team], teams: [team] }
 * followed = the reader's follows, newest first; teams = every other team the
 * widget covers (lib/widget/reads.js WIDGET_LEAGUES), by league then name.
 * Each team: { id, abbr, name, league, color, altColor }.
 *
 * Same auth and same 200-always states as GET /api/widget/v1. Signed out and
 * age-pending still get the full `teams` list (it is public) with `followed`
 * empty, so a picker can draw before sign-in.
 */

import { tokenFrom, tokenKey, resolveWidgetSession, rateLimit, FEED_HEADERS } from '@/lib/widget/session';
import { pickerTeams, WIDGET_LEAGUES } from '@/lib/widget/reads';
import { pickerFeed, STATE_OK } from '@/lib/widget/shape';
import { getFollowedTeams } from '@/lib/follows';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEADERS = { ...FEED_HEADERS, 'Cache-Control': 'private, max-age=300' };

export async function GET(request) {
  const now = new Date();
  const token = tokenFrom(request);
  if (token) {
    const limited = rateLimit(tokenKey(token), now.getTime());
    if (!limited.ok) {
      return Response.json({ v: 1, state: 'rate_limited', generatedAt: now.toISOString(), retryAfter: limited.retryAfter },
        { status: 429, headers: { ...HEADERS, 'Retry-After': String(limited.retryAfter) } });
    }
  }
  const who = token ? await resolveWidgetSession(token, { now }) : { state: 'signed_out', userId: null };
  const [all, followed] = await Promise.all([
    pickerTeams({ now }).catch(() => []),
    who.state === STATE_OK
      ? getFollowedTeams(who.userId).then((ts) => ts.filter((t) => WIDGET_LEAGUES.includes(t.leagueSlug))).catch(() => [])
      : [],
  ]);
  return Response.json(pickerFeed({ state: who.state, followed, all, now }), { headers: HEADERS });
}
