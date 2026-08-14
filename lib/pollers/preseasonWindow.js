/**
 * lib/pollers/preseasonWindow.js - when to poll the NFL preseason, and how hard.
 *
 * The existing gridiron poller cannot serve this. isLiveWindow keys off a
 * league-wide 45-minutes-before / 5-hours-after pad and drives a 5-minute
 * cadence; preseason wants 60-SECOND cadence and a tight window, and it draws on
 * a metered subscription rather than an effectively free one. Mixing the two
 * would mean either over-polling the regular season or under-polling this.
 *
 * THE DECISION IS PURE AND CLOCK-INJECTABLE. Everything here takes `now` and a
 * list of games and returns a decision; nothing reads a clock or a database of
 * its own. That is what makes the window testable without waiting until 7pm on
 * a Thursday to find out it was wrong - which is the only other way to find out.
 *
 * THE WINDOW: a game is "hot" from KICKOFF - 15 MINUTES until FINAL + 30
 * MINUTES. Before kickoff we want the status flip promptly; after a final we
 * keep polling briefly because a provider marks a game FT on its own schedule,
 * not the stadium's, and the last score correction lands after the whistle. A
 * game whose status is already final and whose kickoff is hours behind is cold
 * regardless.
 *
 * THE POST-FINAL TAIL IS BOUNDED BY KICKOFF, NOT BY THE FINAL. We do not store
 * "when the provider said final", so the tail is computed from an assumed game
 * length: kickoff + MAX_GAME_HOURS + 30 minutes. A preseason game runs shorter
 * than a regular one, but the pad is generous on purpose - the cost of one extra
 * cold sweep is one request, and the cost of stopping early is a score that
 * never updates.
 *
 * THE BUDGET IS THE REAL CONSTRAINT, and it is enforced rather than assumed.
 * One request per sweep covers the WHOLE DAY SLATE - the provider's /games
 * endpoint takes a date - so a 16-game evening costs exactly what a 3-game
 * evening costs. At 60s over a 4-hour window that is 240 requests, plus the
 * daily sync. DAILY_REQUEST_CAP is the hard stop, checked against a real count
 * of the day's requests before every sweep.
 */

// Cadence.
export const HOT_INTERVAL_SEC = 60;
export const COLD_SYNC_HOURS = 12;

// Window pads.
export const PRE_KICKOFF_MIN = 15;
export const POST_FINAL_MIN = 30;
export const MAX_GAME_HOURS = 4;

/**
 * GAME DETAIL cadence - the scoring summary and player lines behind
 * /nfl/game/[slug].
 *
 * A DIFFERENT COST SHAPE ENTIRELY, which is why it gets its own number. The
 * score sweep is one request for the whole day slate; detail is PER GAME and
 * TWO requests each (/games/events + /games/statistics/players). Ten games live
 * at once is twenty requests a round, so the round has to be slow.
 *
 * TEN MINUTES, and the split of freshness is deliberate: the SCORE on the
 * scorecard stays 60 seconds, because that is the number people refresh for.
 * The scoring summary and the player lines lag it by up to ten minutes during
 * play, which for a preseason game nobody is watching on two screens is a
 * difference without a consequence.
 *
 * Plus ONE FINAL FETCH when a game flips to final, which is the fetch that
 * actually matters: it is the version that stays on the page forever.
 */
export const DETAIL_INTERVAL_MIN = 10;

/**
 * How many games may have their detail fetched in a single sweep.
 *
 * Not a budget control - the daily cap is that. This bounds ONE INVOCATION:
 * the cron has maxDuration 60, and ten games × two sequential requests is a
 * plausible way to hit it. With a ten-minute cadence and sixty-second sweeps
 * there are ten sweeps per cycle, so four per sweep clears a forty-game slate.
 */
export const DETAIL_GAMES_PER_SWEEP = 4;

