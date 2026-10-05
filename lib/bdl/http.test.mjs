// lib/bdl/http.test.mjs - RULING sun-6 item 1, the mechanism on its own.
//
// "Any BDL 4xx/5xx inside a run marks the run FAILED (ok=false) and alerts -
// per-game errors may never hide inside an ok=true." No database here: `sql`
// is a recorder of the statements recordRun and reportBdlErrors issue, and the
// alert is a stub that records what it was handed - the mailer is never
// reachable from this file (kickoffGuard.test.mjs forbids it).
//
// The per-overlay proofs, with real writes on DEV, are lib/bdl/overlays.test.mjs
// and services/live-poller/bdlErrors.test.mjs. The census that keeps bdlFetch
// the only door is lib/bdl/census.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bdlFetch, bdlError, withBdlErrors, isBdlHttpError, BdlHttpError,
  bdlEndpoint, bdlErrorSummary, bdlFailureMessage,
} from './http.js';
import { recordRun } from '../pollers/runRecorder.js';
import { reportBdlErrors, runAndAlert } from '../pollers/bdlFailure.js';
import { alertFingerprint } from '../pollers/alerts.js';

/** A planted feed: 401 for the ids in `deny`, a page of data for the rest. */
const planted = (deny = [], status = 401) => async (url) => {
  const u = String(url);
  if (deny.some((d) => u.includes(`=${d}`) || u.includes(`/${d}`))) return new Response('{"error":"Unauthorized"}', { status });
  return Response.json({ data: [{ id: 1 }], meta: {} });
};

/** A recorder standing in for the tagged-template client. */
function fakeSql() {
  const calls = [];
  let nextId = 900;
  const sql = async (strings, ...values) => {
    const text = strings.join('?');
    calls.push({ text, values });
    if (/RETURNING id/.test(text)) return [{ id: nextId++ }];
    return [];
  };
  sql.calls = calls;
  return sql;
}

const stubAlert = () => {
  const sent = [];
  const fn = async (_sql, a) => { sent.push(a); return { sent: false, stub: true }; };
  fn.sent = sent;
  return fn;
};

test('a planted 401 is thrown as a BdlHttpError and RECORDED - even when the caller swallows it', async () => {
  const { value, bdlErrors } = await withBdlErrors(async () => {
    const out = [];
    for (const g of ['111', '222']) {
      try {
        const res = await bdlFetch(`/ncaaf/v1/player_stats?game_ids[]=${g}`, {
          key: 'k', fetchImpl: planted(['111']), describe: (s) => `BDL ${s} on /ncaaf/v1/player_stats`,
        });
        out.push({ g, rows: (await res.json()).data.length });
      } catch (e) {
        assert.ok(isBdlHttpError(e)); assert.ok(e instanceof BdlHttpError);
        assert.equal(e.status, 401);
        assert.equal(e.message, 'BDL 401 on /ncaaf/v1/player_stats', 'the caller keeps its own wording');
        out.push({ g, error: e.message });   // the 3 Oct shape: caught into perGame
      }
    }
    return out;
  });
  assert.deepEqual(value, [{ g: '111', error: 'BDL 401 on /ncaaf/v1/player_stats' }, { g: '222', rows: 1 }],
    'the sibling still read');
  assert.equal(bdlErrors.length, 1);
  assert.deepEqual(bdlErrors[0], { status: 401, endpoint: '/ncaaf/v1/player_stats', message: 'BDL 401 on /ncaaf/v1/player_stats' });
});

test('every 4xx and 5xx counts; an ALLOWED status (404 = gone, 429 = retry) is an answer, not an error', async () => {
  for (const status of [400, 401, 403, 404, 429, 500, 502, 503]) {
    const { bdlErrors } = await withBdlErrors(async () => {
      await bdlFetch('/nba/v1/games/7', { key: 'k', fetchImpl: planted(['7'], status) }).catch(() => null);
    });
    assert.equal(bdlErrors.length, 1, `status ${status} is recorded`);
    assert.equal(bdlErrors[0].endpoint, '/nba/v1/games/:id');
  }
  const { bdlErrors } = await withBdlErrors(async () => {
    const r = await bdlFetch('/nba/v1/games/7', { key: 'k', fetchImpl: planted(['7'], 404), allow: [404] });
    assert.equal(r.status, 404);
  });
  assert.deepEqual(bdlErrors, [], 'a 404 the caller asked for is not a failure');
  // RETRIES SPENT ON 429 ARE A 429: bdlError records like bdlFetch does.
  const spent = await withBdlErrors(async () => { try { throw bdlError(429, '/nfl/v1/stats?x=1', 'BDL rate-limited (429) after retries'); } catch { /* contained */ } });
  assert.deepEqual(spent.bdlErrors.map((e) => `${e.status} ${e.endpoint}`), ['429 /nfl/v1/stats']);
});

