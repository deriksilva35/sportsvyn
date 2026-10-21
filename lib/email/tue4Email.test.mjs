// lib/email/tue4Email.test.mjs - tue-4/5: send pacing + 429 retry, opens/clicks without
// scanners, owner/house/test accounts in the audience, the 6 AM PT preview, DST.
//
// Fixture (DEV): sentinel users pv-<pid>-<ts>-*@preview-fixture.dev (a real-looking,
// non-placeholder domain, because the point is that these ARE deliverable) plus one
// example.invalid user; no mail leaves (send is injected). after() deletes it all and asserts it did.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const pace = await import('./resendPace.js');
const metrics = await import('./emailMetrics.js');
const ta = await import('./testAccounts.js');
const sched = await import('./schedule.js');
const aud = await import('./morningAudience.js');
const prev = await import('./morningPreview.js');
const { OWNER_ADDRESSES } = await import('./owners.js');
const { sql } = await import('../db.js');

// ---------------------------------------------------------------- A. rate limit

const limited = () => ({ data: null, error: { name: 'rate_limit_exceeded', statusCode: 429, message: 'Too many requests. You can only make 2 requests per second.' } });
const fakeClock = () => {
  const c = { t: 1_000_000, sleeps: [] };
  c.now = () => c.t;
  c.sleep = async (ms) => { c.sleeps.push(ms); c.t += ms; };
  return c;
};

test('A. a 429 that clears after two retries is SENT', async () => {
  const clock = fakeClock();
  let calls = 0;
  const send = pace.paced(async () => (++calls <= 2 ? limited() : { data: { id: 'ok-1' }, error: null }), clock);
  const res = await send({ to: 'a@b.co' });
  assert.equal(res.data.id, 'ok-1');
  assert.equal(calls, 3);
  assert.ok(clock.sleeps.includes(500) && clock.sleeps.includes(1000), `backoff 500 then 1000 (${clock.sleeps})`);
});

test('A. four 429s in a row is FAILED (three retries, then the error comes back)', async () => {
  const clock = fakeClock();
  let calls = 0;
  const send = pace.paced(async () => { calls += 1; return limited(); }, clock);
  const res = await send({});
  assert.equal(calls, 4, 'one try + 3 retries');
  assert.equal(res.error.name, 'rate_limit_exceeded', 'the caller sees an error and counts the send failed');
});

test('A. a THROWN 429 is retried too; a non-429 error is never retried', async () => {
  const clock = fakeClock();
  let calls = 0;
  const thrown = pace.paced(async () => { calls += 1; if (calls < 3) throw Object.assign(new Error('Too many requests'), { statusCode: 429 }); return { data: { id: 'x' } }; }, clock);
  assert.equal((await thrown({})).data.id, 'x');
  let n = 0;
  const bad = pace.paced(async () => { n += 1; return { error: { name: 'validation_error', statusCode: 422, message: 'bad' } }; }, clock);
  assert.equal((await bad({})).error.name, 'validation_error');
  assert.equal(n, 1, 'a 422 is returned at once');
  assert.equal(pace.isRateLimited({ error: { message: 'Too many requests' } }), true);
  assert.equal(pace.isRateLimited({ data: { id: 1 } }), false);
});

test('A. PACING: send starts are >= 125 ms apart, never more than 8 in any second (fake clock)', async () => {
  const clock = fakeClock();
  const starts = [];
  const send = pace.paced(async () => { starts.push(clock.now()); return { data: { id: 'p' } }; }, clock);
  for (let i = 0; i < 40; i += 1) await send({});
  for (let i = 1; i < starts.length; i += 1) assert.ok(starts[i] - starts[i - 1] >= 125, `gap ${i}: ${starts[i] - starts[i - 1]}`);
  for (const s of starts) assert.ok(starts.filter((t) => t >= s && t < s + 1000).length <= 8, 'at most 8 starts in a second');
  assert.equal(pace.GAP_MS, 125);
});

test('A. CONCURRENT callers queue: five at once get slots 0, 125, 250, 375, 500 ms out', async () => {
  const clock = fakeClock();
  const waits = [];
  const send = pace.paced(async () => ({ data: { id: 'c' } }), { now: clock.now, sleep: async (ms) => { waits.push(ms); } });
  await Promise.all([1, 2, 3, 4, 5].map(() => send({})));
  assert.deepEqual(waits, [125, 250, 375, 500]);
});

