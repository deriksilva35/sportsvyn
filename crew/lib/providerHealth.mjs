// crew/lib/providerHealth.mjs - provider-health: last successful write per feed vs its cadence.
// Reads crew_stats.provider_freshness_v (provider, last_ok_at, max_age_min, expected).
// A feed is STALE when a write is expected right now (a live game, in season, past the morning
// cron) and its last write is older than max_age_min. Cadences: crew/watch-rules.md.
// sat-1: ALSO reads crew_stats.provider_errors_v (the live poller's last provider failure per
// source). A 401 or 403 within AUTH_WINDOW_MIN counts as STALE for that provider whatever its
// age: freshness is max(updated_at) and other writers keep bumping it while the feed is dead.
// Other statuses (429, 5xx) stay informational unless the provider is stale by age too.
import { parseArgs, requireReaderUrl } from './common.mjs';
import { query, num } from './db.mjs';

// RETIRED feeds are dropped from the list entirely (mon-5): 'injuries' was the wire cron, whose
// cron and pages were retired 29 Sep (4093afad) and which nothing reads. Dropped here as well as
// from provider_freshness_v, so a database whose view still lists it reads the same.
export const RETIRED = Object.freeze(['injuries']);
export const AUTH_STATUSES = Object.freeze([401, 403]);
export const AUTH_WINDOW_MIN = 15;

/** PURE. rows: [{ provider, max_age_min, expected, age_min }] (age_min null = never wrote). */
export function summarize(rows, errorRows = []) {
  const list = rows.filter((r) => !RETIRED.includes(r.provider)).map((r) => ({
    provider: r.provider,
    expected: r.expected === true || r.expected === 't' || r.expected === 'true',
    maxAge: num(r.max_age_min),
    age: r.age_min === null || r.age_min === undefined ? null : num(r.age_min),
  }));
  for (const p of list) p.stale = p.expected && (p.age === null || p.age > p.maxAge);
  // Auth errors: [{ provider, endpoint, status, age_min }], newest per provider wins.
  const auth = new Map();
  for (const e of errorRows) {
    const status = num(e.status), age = num(e.age_min);
    if (!AUTH_STATUSES.includes(status) || !(age <= AUTH_WINDOW_MIN)) continue;
    const provider = String(e.provider).toLowerCase();
    if (!auth.has(provider) || age < auth.get(provider).age) auth.set(provider, { provider, endpoint: String(e.endpoint), status, age });
  }
  for (const p of list) { p.authError = auth.get(p.provider) ?? null; if (p.authError) p.stale = true; }
  // A provider with an auth error that freshness does not list still counts (a feed we have no row for).
  const unlisted = [...auth.values()].filter((a) => !list.some((p) => p.provider === a.provider));
  const stale = list.filter((p) => p.stale).length + unlisted.length;
  const considered = list.filter((p) => p.expected);
  const stalest = [...considered]
    .sort((a, b) => (b.age ?? Infinity) - (a.age ?? Infinity) || a.provider.localeCompare(b.provider))[0];
  // AUTH ERRORS OUTRANK AGE: the first auth error (freshest) names itself provider:endpoint:status.
  const firstAuth = [...auth.values()].sort((a, b) => a.age - b.age || a.provider.localeCompare(b.provider))[0];
  const safe = (v) => String(v).replace(/[^A-Za-z0-9_\/-]/g, '');
  return {
    list,
    summary: {
      status: stale ? 'regression' : 'ok',
      providers: list.length,
      stale,
      stalest: firstAuth ? `${safe(firstAuth.provider)}:${safe(firstAuth.endpoint)}:${firstAuth.status}`
        : (stalest ? `${stalest.provider}:${stalest.age === null ? 'never' : stalest.age}` : '-'),
    },
    code: stale ? 1 : 0,
  };
}

export const SQL = `SELECT provider, max_age_min, expected,
  CASE WHEN last_ok_at IS NULL THEN NULL ELSE floor(extract(epoch FROM (now() - last_ok_at)) / 60)::int END AS age_min
  FROM crew_stats.provider_freshness_v ORDER BY provider`;

export const ERRORS_SQL = `SELECT source, provider, endpoint, status,
  floor(extract(epoch FROM (now() - at)) / 60)::int AS age_min
  FROM crew_stats.provider_errors_v ORDER BY at DESC`;

export async function main({ argv, env }) {
  parseArgs(argv, []);
  const url = requireReaderUrl(env);
  const rows = await query(url, SQL);
  // The view arrives with the next crew-reader-grants run; until then the age check stands alone.
  let errs = [], note = null;
  try { errs = await query(url, ERRORS_SQL); } catch { note = '  (provider_errors_v unavailable: age check only)'; }
  const { list, summary, code } = summarize(rows, errs);
  const lines = list.map((p) => `  ${p.provider.padEnd(10)} ${p.stale ? 'STALE' : 'ok   '} age_min=${p.age ?? 'never'} max=${p.maxAge} expected_now=${p.expected}${p.authError ? ` auth_error=${p.authError.endpoint}:${p.authError.status}` : ''}`);
  return { lines: ['provider freshness', ...lines, ...(note ? [note] : [])], summary, code };
}
