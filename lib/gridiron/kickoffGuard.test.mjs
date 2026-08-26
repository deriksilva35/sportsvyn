// lib/gridiron/kickoffGuard.test.mjs
//
// The guard refuses a specific SHAPE of revision, and the tests that matter are
// the ones proving it refuses no more than that. A guard that also eats real
// reschedules would be found out in October, quietly, by a game nobody could
// watch at the time we advertised.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inspectKickoffRevision, describeRefusal, refusalAlertBody,
  DRIFT_HOURS, GUARD_WINDOW_DAYS, DRIFT_TOLERANCE_HOURS,
} from './kickoffGuard.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const NOW = new Date('2026-08-25T16:30:00Z');
const KICK = '2026-08-29T16:00:00Z';                   // 4 days out
const inspect = (o) => inspectKickoffRevision({ status: 'scheduled', now: NOW, ...o });

// ------------------------------------------------ the signature it must catch

test('THE REAL CASE: all eight of Saturday\'s games, shifted exactly -4h', () => {
  // The actual values CFBD served on 25 Aug against what we held.
  const observed = [
    ['2026-08-29T16:00:00Z', '2026-08-29T12:00:00Z'],
    ['2026-08-29T19:00:00Z', '2026-08-29T15:00:00Z'],
    ['2026-08-29T19:30:00Z', '2026-08-29T15:30:00Z'],
    ['2026-08-29T21:30:00Z', '2026-08-29T17:30:00Z'],
    ['2026-08-29T22:30:00Z', '2026-08-29T18:30:00Z'],
    ['2026-08-29T23:00:00Z', '2026-08-29T19:00:00Z'],
    ['2026-08-30T02:00:00Z', '2026-08-29T22:00:00Z'],
  ];
  for (const [current, incoming] of observed) {
    const v = inspect({ current, incoming });
    assert.equal(v.refuse, true, `${current} -> ${incoming} must be refused`);
    assert.equal(v.reason, 'et_utc_drift');
    assert.equal(v.deltaHours, -4);
  }
});

test('both Eastern offsets are refused, in both directions', () => {
  for (const h of DRIFT_HOURS) {
    for (const sign of [1, -1]) {
      const incoming = new Date(new Date(KICK).getTime() + sign * h * 3_600_000).toISOString();
      assert.equal(inspect({ current: KICK, incoming }).refuse, true, `${sign * h}h must be refused`);
    }
  }
});

test('near-exact drift is still drift; a hair outside is not', () => {
  const at = (h) => new Date(new Date(KICK).getTime() + h * 3_600_000).toISOString();
  // Inside the tolerance band.
  assert.equal(inspect({ current: KICK, incoming: at(-(4 - DRIFT_TOLERANCE_HOURS / 2)) }).refuse, true);
  // Outside it - a 3.5h move is not the mislabel signature.
  assert.equal(inspect({ current: KICK, incoming: at(-3.5) }).refuse, false);
  assert.equal(inspect({ current: KICK, incoming: at(-4.5) }).refuse, false);
});

// --------------------------------------- the reschedules it must NOT swallow

test('a genuine reschedule still applies - the guard is narrow on purpose', () => {
  const at = (h) => new Date(new Date(KICK).getTime() + h * 3_600_000).toISOString();
  for (const h of [0.5, 1, 2, 3, 6, 12, 24, -1, -2, -24]) {
    const v = inspect({ current: KICK, incoming: at(h) });
    assert.equal(v.refuse, false, `a ${h}h move must still apply`);
    assert.equal(v.reason, 'not_drift_shaped');
  }
});

test('a 4h move far enough out is ordinary scheduling and applies', () => {
  // TV windows get assigned months ahead and move games by whole afternoons.
  // Refusing those would fight the provider's normal behaviour and teach
  // everyone to ignore the alert.
  const far = '2026-11-14T16:00:00Z';                  // ~81 days out
  const v = inspect({ current: far, incoming: '2026-11-14T20:00:00Z' });
  assert.equal(v.refuse, false);
  assert.equal(v.reason, 'outside_window');
});

test('the window boundary is measured from the kickoff we already hold', () => {
  const justInside = new Date(NOW.getTime() + (GUARD_WINDOW_DAYS - 0.5) * 86_400_000).toISOString();
  const justOutside = new Date(NOW.getTime() + (GUARD_WINDOW_DAYS + 0.5) * 86_400_000).toISOString();
  const minus4 = (iso) => new Date(new Date(iso).getTime() - 4 * 3_600_000).toISOString();
  assert.equal(inspect({ current: justInside, incoming: minus4(justInside) }).refuse, true);
  assert.equal(inspect({ current: justOutside, incoming: minus4(justOutside) }).refuse, false);
});

