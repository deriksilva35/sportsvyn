/**
 * lib/theOddsApi.js — The Odds API v4 client (gridiron market ingest).
 *
 * One sport-level /odds call returns ALL upcoming events for the sport with the
 * requested markets. Credit cost = markets x regions = h2h,spreads,totals x us =
 * 3 credits per call. Budget ground truth comes from the response headers
 * (x-requests-remaining / x-requests-used), captured for runRecorder.
 *
 * Env: ODDS_API_KEY (passed as the ?apiKey= query param per the vendor API;
 * never logged). Soccer odds run on a DIFFERENT vendor (API-Sports) and do not
 * touch this key or its 100K/mo credit plan.
 */

const BASE = 'https://api.the-odds-api.com/v4';

export const SPORT_KEYS = {
  nfl: 'americanfootball_nfl',
  cfb: 'americanfootball_ncaaf',
};

// Outright (futures) sport keys — the only football futures The Odds API exposes:
// the championship winner per league. markets=outrights x regions=us = 1 credit.
export const SPORT_FUTURES_KEYS = {
  nfl: 'americanfootball_nfl_super_bowl_winner',
  cfb: 'americanfootball_ncaaf_championship_winner',
};

// ============================ RETRY POLICY ==================================
//
// WHAT THIS IS FOR. On 2026-08-05 22:00:19 the nfl-odds baseline died on a bare
// `TypeError: fetch failed` - a dropped socket, not an outage. The cfb leg of
// the SAME invocation succeeded seconds later on the same egress, so one retry
// would almost certainly have saved the run. That was 1 failure in 167 weekly
// runs; this exists so the next one costs nothing rather than an hour of stale
// odds.
//
// WHAT IS RETRIED, AND WHAT IS NOT. Only faults that a second attempt can
// plausibly fix:
//   · network errors (fetch rejects: reset, refused, DNS blip, timeout)
//   · 5xx and 429 from the vendor
// A 4xx is NOT retried. 401/403 means the key is wrong and 422 means the query
// is wrong; repeating either just asks a rejection twice. 429 is retried
// because the backoff is exactly the remedy it asks for.
//
// CREDITS. A rejected fetch never reached the vendor, so it was never counted -
// the budget headers do not move. A retry costs credits only when it SUCCEEDS,
// which is the outcome we wanted anyway. At 3 credits a call against ~99,285
// remaining this is not a budget question.
//
// THE TIME ENVELOPE, stated because a retry that overlaps the next poll would
// stack requests:
//   · Only caller: /api/cron/gridiron-odds, cadence */15 (900s between ticks),
//     maxDuration 60s. The 1-minute poll-live poller is a different vendor and
//     never reaches this module.
//   · Per attempt: 8s timeout. Backoff between attempts: 1s then 4s.
//   · Worst case for one call: 8 + 1 + 8 + 4 + 8 = 29s.
//   · STACKING IS STRUCTURALLY IMPOSSIBLE HERE: Vercel kills the function at
//     maxDuration 60s, which is far below the 900s cycle. The retry envelope
//     cannot outlive the invocation, let alone reach the next tick. The
//     worst case is the same lost run we already tolerate today.
const ATTEMPTS = 3;
const BACKOFF_MS = [1000, 4000]; // between attempt 1->2 and 2->3
const ATTEMPT_TIMEOUT_MS = 8000;

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

// Retryable: a thrown network/timeout error, or a response we were handed with
// a status worth asking again about.
function retryableStatus(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

async function oddsApiGet(pathAndQuery, sportKey) {
  const key = process.env.ODDS_API_KEY;
  if (!key) throw new Error('ODDS_API_KEY missing in env');
  const sep = pathAndQuery.includes('?') ? '&' : '?';
  const url = `${BASE}${pathAndQuery}${sep}apiKey=${key}`;

  let lastErr = null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let res;
    try {
      // A bare fetch has no timeout and can hang until the function is killed,
      // which is a worse failure than the one this retry is for.
      res = await fetch(url, { signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS) });
    } catch (e) {
      // Network-layer: nothing reached the vendor, nothing was charged.
      lastErr = e;
      if (attempt < ATTEMPTS) { await sleep(BACKOFF_MS[attempt - 1]); continue; }
      // Preserve the original error's shape - callers and the alert read it.
      lastErr.attempts = attempt;
      throw lastErr;
    }

    const budget = {
      requests_remaining: res.headers.get('x-requests-remaining'),
      requests_used: res.headers.get('x-requests-used'),
      requests_last: res.headers.get('x-requests-last'),
    };

    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      const err = new Error(`TheOddsAPI ${res.status} on ${sportKey}: ${body}`);
      err.budget = budget;
      err.attempts = attempt;
      if (retryableStatus(res.status) && attempt < ATTEMPTS) {
        lastErr = err;
        await sleep(BACKOFF_MS[attempt - 1]);
        continue;
      }
      throw err; // 4xx, or retries exhausted
    }

    const events = await res.json();
    // `attempts` rides back with the payload so the run summary can record that
    // this succeeded on the second or third try. A blip absorbed silently is a
    // degrading network path nobody finds out about until it stops working;
    // ledgering it makes "once a month" and "twice a day" tell different stories.
    return { events: Array.isArray(events) ? events : [], budget, attempts: attempt };
  }

  throw lastErr ?? new Error(`TheOddsAPI: exhausted ${ATTEMPTS} attempts on ${sportKey}`);
}

// GET /v4/sports/{key}/odds?regions=us&markets=h2h,spreads,totals (3 credits).
export async function fetchSportOdds(sportKey) {
  return oddsApiGet(`/sports/${sportKey}/odds?regions=us&markets=h2h,spreads,totals&oddsFormat=decimal`, sportKey);
}

// GET /v4/sports/{key}/odds?regions=us&markets=outrights (1 credit). Returns the
// futures event(s) whose bookmakers carry a single 'outrights' market listing the
// whole field (32-way NFL, ~130-way CFB) of team outcomes + prices.
export async function fetchSportOutrights(sportKey) {
  return oddsApiGet(`/sports/${sportKey}/odds?regions=us&markets=outrights&oddsFormat=decimal`, sportKey);
}