test('A. ONE PLACE: lib/resend.js wraps the client; nothing else builds a Resend client', () => {
  assert.match(src('lib/resend.js'), /resend\.emails\.send = paced\(rawSend\)/);
  const walk = (dir, out = []) => {
    for (const f of readdirSync(path.join(REPO, dir))) {
      if (['node_modules', '.next', 'test-tmp', '.git', 'worktrees'].includes(f)) continue;
      const rel = path.join(dir, f);
      if (statSync(path.join(REPO, rel)).isDirectory()) walk(rel, out);
      else if (/\.(m?js)$/.test(f) && !/\.test\.mjs$/.test(f)) out.push(rel);
    }
    return out;
  };
  const builders = [...walk('app'), ...walk('lib'), ...walk('scripts'), 'auth.js'].filter((f) => /new Resend\(/.test(src(f)));
  assert.deepEqual(builders, ['lib/resend.js'], 'every sender goes through the paced client');
});

// ---------------------------------------------------------------- B. measure

const T0 = Date.parse('2026-10-21T15:00:00Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();

test('B. SCANNER RULE: 3+ clicks in 15 s starting within 2 min of delivery are scanner clicks', () => {
  const f = (arr) => [...metrics.flagScannerClicks(arr)];
  const c = (key, s, anchor = T0) => ({ key, t: T0 + s * 1000, anchor });
  assert.deepEqual(f([c('m', 5), c('m', 7), c('m', 9)]), [0, 1, 2], 'three in 4 s right after delivery');
  assert.deepEqual(f([c('m', 5), c('m', 12), c('m', 19)]), [0, 1, 2], 'three within 15 s of the first');
  assert.deepEqual(f([c('m', 5), c('m', 12), c('m', 25)]), [], '20 s from first to third: a person');
  assert.deepEqual(f([c('m', 5), c('m', 6)]), [], 'two clicks are never a scanner');
  assert.deepEqual(f([c('m', 300), c('m', 301), c('m', 302)]), [], 'a burst that starts 5 minutes after delivery is kept');
  assert.deepEqual(f([c('m', 120), c('m', 121), c('m', 122)]), [0, 1, 2], 'exactly 2 minutes still counts');
  assert.deepEqual(f([c('m', 5, null), c('m', 6, null), c('m', 7, null)]), [], 'no delivery time known: not flagged');
  assert.deepEqual(f([c('a', 5), c('b', 6), c('c', 7)]), [], 'three messages, one click each');
  assert.deepEqual(f([c('a', 5), c('a', 6), c('b', 6), c('a', 7), c('b', 200)]), [0, 1, 3], 'per message');
});

test('B. THE DAILY TABLE: scanner clicks are in none of the counts; ledger rows follow the same rule', () => {
  const sends = [
    { day: '2026-10-21', userId: 1, messageId: 'm1', sentAt: at(0) },
    { day: '2026-10-21', userId: 2, messageId: 'm2', sentAt: at(0) },
    { day: '2026-10-21', userId: 3, messageId: 'm3', sentAt: at(0) },
    { day: '2026-10-20', userId: 1, messageId: 'm0', sentAt: '2026-10-20T15:00:00Z' },
  ];
  const events = [
    { kind: 'delivered', messageId: 'm1', at: at(2) }, { kind: 'delivered', messageId: 'm2', at: at(3) }, { kind: 'delivered', messageId: 'm3', at: at(3) },
    { kind: 'opened', messageId: 'm1', at: at(60) }, { kind: 'opened', messageId: 'm1', at: at(90) }, { kind: 'opened', messageId: 'm2', at: at(10) },
    // m1: a scanner burst (3 clicks in 4 s, 10 s after delivery) and nothing else
    { kind: 'clicked', messageId: 'm1', at: at(12) }, { kind: 'clicked', messageId: 'm1', at: at(14) }, { kind: 'clicked', messageId: 'm1', at: at(16) },
    // m2: one real click an hour later
    { kind: 'clicked', messageId: 'm2', at: at(3600) },
    { kind: 'clicked', messageId: 'zzz', at: at(5) },
  ];
  const ledgerClicks = [
    { userId: 1, campaign: 'morning-2026-10-21', at: at(12) }, { userId: 1, campaign: 'morning-2026-10-21', at: at(13) }, { userId: 1, campaign: 'morning-2026-10-21', at: at(14) },
    { userId: 3, campaign: 'morning-2026-10-21', at: at(1800) },
  ];
  const rows = metrics.buildDaily({ sends, events, ledgerClicks, played: { '2026-10-21': 2 } });
  assert.deepEqual(rows.map((r) => r.day), ['2026-10-21', '2026-10-20'], 'newest first');
  const d = rows[0];
  assert.equal(d.sent, 3);
  assert.equal(d.delivered, 3);
  assert.equal(d.opened, 2, 'distinct messages');
  assert.equal(d.clicks, 1, 'only m2 clicked for real');
  assert.equal(d.clickers, 1);
  assert.equal(d.scannerClicks, 3);
  assert.equal(d.ourClicks, 1);
  assert.equal(d.ourScannerClicks, 3);
  assert.equal(d.played, 2);
  assert.equal(rows[1].sent, 1);
});

test('B. the webhook stores opened + clicked (with the link and the event time)', () => {
  const route = src('app/api/webhooks/resend/route.js');
  assert.match(route, /'email\.opened': 'opened'/);
  assert.match(route, /'email\.clicked': 'clicked'/);
  assert.match(route, /link: evt\?\.data\?\.click\?\.link/);
  assert.match(src('app/admin/morning-email/page.js'), /morningDaily/);
});

// ---------------------------------------------------------------- C. test accounts

test('C. PURE: which test-account addresses are real mailboxes', () => {
  const ok = (e) => ta.addressVerdict(e);
  for (const e of ['derik@sportsvyn.com', 'deriksilva@gmail.com', 'deriksilva+welcome@gmail.com', 'derik@safetymanagers.com', 'derik@theskry.com']) assert.equal(ok(e).ok, true, e);
  const bad = {
    'not-an-address': 'malformed', 'a@b': 'malformed',
    'x@example.com': 'placeholder', 'x@example.org': 'placeholder', 'x@example.net': 'placeholder', 'x@mail.example.com': 'placeholder',
    'x@foo.test': 'placeholder', 'x@test.sportsvyn.com': 'placeholder', 'x@a.invalid': 'placeholder', 'x@host.local': 'placeholder',
    'x@localhost': 'placeholder', 'mtest-1-2-a@sportsvyn.com': 'placeholder', 'bouncetest-1@gmail.com': 'placeholder', 'sentinel.user@gmail.com': 'placeholder',
  };
  for (const [e, why] of Object.entries(bad)) {
    assert.equal(ok(e).reason, why, String(e));
  }
  assert.equal(ok('').reason, 'no-address');
  assert.equal(ok(null).reason, 'no-address');
  assert.equal(ta.testAccountVerdict({ email: 'derik@sportsvyn.com' }).ok, true);
  assert.equal(ta.testAccountVerdict({ email: 'derik@sportsvyn.com', bounced: true }).reason, 'hard-bounced');
  assert.equal(ta.testAccountVerdict({ email: 'derik@sportsvyn.com', optedOut: true }).reason, 'opted-out');
  assert.equal(ta.testAccountVerdict({ email: 'derik@sportsvyn.com', pref: false }).reason, 'opted-out');
  assert.equal(ta.testAccountVerdict({ email: 'x@example.com', bounced: true }).reason, 'placeholder', 'the address is judged first');
  assert.equal(ta.testAccountVerdict({ email: null }).reason, 'no-address');
});

const NS = `pv-${process.pid}-${Date.now()}`;
const GOOD = (t) => `${NS}-${t}@preview-fixture.dev`;
const ids = {};
async function mk(tag, { email, house = false, optedOut = false, pref = null } = {}) {
  const [u] = await sql`INSERT INTO users (email, created_at, morning_email, email_opted_out_at, is_house)
                        VALUES (${email}, now() - interval '200 days', ${pref}, ${optedOut ? new Date().toISOString() : null}, ${house}) RETURNING id`;
  ids[tag] = u.id;
  return u.id;
}
after(async () => {
  const all = Object.values(ids);
  await sql`DELETE FROM sync_runs WHERE source IN ('morning-preview', 'morning-email') AND (summary->>'userId')::int = ANY(${all})`;
  await sql`DELETE FROM sync_runs WHERE source = 'resend-webhook' AND summary->>'to' LIKE ${`${NS}-%`}`;
  await sql`DELETE FROM users WHERE id = ANY(${all})`;
  const [{ n }] = await sql`SELECT (SELECT count(*) FROM users WHERE id = ANY(${all}))
    + (SELECT count(*) FROM sync_runs WHERE source IN ('morning-preview', 'morning-email') AND (summary->>'userId')::int = ANY(${all})) AS n`;
  assert.equal(Number(n), 0, 'teardown left nothing behind');
});

test('C. ON DEV: house / owner accounts are mailed when deliverable; fake, bounced, unsubscribed are not', async () => {
  await mk('house', { email: GOOD('house'), house: true });
  await mk('owner', { email: GOOD('owner') });                         // owner by injected list
  await mk('fake', { email: `${NS}-fake@example.invalid`, house: true });
  await mk('bounced', { email: GOOD('bounced'), house: true });
  await mk('unsub', { email: GOOD('unsub'), house: true, optedOut: true });
  await mk('off', { email: GOOD('off'), house: true, pref: false });
  await mk('noaddr', { email: null, house: true });
  await mk('plain', { email: GOOD('plain') });                          // dormant, not an owner: nothing
  await sql`INSERT INTO sync_runs (source, kind, started_at, finished_at, ok, summary)
            VALUES ('resend-webhook', 'bounced', now(), now(), false, ${JSON.stringify({ to: GOOD('bounced'), outcome: 'bounced' })}::jsonb)`;
  const owners = [GOOD('owner')];
  const mine = Object.values(ids);
  const audience = (await aud.morningAudience(sql, { owners })).filter((r) => mine.includes(Number(r.id)));
  assert.deepEqual(audience.map((r) => [r.id, r.why]).sort(), [[ids.house, 'test'], [ids.owner, 'test']].sort(), 'only the two deliverable test accounts');
  const roster = (await aud.testAccountRoster(sql, { owners })).filter((r) => mine.includes(Number(r.id)));
  const why = Object.fromEntries(roster.map((r) => [Object.keys(ids).find((k) => ids[k] === Number(r.id)), r.included ? 'included' : r.reason]));
  assert.deepEqual(why, { house: 'included', owner: 'included', fake: 'placeholder', bounced: 'hard-bounced', unsub: 'opted-out', off: 'opted-out', noaddr: 'no-address' });
});

test('C. the real owner list: nothing in OWNER_ADDRESSES is a placeholder', () => {
  for (const a of OWNER_ADDRESSES) assert.equal(ta.addressVerdict(a).ok, true, a);
});

// ---------------------------------------------------------------- D. preview

const deps = (sent) => ({
  send: async (m) => { sent.push(m); return { data: { id: `fake-${sent.length}` } }; },
  unsubscribeUrlFor: async (id) => `https://sportsvyn.com/api/email/unsubscribe?u=${id}`,
});

test('D. THE PREVIEW: owner only, [PREVIEW 8AM] subject, once a day, never the real ledger, runs with the switch OFF', async () => {
  const to = GOOD('prev');
  const uid = await mk('prev', { email: to });
  delete process.env.MORNING_EMAIL;
  const now = new Date('2026-01-14T14:00:00Z');
  const sent = [];
  const first = await prev.runPreview({ now, to, owners: [to], ...deps(sent) });
  assert.equal(first.decision, 'sent');
  assert.equal(first.userId, uid);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, to, 'only the owner address');
  assert.ok(sent[0].subject.startsWith('[PREVIEW 8AM] '), sent[0].subject);
  assert.match(sent[0].html, /Unsubscribe/);
  assert.match(sent[0].html, /Play today's Daily/);
  const second = await prev.runPreview({ now, to, owners: [to], ...deps(sent) });
  assert.equal(second.decision, 'already');
  assert.equal(sent.length, 1, 'once per day');
  const rows = await sql`SELECT summary FROM sync_runs WHERE source = 'morning-preview' AND kind = 'send' AND summary->>'to' = ${to}`;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].summary.outcome, 'sent');
  const [{ n }] = await sql`SELECT count(*)::int n FROM sync_runs WHERE source = 'morning-email' AND (summary->>'userId')::int = ${uid}`;
  assert.equal(n, 0, 'the real send ledger is untouched');
  // a different day sends again
  const next = await prev.runPreview({ now: new Date('2026-01-15T14:00:00Z'), to, owners: [to], ...deps(sent) });
  assert.equal(next.decision, 'sent');
  assert.equal(sent.length, 2);
  await sql`DELETE FROM sync_runs WHERE source = 'morning-preview' AND summary->>'to' = ${to}`;
});

