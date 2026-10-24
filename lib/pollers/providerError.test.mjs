import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseProviderError } from './providerError.js';

const AT = new Date('2026-10-24T12:00:00Z');

test('parses provider, endpoint and status; lowercase provider, no leading slash, no query', () => {
  assert.deepEqual(parseProviderError('CFBD 401 on /scoreboard: requires a Patreon subscription at Tier 1', AT),
    { provider: 'cfbd', endpoint: 'scoreboard', status: 401, at: '2026-10-24T12:00:00.000Z' });
  assert.deepEqual(parseProviderError('BDL 429 on /nfl/v1/games', AT),
    { provider: 'bdl', endpoint: 'nfl/v1/games', status: 429, at: '2026-10-24T12:00:00.000Z' });
  const q = parseProviderError('BDL 500 on /ncaaf/v1/games?api_key=SECRET&dates[]=2026-10-24', AT);
  assert.equal(q.endpoint, 'ncaaf/v1/games');
  assert.ok(!JSON.stringify(q).includes('SECRET'));
});

test('a message that is not a provider HTTP error parses to null', () => {
  assert.equal(parseProviderError('fetch failed', AT), null);
  assert.equal(parseProviderError(undefined, AT), null);
});

test('the poller records provider_error on the heartbeat and the window, and a failed poll closes the window not ok', () => {
  const src = readFileSync(new URL('../../services/live-poller/index.mjs', import.meta.url), 'utf8');
  assert.match(src, /parseProviderError\(e\?\.message\)/);
  assert.match(src, /heartbeat\(lg\.slug, decision\.state, \{ \.\.\.\(providerError \? \{ provider_error: providerError \} : \{\}\)/);
  assert.match(src, /window\.bdlErrors === 0 && window\.pollFailures === 0/);
  assert.match(src, /UPDATE sync_runs SET ok = false/);
  assert.match(src, /onPrimaryError: \(e\) =>/);
});

test('cfbScoreboardWithFallback calls onPrimaryError when CFBD fails and BDL answers', async () => {
  const { cfbScoreboardWithFallback } = await import('../../services/live-poller/poll.mjs');
  const seen = [];
  const f = cfbScoreboardWithFallback({
    primary: async () => { throw new Error('CFBD 401 on /scoreboard: x'); },
    day: () => async () => ({ rows: [], calls: 1 }),
    bridge: async () => new Map(),
    onPrimaryError: (e) => seen.push(parseProviderError(e.message, AT)),
  });
  const r = await f(AT);
  assert.equal(r.source, 'bdl');
  assert.deepEqual(seen.map((s) => [s.provider, s.endpoint, s.status]), [['cfbd', 'scoreboard', 401]]);
});