test('only SCHEDULED games are guarded', () => {
  const incoming = '2026-08-29T12:00:00Z';
  for (const status of ['live', 'final', 'postponed', 'cancelled']) {
    const v = inspectKickoffRevision({ current: KICK, incoming, status, now: NOW });
    assert.equal(v.refuse, false, `${status} must not be guarded`);
    assert.equal(v.reason, 'not_scheduled');
  }
});

test('a new row is never refused - there is nothing to keep', () => {
  assert.equal(inspect({ current: null, incoming: KICK }).refuse, false);
  assert.equal(inspect({ current: KICK, incoming: null }).refuse, false);
  assert.equal(inspect({ current: KICK, incoming: KICK }).reason, 'unchanged');
});

test('an unparseable value is passed through, not refused on a technicality', () => {
  assert.equal(inspect({ current: KICK, incoming: 'not-a-date' }).refuse, false);
});

// ------------------------------------------------------------- fail LOUD

test('the alert names every affected game with old, new and delta', () => {
  const refusals = [
    describeRefusal({ slug: 'cfb-2026-reg-w1-north-carolina-tcu', current: '2026-08-29T16:00:00Z',
      incoming: '2026-08-29T12:00:00Z', deltaHours: -4 }),
    describeRefusal({ slug: 'cfb-2026-reg-w1-memphis-unlv', current: '2026-08-30T02:00:00Z',
      incoming: '2026-08-29T22:00:00Z', deltaHours: -4 }),
  ];
  const body = refusalAlertBody({ source: 'cfb-games', refusals });
  // The game, both times and the delta - everything needed to release a real
  // reschedule by hand without going digging.
  assert.match(body, /cfb-2026-reg-w1-north-carolina-tcu/);
  assert.match(body, /cfb-2026-reg-w1-memphis-unlv/);
  assert.match(body, /kept\s+2026-08-29T16:00:00\.000Z/);
  assert.match(body, /refused 2026-08-29T12:00:00\.000Z/);
  assert.match(body, /-4h/);
  assert.match(body, /2 kickoff revision\(s\) refused/);
  assert.match(body, /release it by updating matches\.kickoff_at/);
});

