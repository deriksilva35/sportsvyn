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

async function oddsApiGet(pathAndQuery, sportKey) {
  const key = process.env.ODDS_API_KEY;
  if (!key) throw new Error('ODDS_API_KEY missing in env');
  const sep = pathAndQuery.includes('?') ? '&' : '?';
  const res = await fetch(`${BASE}${pathAndQuery}${sep}apiKey=${key}`);
  const budget = {
    requests_remaining: res.headers.get('x-requests-remaining'),
    requests_used: res.headers.get('x-requests-used'),
    requests_last: res.headers.get('x-requests-last'),
  };
  if (!res.ok) {
    const body = (await res.text()).slice(0, 200);
    const err = new Error(`TheOddsAPI ${res.status} on ${sportKey}: ${body}`);
    err.budget = budget;
    throw err;
  }
  const events = await res.json();
  return { events: Array.isArray(events) ? events : [], budget };
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
