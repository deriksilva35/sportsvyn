/**
 * /api/cron/poll-live — Vercel cron target. Schedule: every minute.
 *
 * Auth: Bearer ${CRON_SECRET} per Vercel docs. Vercel attaches this
 * header automatically when the cron fires; manual hits without the
 * header return 401 so the endpoint can't be turned into a public
 * API-Sports proxy.
 *
 * Tick flow (order matters):
 *   1. STUCK-LIVE SWEEP (always runs) — resolves matches that have been
 *      status='live' longer than STUCK_LIVE_TIMEOUT_MIN (lib/
 *      stuckLiveSweep.js). Calls one apiSports.fixture per candidate to
 *      confirm; force-flips to final if the API call fails OR confirms
 *      FT. Crucially, this still runs when the daily-cap breaker is
 *      tripped — it just operates in fallback mode (no API call, force-
 *      flip from last-known DB score). Prevents stuck-live matches
 *      becoming a permanent quota drain.
 *   2. CIRCUIT-BREAKER CHECK — if the daily-cap sentinel is engaged for
 *      the current UTC date, skip the normal poll loop entirely. We
 *      already know API calls will fail; no point hammering. The
 *      breaker auto-clears at UTC midnight via the date comparison in
 *      isDailyCapTripped().
 *   3. NORMAL POLL — query getMatchesToPoll() (lib/liveMatches.js), sync
 *      each fixture, capture the live watch score tick. Per-match
 *      try/catch isolation as before. A DailyCapError surfaced during
 *      this loop trips the breaker and halts the rest of the tick.
 */

import { getMatchesToPoll } from '@/lib/liveMatches';
import { syncFixture } from '@/lib/syncFixture';
import { captureLiveWatchScoreTick } from '@/lib/captureLiveWatchScore';
import { sweepStuckLive } from '@/lib/stuckLiveSweep';
import { isDailyCapTripped, tripDailyCap } from '@/lib/cronCircuitBreaker';
import { DailyCapError } from '@/lib/apiSports';
import { freezeAndGradeLedger } from '@/lib/marketLedger';
import { syncRecentFinalsPlayerStats } from '@/lib/playerStatsSync';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (
    !process.env.CRON_SECRET ||
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return new Response('Unauthorized', { status: 401 });
  }

  // STEP 1: stuck-live sweep — always runs, even when the breaker is
  // tripped. We read the breaker state first so the sweep knows whether
  // it can poll-once-before-flip or has to go straight to fallback.
  let breakerTripped = await isDailyCapTripped();
  const sweep = await sweepStuckLive({ breakerTripped });
  if (sweep.swept > 0) {
    console.log(
      `poll-live sweep: ${sweep.swept} stuck-live candidates ·`,
      `${sweep.resolved.length} resolved ·`,
      `${sweep.wouldNotFlip.length} left live (API confirmed still playing)`,
    );
  }
  // The sweep may have detected the daily cap itself (via its own
  // poll-once attempt) and tripped the breaker. Re-read so STEP 2 sees
  // the latest state.
  breakerTripped = await isDailyCapTripped();

  // STEP 2: breaker gate — if engaged, skip the main poll loop. The
  // sweep already ran; nothing else useful to do this tick.
  if (breakerTripped) {
    return Response.json({
      polled: 0,
      matches: [],
      breaker: 'tripped',
      sweep,
    });
  }

  // STEP 3: normal poll loop.
  const matches = await getMatchesToPoll();

  const results = [];
  let trippedMidLoop = false;
  for (const m of matches) {
    if (trippedMidLoop) {
      // Daily-cap surfaced during this tick. Don't keep hammering;
      // record the un-polled matches in the response for visibility.
      results.push({ id: m.id, slug: m.slug, skipped: 'daily_cap_tripped' });
      continue;
    }
    const apiId = Number(m.api_sports_id);
    if (!Number.isInteger(apiId) || apiId <= 0) {
      results.push({ id: m.id, slug: m.slug, error: 'invalid api_sports id' });
      continue;
    }
    try {
      const r = await syncFixture(apiId);
      try {
        await captureLiveWatchScoreTick(r.match_id, r);
      } catch (capErr) {
        console.error(
          `captureLiveWatchScoreTick failed for match ${r.match_id} (${r.slug}):`,
          capErr,
        );
      }
      results.push({
        id: r.match_id,
        slug: r.slug,
        status: r.status,
        score: { home: r.home_score, away: r.away_score },
        minute: r.minute,
      });
    } catch (err) {
      // Daily-cap detected mid-loop: trip the breaker now (so the next
      // tick reads it as engaged + the sweep treats subsequent stuck-
      // live matches as fallback) and stop hammering this loop.
      if (err instanceof DailyCapError) {
        await tripDailyCap({ reason: 'detected_in_poll_loop' });
        trippedMidLoop = true;
        results.push({
          id: m.id,
          slug: m.slug,
          error: 'daily_cap_tripped_breaker',
        });
        continue;
      }
      // syncFixture already wrote its own error row to sync_log.
      results.push({
        id: m.id,
        slug: m.slug,
        error: String(err?.message ?? err),
      });
    }
  }

  // LEDGER: freeze non-fair 1X2 tags at kickoff, grade at the whistle. Runs
  // every tick, independent of the poll batch (status-based sweep), so a
  // just-final match still grades and a missed-kickoff match still freezes
  // (catch-up). Isolated so a ledger error never breaks the poll.
  let ledger = null;
  try {
    ledger = await freezeAndGradeLedger();
  } catch (err) {
    console.error('poll-live ledger sweep failed:', err);
  }

  // PLAYER STATS: ingest / +24h re-sync per-player match stats for recent WC
  // finals. Sibling to the ledger sweep; isolated so it can never break the
  // poll. The query is a cheap no-op when no recent final is due.
  let playerStats = null;
  try {
    playerStats = await syncRecentFinalsPlayerStats();
  } catch (err) {
    console.error('poll-live player-stats sweep failed:', err);
  }

  return Response.json({
    polled: results.length,
    matches: results,
    sweep,
    ledger,
    playerStats,
    breaker_tripped_mid_loop: trippedMidLoop,
  });
}