test('D. THE PREVIEW REFUSES any address that is not an owner address, or is a placeholder', async () => {
  const sent = [];
  const stranger = GOOD('stranger');
  assert.equal((await prev.runPreview({ to: stranger, ...deps(sent) })).decision, 'refused-address', 'not in OWNER_ADDRESSES');
  assert.equal((await prev.runPreview({ to: 'x@example.com', owners: ['x@example.com'], ...deps(sent) })).decision, 'refused-address', 'placeholder');
  assert.equal(sent.length, 0);
  assert.equal(prev.previewTo({}), 'derik@sportsvyn.com');
  assert.equal(prev.previewTo({ MORNING_PREVIEW_TO: ' Other@Sportsvyn.com ' }), 'other@sportsvyn.com');
  assert.ok(OWNER_ADDRESSES.includes(prev.DEFAULT_PREVIEW_TO));
  assert.doesNotMatch(src('lib/email/morningPreview.js'), /userId\s*=\s*\d/, 'no typed user id');
});

// ---------------------------------------------------------------- E. DST

const at8 = (iso) => sched.isPacificHour(iso, sched.SEND_HOUR_PT);
const at6 = (iso) => sched.isPacificHour(iso, sched.PREVIEW_HOUR_PT);

test('E. 8 AM PT is 15:00Z until DST ends (Sun 1 Nov 2026), 16:00Z after', () => {
  assert.equal(at8('2026-10-31T15:00:00Z'), true, 'Sat 31 Oct: PDT');
  assert.equal(at8('2026-10-31T16:00:00Z'), false);
  assert.equal(at8('2026-11-01T15:00:00Z'), false, 'Sun 1 Nov 15:00Z is 7 AM PST');
  assert.equal(at8('2026-11-01T16:00:00Z'), true, 'Sun 1 Nov: PST');
  assert.equal(at8('2026-11-02T15:00:00Z'), false);
  assert.equal(at8('2026-11-02T16:00:00Z'), true, 'Mon 2 Nov: PST');
  assert.equal(at8('2026-10-21T15:00:00Z'), true, 'today: unchanged');
  assert.equal(at6('2026-10-21T13:00:00Z'), true, 'Wed 21 Oct 13:00Z = 6 AM PDT: the first preview');
  assert.equal(at6('2026-10-31T13:00:00Z'), true);
  assert.equal(at6('2026-11-01T13:00:00Z'), false);
  assert.equal(at6('2026-11-01T14:00:00Z'), true);
  assert.equal(at6('2026-11-02T14:00:00Z'), true);
});