test('the cron raises kickoff drift as its OWN alarm, on its own source', () => {
  const route = src('app/api/cron/gridiron-games/route.js');
  const code = route.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(code, /res\.summary\?\.kickoffRefused/);
  assert.match(code, /refusalAlertBody\(/);
  // A SEPARATE source, so an unrelated failure alert cannot rate-limit this one
  // out of existence - maybeAlert's window is per-source.
  assert.match(code, /source: `\$\{lg\.source\}-kickoff`/);
  assert.match(code, /REFUSED \$\{refused\.length\} kickoff revision\(s\)/);
});

test('the guard sits in the upsert path the */5 cron actually uses', () => {
  const sync = src('lib/gridiron/sync.js');
  const code = sync.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(code, /inspectKickoffRevision\(\{/);
  // The refused value must be the one we ALREADY HOLD, not the incoming one.
  assert.match(code, /const kickoffAt = verdict\.refuse \? existing\.kickoff_at : g\.kickoffAt;/);
  assert.match(code, /kickoff_at = \$\{kickoffAt\}/);
  // And both league paths must hand the summary in, or refusals never surface.
  // Anchored on upsertGame itself: a bare `}, summary);` also matches
  // mapStatus's call a few lines above, which would make this pass for the
  // wrong reason.
  for (const key of ['bdl_game_id', 'cfbd_game_id']) {
    const call = code.slice(code.indexOf(`upsertGame(leagueId, '${key}'`));
    const end = call.indexOf('});') === -1 ? call.indexOf('}, summary);') : Math.min(
      ...[call.indexOf('});'), call.indexOf('}, summary);')].filter((i) => i >= 0));
    assert.match(call.slice(0, end + 12), /\}, summary\);/,
      `the ${key} upsertGame call must pass the run summary`);
  }
});

test('a refusal is recorded, never silently dropped', () => {
  const sync = src('lib/gridiron/sync.js');
  assert.match(sync, /summary\.kickoffRefused \?\?= \[\]/);
  assert.match(sync, /summary\.kickoffRefused\.push\(describeRefusal\(/);
});

test('the alert row carries the per-game detail, not just a subject line', async () => {
  // TESTED THROUGH alertSummary(), NEVER maybeAlert(). The first version of
  // this test stubbed `sql` and called maybeAlert directly - which stubs the
  // database and NOT the mailer, so every suite run sent Derik a real email
  // with subject "s" and body "b". About twenty arrived before he told me.
  // The rule this leaves behind: never make a function that sends email the
  // unit under test for something that is not sending.
  const { alertSummary, ALERT_DETAIL_CAP } = await import('../pollers/alerts.js');
  const detail = [
    describeRefusal({ slug: 'a-vs-b', current: '2026-08-29T16:00:00Z', incoming: '2026-08-29T12:00:00Z', deltaHours: -4 }),
    describeRefusal({ slug: 'c-vs-d', current: '2026-08-30T02:00:00Z', incoming: '2026-08-29T22:00:00Z', deltaHours: -4 }),
  ];
  const summary = alertSummary({ subject: 'drift refused', detail });
  assert.equal(summary.subject, 'drift refused');
  assert.equal(summary.detail.length, 2);
  assert.equal(summary.detail[0].slug, 'a-vs-b');
  assert.equal(summary.detail[0].kept, '2026-08-29T16:00:00.000Z');
  assert.equal(summary.detail[0].refused, '2026-08-29T12:00:00.000Z');
  assert.equal(summary.detail[0].delta_hours, -4);
  assert.ok(ALERT_DETAIL_CAP > 0);
});

test('alert detail is capped, with the overflow counted not dropped silently', async () => {
  const { alertSummary, ALERT_DETAIL_CAP } = await import('../pollers/alerts.js');
  const many = Array.from({ length: ALERT_DETAIL_CAP + 7 }, (_, i) =>
    describeRefusal({ slug: `g${i}`, current: '2026-08-29T16:00:00Z', incoming: '2026-08-29T12:00:00Z', deltaHours: -4 }));
  const summary = alertSummary({ subject: 'many', detail: many });
  assert.equal(summary.detail.length, ALERT_DETAIL_CAP);
  assert.equal(summary.detailOverflow, 7, 'the dropped count must still land');
});

test('an alert with no detail is a bare subject - no empty detail key', async () => {
  const { alertSummary } = await import('../pollers/alerts.js');
  assert.deepEqual(alertSummary({ subject: 'plain' }), { subject: 'plain' });
  assert.deepEqual(alertSummary({ subject: 'plain', detail: [] }), { subject: 'plain' });
});

test('maybeAlert builds its row through alertSummary, so the tested shape ships', () => {
  const a = src('lib/pollers/alerts.js');
  // Spread, because the persisted row now also carries the dedupe fingerprint -
  // but the SHAPE still comes from the pure, separately tested function.
  assert.match(a, /const summary = \{ \.\.\.alertSummary\(\{ subject, detail \}\), fingerprint \};/);
});

test('NO TEST MAY CALL maybeAlert - stubbing sql does not stub the mailer', () => {
  // The guard against a repeat. A test that stubs `sql` and calls maybeAlert
  // sails past the database and straight into resend.emails.send().
  // pollersDb.test.mjs is the one sanctioned caller: it pre-seeds a marker row
  // so maybeAlert returns rate_limited BEFORE reaching the mailer, and its own
  // name says "(no send)".
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(path.join(REPO, dir), { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (e.name.endsWith('.test.mjs')) files.push(rel);
    }
  };
  for (const root of ['lib', 'components', 'app', 'scripts']) walk(root);

  const offenders = [];
  for (const f of files) {
    if (f.endsWith('lib/pollers/pollersDb.test.mjs')) continue;   // sanctioned, see above
    const code = readFileSync(path.join(REPO, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      // Drop assertion lines FIRST, per line. A file-wide exclusion was the
      // hole the negative control found: playsScope.test.mjs asserts on the
      // string "maybeAlert(" AND would then have been exempted from a real
      // invocation anywhere else in the file.
      .filter((l) => !/^\s*\/\//.test(l) && !/assert\./.test(l))
      .join('\n');
    if (/(?:^|[^.\w])maybeAlert\s*\(/m.test(code)) offenders.push(f);
  }
  assert.deepEqual(offenders, [], `these tests invoke maybeAlert and will send real email: ${offenders.join(', ')}`);
});

test('the kickoff alarm passes its refusals as alert detail', () => {
  const code = src('app/api/cron/gridiron-games/route.js')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const call = code.slice(code.indexOf('refusalAlertBody('));
  assert.match(call.slice(0, 200), /detail: refused,/);
});
