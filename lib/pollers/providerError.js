// lib/pollers/providerError.js - a provider failure reduced to what the crew may see.
//
// sat-1 (24 Oct 2026): CFBD /scoreboard answered 401 for hours and the ledger said ok. The
// poller now writes the failure into its sync_runs summary as
//   provider_error: { provider: 'cfbd', endpoint: 'scoreboard', status: 401, at: ISO }
// crew_stats.provider_errors_v reads it. ONLY a status code and an endpoint NAME go in: never
// the message body (CFBD's 401 body names a subscription tier) and never a URL with a key.

// "CFBD 401 on /scoreboard: ...", "BDL 429 on /nfl/v1/games". The endpoint stops at a query
// string, a colon or whitespace, so a key riding the query can never be captured.
const RE = /\b([A-Za-z][A-Za-z0-9_]*)\s+([1-5]\d\d)\s+on\s+\/?([A-Za-z0-9_\-/]+)/;

/** PURE. message -> { provider, endpoint, status, at } or null when it is not a provider HTTP error. */
export function parseProviderError(message, now = new Date()) {
  const m = RE.exec(String(message ?? ''));
  if (!m) return null;
  return {
    provider: m[1].toLowerCase(),
    endpoint: m[3].replace(/\/+$/, ''),
    status: Number(m[2]),
    at: new Date(now).toISOString(),
  };
}