test('outside any run a failure is a plain throw and nothing is recorded anywhere', async () => {
  await assert.rejects(bdlFetch('/mlb/v1/games', { key: 'k', fetchImpl: planted(['games'], 401) }), BdlHttpError);
  const { bdlErrors } = await withBdlErrors(async () => {});
  assert.deepEqual(bdlErrors, [], 'an earlier, unscoped failure does not leak into the next run');
});

test('scopes NEST: an overlay run inside a larger run keeps its own errors', async () => {
  const outer = await withBdlErrors(async () => {
    const inner = await withBdlErrors(async () => {
      await bdlFetch('/ncaaf/v1/games?dates[]=x', { key: 'k', fetchImpl: planted(['x']) }).catch(() => null);
    });
    assert.equal(inner.bdlErrors.length, 1);
  });
  assert.deepEqual(outer.bdlErrors, [], 'cfb-live-lines failing must not fail cfb-games around it');
});

test('concurrent requests in one run are all recorded (Promise.all keeps the scope)', async () => {
  const { bdlErrors } = await withBdlErrors(() => Promise.all(['1', '2', '3'].map((g) =>
    bdlFetch(`/mlb/v1/plate_appearances?game_id=${g}`, { key: 'k', fetchImpl: planted(['1', '3']) }).catch(() => null))));
  assert.equal(bdlErrors.length, 2);
  assert.deepEqual(bdlErrorSummary(bdlErrors), [{ status: 401, endpoint: '/mlb/v1/plate_appearances', count: 2, sample: 'BDL 401 on /mlb/v1/plate_appearances' }]);
});

test('the endpoint drops the query and the ids, so two games are one failure', () => {
  assert.equal(bdlEndpoint('/ncaaf/v1/player_stats?game_ids[]=457189&per_page=100'), '/ncaaf/v1/player_stats');
  assert.equal(bdlEndpoint('/mlb/v1/games/12345'), '/mlb/v1/games/:id');
  assert.equal(bdlEndpoint('/nfl/v1/games?dates[]=2026-10-03'), '/nfl/v1/games');
});

test('the failure line is DETERMINISTIC - same outage, same text, same alert fingerprint (mailed once, then counted)', () => {
  const a = [{ status: 401, endpoint: '/ncaaf/v1/player_stats', message: 'x' }, { status: 401, endpoint: '/ncaaf/v1/games', message: 'y' }];
  const b = [{ status: 401, endpoint: '/ncaaf/v1/games', message: 'y' }, ...Array(7).fill({ status: 401, endpoint: '/ncaaf/v1/player_stats', message: 'x' })];
  assert.equal(bdlFailureMessage(a), bdlFailureMessage(b), 'order and count do not change the text');
  assert.match(bdlFailureMessage(a), /401 \/ncaaf\/v1\/games, 401 \/ncaaf\/v1\/player_stats$/);
  const body = (errs) => `source: cfb-live-lines\nleagueId: 3\n\n${bdlFailureMessage(errs)}`;
  assert.equal(alertFingerprint({ subject: '[pollers] cfb-live-lines FAILED', body: body(a) }),
    alertFingerprint({ subject: '[pollers] cfb-live-lines FAILED', body: body(b) }),
    'tick after tick the alert fingerprints the same, so maybeAlert counts instead of mailing');
  assert.equal(bdlFailureMessage([]), null);
});

test('recordRun: a run that CAUGHT a planted 401 per game is recorded ok=false, its summary kept', async () => {
  const sql = fakeSql();
  const res = await recordRun(sql, {
    source: 'cfb-live-lines', kind: 'live-poll', log: () => {},
    run: async () => {
      const summary = { perGame: [], written: 0 };
      for (const g of ['111', '222']) {
        try {
          await bdlFetch(`/ncaaf/v1/player_stats?game_ids[]=${g}`, { key: 'k', fetchImpl: planted(['111']) });
          summary.written += 1; summary.perGame.push({ g });
        } catch (e) { summary.perGame.push({ g, error: e.message }); }
      }
      return summary;
    },
  });
  assert.equal(res.ok, false, 'per-game errors may never hide inside an ok=true');
  assert.match(res.error, /401 \/ncaaf\/v1\/player_stats/);
  assert.equal(res.summary.written, 1, 'the healthy sibling was still written');
  assert.deepEqual(res.summary.bdlErrors, [{ status: 401, endpoint: '/ncaaf/v1/player_stats', count: 1, sample: 'BDL 401 on /ncaaf/v1/player_stats' }]);
  const upd = sql.calls.find((c) => /^\s*UPDATE sync_runs/.test(c.text));
  assert.match(upd.text, /ok = false, error = \?, summary = \?::jsonb/);
  assert.equal(upd.values[0], res.error);
});