/**
 * The hard per-day ceiling.
 *
 * SIZED AGAINST THE REAL SCHEDULE, NOT A GUESS. The first draft of this file
 * assumed a busiest case of a 6-hour spread and set the cap at 600. Then the
 * actual 2026 preseason landed and Saturday 22 August turned out to run
 * 12:00 to 22:00 ET - a TEN-hour spread, ten games. Its hot window is
 * 15min + 10h + 4h + 30min = 14.75 hours, which is 886 sweeps. The 600 cap
 * would have stopped polling around 10pm, mid-slate, on the biggest day of the
 * preseason, and reported itself as working correctly while doing it.
 *
 * 1,000 covered that day when a sweep cost exactly one request. GAME DETAIL
 * BROKE THAT ASSUMPTION, so here is the same day priced again:
 *
 *   score sweeps      886   one request each, unchanged
 *   detail rounds     420   10 games × a 3.5h game × one round per 10 min × 2
 *   final fetches      20   10 games × 2, once each
 *   daily sync          2   headroom
 *   ------------------------
 *                   1,328
 *
 * 1,400 covers it with room for a retry. It is 19% of the plan's 7,500/day, and
 * it still does the job a cap exists for: a runaway score sweep alone tops out
 * at 1,440 a day and would trip it.
 *
 * Re-price this whenever the schedule or the fetch shape changes. The test does
 * the arithmetic against the fixture rather than against a memory of it.
 */
export const DAILY_REQUEST_CAP = 1400;

const MIN = 60_000;
const HOUR = 3_600_000;

/**
 * Is this game inside its hot window?
 *
 * `game` needs only { kickoffAt, status }. A final game stays hot for the tail
 * so late corrections land; a postponed or cancelled game is never hot.
 */
export function isGameHot(game, now = new Date()) {
  const t = new Date(game?.kickoffAt ?? NaN).getTime();
  if (!Number.isFinite(t)) return false;
  if (game.status === 'postponed' || game.status === 'cancelled') return false;

  const opens = t - PRE_KICKOFF_MIN * MIN;
  const closes = t + MAX_GAME_HOURS * HOUR + POST_FINAL_MIN * MIN;
  const ms = now.getTime();
  return ms >= opens && ms <= closes;
}

/**
 * The sweep decision for a day's games.
 *
 * Returns one of:
 *   { poll: true,  reason: 'hot',   hotGames, nextCheckSec }
 *   { poll: true,  reason: 'daily-sync' }
 *   { poll: false, reason: 'cold' | 'capped' | 'no-games' }
 *
 * `requestsToday` and `lastSyncAt` are supplied by the caller from the ledger,
 * so this function stays pure.
 */
export function sweepDecision({
  games = [],
  now = new Date(),
  requestsToday = 0,
  lastSyncAt = null,
} = {}) {
  // The cap is checked FIRST and beats everything, including a hot window. A
  // budget that yields to "but the game is on" is not a budget.
  if (requestsToday >= DAILY_REQUEST_CAP) {
    return { poll: false, reason: 'capped', requestsToday, cap: DAILY_REQUEST_CAP };
  }

  const hot = games.filter((g) => isGameHot(g, now));
  if (hot.length > 0) {
    return { poll: true, reason: 'hot', hotGames: hot.length, nextCheckSec: HOT_INTERVAL_SEC };
  }

  // Nothing hot: take a low-cadence sync so schedule drift and any score we
  // missed still land. This is what makes the poller safe to leave running
  // outside an event evening.
  const sinceSync = lastSyncAt == null
    ? Infinity
    : (now.getTime() - new Date(lastSyncAt).getTime()) / HOUR;
  if (sinceSync >= COLD_SYNC_HOURS) {
    return { poll: true, reason: 'daily-sync', hoursSinceSync: sinceSync === Infinity ? null : Math.round(sinceSync * 10) / 10 };
  }

  if (games.length === 0) return { poll: false, reason: 'no-games' };
  return { poll: false, reason: 'cold' };
}

/**
 * Which games should have their detail fetched on THIS sweep.
 *
 * Pure, like everything else here: games in, ids out. Each game needs
 *   { id, status, kickoffAt, detailAt, detailFinal, finalSeenAt }
 * where detailAt is when detail was last fetched, detailFinal records that the
 * post-final fetch has already happened, and finalSeenAt is the first instant
 * the feed called this game final.
 *
 * THE FINAL FETCH IS THE POINT. A live game's detail is a convenience; the
 * version captured after the whistle is the one that sits on the page for the
 * rest of the season, so it is claimed first and it is claimed even when the
 * per-sweep allowance is otherwise spent on live games.
 *
 * IT KEYS ON finalSeenAt, NOT ON status === 'final', AND THAT IS THE WHOLE
 * FIX. The provider walks statuses backwards: on 13 Aug two finished games went
 * final -> live -> final inside two minutes, and a predicate reading the live
 * status only claims a game when a sweep happens to land while the feed is
 * telling the truth. TEN at SF lost that race for good - it never got its
 * post-whistle version, and its brief published a score two field goals stale.
 * A timestamp written once cannot be retracted by a flap, so the retry now
 * survives a feed that changes its mind.
 *
 * A game that is neither live nor newly final is not fetched at all. Before
 * kickoff there is nothing to fetch, and after the final fetch has landed there
 * is nothing new to get - the provider does not revise a preseason box score
 * three days later, and if it did, the daily sync is not the mechanism for
 * noticing.
 */