test('E. HOURLY TICKS across the change: exactly one 8 AM and one 6 AM firing per Pacific day', () => {
  const real = new Map();
  const preview = new Map();
  const ptDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(d);
  for (let t = Date.parse('2026-10-29T00:00:00Z'); t < Date.parse('2026-11-04T00:00:00Z'); t += 3_600_000) {
    const d = new Date(t);
    if (at8(d)) real.set(ptDate(d), (real.get(ptDate(d)) ?? 0) + 1);
    if (at6(d)) preview.set(ptDate(d), (preview.get(ptDate(d)) ?? 0) + 1);
  }
  const days = ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03'];
  for (const day of days) { assert.equal(real.get(day), 1, `real ${day}`); assert.equal(preview.get(day), 1, `preview ${day}`); }
});

test('E. THE ROUTES: hourly, gated on the Pacific hour before any work; the ET-day ledger keeps it to once', () => {
  const crons = JSON.parse(src('vercel.json')).crons;
  for (const p of ['/api/cron/morning-email', '/api/cron/morning-preview']) assert.ok(crons.some((c) => c.path === p && c.schedule === '0 * * * *'), p);
  const email = src('app/api/cron/morning-email/route.js');
  assert.ok(email.indexOf('isPacificHour(now, SEND_HOUR_PT)') > 0 && email.indexOf('isPacificHour(now, SEND_HOUR_PT)') < email.indexOf('runMorning('));
  const preview = src('app/api/cron/morning-preview/route.js');
  assert.ok(preview.indexOf('isPacificHour(now, PREVIEW_HOUR_PT)') > 0 && preview.indexOf('isPacificHour(now, PREVIEW_HOUR_PT)') < preview.indexOf('runPreview('));
  assert.doesNotMatch(preview, /morningEnabled/, 'the preview runs with MORNING_EMAIL off');
  assert.match(src('lib/ops/cronWatchdog.js'), /job: 'morning-preview', path: '\/api\/cron\/morning-preview'/);
});
