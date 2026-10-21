// crew/lib/providerHealth.mjs - provider-health: last successful write per feed vs its cadence.
// Reads crew_stats.provider_freshness_v (provider, last_ok_at, max_age_min, expected).
// A feed is STALE when a write is expected right now (a live game, in season, past the morning
// cron) and its last write is older than max_age_min. Cadences: docs/crew/watch-rules.md.
import { parseArgs, requireReaderUrl } from './common.mjs';
import { query, num } from './db.mjs';

/** PURE. rows: [{ provider, max_age_min, expected, age_min }] (age_min null = never wrote). */
export function summarize(rows) {
  const list = rows.map((r) => ({
    provider: r.provider,
    expected: r.expected === true || r.expected === 't' || r.expected === 'true',
    maxAge: num(r.max_age_min),
    age: r.age_min === null || r.age_min === undefined ? null : num(r.age_min),
  }));
  for (const p of list) p.stale = p.expected && (p.age === null || p.age > p.maxAge);
  const stale = list.filter((p) => p.stale).length;
  const considered = list.filter((p) => p.expected);
  const stalest = [...considered]
    .sort((a, b) => (b.age ?? Infinity) - (a.age ?? Infinity) || a.provider.localeCompare(b.provider))[0];
  return {
    list,
    summary: {
      status: stale ? 'regression' : 'ok',
      providers: list.length,
      stale,
      stalest: stalest ? `${stalest.provider}:${stalest.age === null ? 'never' : stalest.age}` : '-',
    },
    code: stale ? 1 : 0,
  };
}

export const SQL = `SELECT provider, max_age_min, expected,
  CASE WHEN last_ok_at IS NULL THEN NULL ELSE floor(extract(epoch FROM (now() - last_ok_at)) / 60)::int END AS age_min
  FROM crew_stats.provider_freshness_v ORDER BY provider`;

export async function main({ argv, env }) {
  parseArgs(argv, []);
  const rows = await query(requireReaderUrl(env), SQL);
  const { list, summary, code } = summarize(rows);
  const lines = list.map((p) => `  ${p.provider.padEnd(10)} ${p.stale ? 'STALE' : 'ok   '} age_min=${p.age ?? 'never'} max=${p.maxAge} expected_now=${p.expected}`);
  return { lines: ['provider freshness', ...lines], summary, code };
}