export function detailTargets({ games = [], now = new Date(), limit = DETAIL_GAMES_PER_SWEEP } = {}) {
  const ms = now.getTime();
  const due = [];
  const finals = [];

  for (const g of games) {
    if (!isGameHot(g, now)) continue;
    // Has EVER been final, whatever it says right now. The live status is still
    // honoured as a second route in: the stamp is written by the score sweep,
    // and a game that reached final without one (a backfill, a manual import)
    // must not be stranded because the stamp is missing.
    if (g.finalSeenAt || g.status === 'final') {
      if (!g.detailFinal) finals.push(g);
      continue;
    }
    if (g.status !== 'live') continue;
    const last = g.detailAt ? new Date(g.detailAt).getTime() : null;
    if (last == null || ms - last >= DETAIL_INTERVAL_MIN * MIN) due.push(g);
  }

  // Oldest first among the live ones, so a game does not starve behind another
  // that happens to sort earlier.
  due.sort((a, b) => (a.detailAt ? new Date(a.detailAt).getTime() : 0)
    - (b.detailAt ? new Date(b.detailAt).getTime() : 0));

  // `final` describes WHY the game was claimed, not what the feed says this
  // second - reading g.status here would have reported a mid-flap final fetch
  // as a routine live round, which is the same mistake one layer up.
  return [...finals, ...due].slice(0, limit)
    .map((g) => ({ id: g.id, final: !!(g.finalSeenAt || g.status === 'final') }));
}

/**
 * The ET calendar day. This is OUR day, and it is the right key for OUR rows:
 * matches are grouped the way /scores groups them, so the poller's database
 * read filters on (kickoff_at AT TIME ZONE 'America/New_York')::date.
 *
 * IT IS NOT THE KEY THE PROVIDER USES. See slateDatesForProvider below - this
 * function's original comment claimed the opposite and that claim is what let
 * the bug through review.
 */
export function slateDateEt(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/**
 * The UTC dates to ask the PROVIDER for, to cover one ET football evening.
 *
 * THE PROVIDER INDEXES ITS SLATE BY UTC DATE, and an ET evening spans two of
 * them. A 7:00pm ET kickoff is 23:00Z the same day; an 8:00pm ET kickoff is
 * 00:00Z the NEXT day. So /games?date=<ET day> returns only the games that
 * kicked off before 8pm ET and silently omits the rest.
 *
 * VERIFIED AGAINST THE LIVE FEED, 13 Aug 2026 at 20:25 ET:
 *   date=2026-08-13 -> 3 games (23:00Z, 23:00Z, 23:30Z)
 *   date=2026-08-14 -> 6 games (00:00Z, 00:00Z, 01:00Z, then Friday's three)
 * Three of that night's six games - the 8pm and 9pm ET kickoffs - were
 * invisible to the poller for the entire evening. They sat at 'scheduled', 0-0,
 * while they were being played, and would have taken no detail fetch, no
 * final-flip fetch and no brief.
 *
 * The previous version derived one date in ET and its own comment asserted that
 * "asking for the UTC date mid-game would request the wrong slate" - exactly
 * backwards for this provider. A wrong comment that sounds considered is worse
 * than no comment: it is why nobody looked again.
 *
 * TONIGHT'S NARROW FIX. Two dates is two requests per sweep where there was
 * one, which roughly doubles the score-sweep line of the budget. That is
 * affordable on a six-game Thursday and is NOT the durable answer for an
 * Aug-22-scale Saturday - deriving the exact UTC dates from the kickoffs we
 * already have stored keeps it at one request, and that lands with its own
 * sizing against DAILY_REQUEST_CAP.
 */
export function slateDatesForProvider(now = new Date()) {
  const etDay = slateDateEt(now);
  const next = new Date(`${etDay}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return [etDay, next.toISOString().slice(0, 10)];
}
