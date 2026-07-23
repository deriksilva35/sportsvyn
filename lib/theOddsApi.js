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

// GET /v4/sports/{key}/odds?regions=us&markets=h2h,spreads,totals&oddsFormat=decimal
export async function fetchSportOdds(sportKey) {
  const key = process.env.ODDS_API_KEY;
  if (!key) throw new Error('ODDS_API_KEY missing in env');
  const url = `${BASE}/sports/${sportKey}/odds?regions=us&markets=h2h,spreads,totals&oddsFormat=decimal&apiKey=${key}`;
  const res = await fetch(url);
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