test('recordRun: a clean run is still ok=true and carries no bdlErrors key', async () => {
  const sql = fakeSql();
  const res = await recordRun(sql, { source: 's', kind: 'k', log: () => {}, run: async () => {
    await bdlFetch('/nfl/v1/games?dates[]=x', { key: 'k', fetchImpl: planted([]) });
    return { n: 1 };
  } });
  assert.equal(res.ok, true);
  assert.deepEqual(res.summary, { n: 1 });
  assert.match(sql.calls.at(-1).text, /ok = true/);
});

test('runAndAlert: the failed run reaches the alert under the overlay\'s own source, errors named in the body', async () => {
  const sql = fakeSql(); const alert = stubAlert();
  const res = await runAndAlert(sql, {
    source: 'cfb-live-lines', kind: 'live-poll', context: 'leagueId: 3', alert, log: () => {},
    run: async () => {
      await bdlFetch('/ncaaf/v1/games?dates[]=x', { key: 'k', fetchImpl: planted(['x']) }).catch(() => null);
      return {};
    },
  });
  assert.equal(res.ok, false);
  assert.equal(alert.sent.length, 1, 'an alert was attempted');
  assert.equal(alert.sent[0].source, 'cfb-live-lines');
  assert.equal(alert.sent[0].subject, '[pollers] cfb-live-lines FAILED');
  assert.match(alert.sent[0].body, /leagueId: 3\n\nBDL HTTP error\(s\) inside the run .*401 \/ncaaf\/v1\/games/);
  const ok = await runAndAlert(fakeSql(), { source: 's', kind: 'k', alert, log: () => {}, run: async () => ({}) });
  assert.equal(ok.ok, true); assert.equal(alert.sent.length, 1, 'a clean run alerts nobody');
});

test('runAndAlert and reportBdlErrors never throw - not on a failing mailer, not on a failing ledger', async () => {
  const boom = async () => { throw new Error('mailer down'); };
  const res = await runAndAlert(fakeSql(), { source: 's', kind: 'k', alert: boom, log: () => {}, run: async () => { throw new Error('x'); } });
  assert.equal(res.ok, false); assert.equal(res.alerted.reason, 'alert_failed');
  const badSql = async () => { throw new Error('db down'); };
  const rep = await reportBdlErrors(badSql, { source: 'live-poller-mlb', bdlErrors: [{ status: 401, endpoint: '/x', message: 'm' }], alert: boom });
  assert.equal(rep.alerted.reason, 'alert_failed'); assert.match(rep.summary.ledgerError, /db down/);
});

test('reportBdlErrors: the poller\'s tick is written FAILED and alerted under its own source; nothing when clean', async () => {
  const sql = fakeSql(); const alert = stubAlert();
  const errs = [{ status: 401, endpoint: '/mlb/v1/plate_appearances', message: 'm' }];
  const rep = await reportBdlErrors(sql, { source: 'live-poller-mlb', bdlErrors: errs, context: 'league: mlb', alert });
  const ins = sql.calls.find((c) => /INSERT INTO sync_runs/.test(c.text));
  assert.deepEqual(ins.values.slice(0, 2), ['live-poller-mlb', 'bdl-errors']);
  assert.match(ins.text, /\?, \?, false, \?/, 'ok=false on the ledger row');
  assert.equal(ins.values[4], rep.error);
  assert.match(sql.calls[0].text, /SELECT id, summary FROM sync_runs/, 'the hour\'s row is looked for first');
  assert.equal(alert.sent.length, 1); assert.equal(alert.sent[0].source, 'live-poller-mlb');
  assert.match(alert.sent[0].body, /401 \/mlb\/v1\/plate_appearances/);
  assert.equal(await reportBdlErrors(sql, { source: 'x', bdlErrors: [], alert }), null);
  assert.equal(alert.sent.length, 1);
});
