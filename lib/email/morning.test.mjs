// lib/email/morning.test.mjs - the morning email (ruling thu-1, built sun-2): the
// audience rule, once per user per ET day, hard bounces never mailed, the kill
// switch, and the template.
//
// Fixture: SENTINEL users (mtest-...@example.invalid), one sentinel Daily board
// (edition 1998-01-xx), webhook bounce rows to a sentinel address. after()
// deletes every one and asserts it did.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const aud = await import('./morningAudience.js');
const ms = await import('./morningSend.js');
const { buildMorningEmail, morningSubject, MORNING_FOOTER } = await import('../emails/morning.js');
const { sql } = await import('../db.js');

const NS = `mtest-${process.pid}-${Date.now()}`;
const U = {};
let boardId;

async function mkUser(tag, { daysOld = 100, pref = null, optedOut = false, house = false } = {}) {
  const [u] = await sql`
    INSERT INTO users (email, created_at, morning_email, email_opted_out_at, is_house)
    VALUES (${`${NS}-${tag}@example.invalid`}, now() - make_interval(days => ${daysOld}), ${pref},
            ${optedOut ? new Date().toISOString() : null}, ${house})
    RETURNING id`;
  U[tag] = u.id;
  return u.id;
}
const played = (uid, daysAgo) => sql`
  INSERT INTO daily_board_runs (board_id, user_id, picks, score, pct, matched, elapsed_s, completed_at, started_at)
  VALUES (${boardId}, ${uid}, '[]'::jsonb, 1000, 50, 1, 60, now() - make_interval(days => ${daysAgo}), now() - make_interval(days => ${daysAgo}))`;

before(async () => {
  const [b] = await sql`
    INSERT INTO daily_boards (edition_date, season_year, seed, board, ceiling, best_roster, slots, opens_at, closes_at)
    VALUES (${`1998-01-${String(10 + (process.pid % 18)).padStart(2, '0')}`}, 1998, ${NS}, '[]'::jsonb, 100, '[]'::jsonb, '[]'::jsonb,
            '1998-01-01T00:00:00Z', '1998-01-02T00:00:00Z')
    RETURNING id`;
  boardId = b.id;
  await played(await mkUser('active'), 5);
  await played(await mkUser('dormant'), 40);
  await mkUser('new', { daysOld: 3 });
  await mkUser('optedin', { pref: true });
  await played(await mkUser('optedout', { pref: false }), 2);
  await played(await mkUser('unsub', { optedOut: true }), 2);
  await played(await mkUser('bounced'), 2);
  await played(await mkUser('house', { house: true }), 2);
  await sql`INSERT INTO sync_runs (source, kind, started_at, finished_at, ok, summary)
            VALUES ('resend-webhook', 'bounced', now(), now(), false, ${JSON.stringify({ to: `${NS}-bounced@example.invalid`, outcome: 'bounced' })}::jsonb)`;
});

after(async () => {
  const ids = Object.values(U);
  await sql`DELETE FROM sync_runs WHERE source = 'morning-email' AND (summary->>'userId')::int = ANY(${ids})`;
  await sql`DELETE FROM sync_runs WHERE source = 'resend-webhook' AND summary->>'to' LIKE ${`${NS}-%`}`;
  await sql`DELETE FROM daily_board_runs WHERE board_id = ${boardId}`;
  await sql`DELETE FROM daily_boards WHERE id = ${boardId}`;
  await sql`DELETE FROM users WHERE email LIKE ${`${NS}-%@example.invalid`}`;
  const [{ n }] = await sql`
    SELECT (SELECT count(*) FROM users WHERE email LIKE ${`${NS}-%@example.invalid`})
         + (SELECT count(*) FROM daily_boards WHERE id = ${boardId})
         + (SELECT count(*) FROM sync_runs WHERE source = 'morning-email' AND (summary->>'userId')::int = ANY(${ids})) AS n`;
  assert.equal(Number(n), 0, 'teardown left nothing behind');
});

test('THE RULE (thu-1), PURE: 30-day players, new accounts, /you opt-ins; dormant get nothing', () => {
  const e = aud.morningEligible;
  assert.equal(e({ playedDaysAgo: 5 }), true, '(a) played in 30 days');
  assert.equal(e({ playedDaysAgo: 31, ageDays: 400 }), false, 'dormant: nothing');
  assert.equal(e({ ageDays: 3 }), true, '(b) a new account');
  assert.equal(e({ ageDays: 14 }), false, '14 days is no longer new');
  assert.equal(e({ pref: true, playedDaysAgo: null, ageDays: 400 }), true, '(c) turned ON at /you');
  assert.equal(e({ pref: false, playedDaysAgo: 1 }), false, 'turned OFF wins over the rule');
  for (const k of ['optedOut', 'house', 'owner', 'bounced']) assert.equal(e({ pref: true, playedDaysAgo: 1, [k]: true }), false, k);
  assert.equal(e({ playedDaysAgo: 1, hasAddress: false }), false);
});

test('THE AUDIENCE ON DEV: exactly active / new / opted-in of the fixture, with their reasons', async () => {
  const rows = (await aud.morningAudience(sql, { owners: [] })).filter((r) => Object.values(U).includes(Number(r.id)));
  const got = Object.fromEntries(rows.map((r) => [Object.keys(U).find((k) => U[k] === Number(r.id)), r.why]));
  assert.deepEqual(got, { active: 'active', new: 'new', optedin: 'opted_in' },
    'not dormant, not opted out, not unsubscribed, not hard-bounced, not house');
});

test('THE RUN: off by default; once per user per ET day; a bounce is never mailed', async () => {
  const sent = [];
  const deps = {
    send: async (m) => { sent.push(m); return { data: { id: `fake-${sent.length}` } }; },
    unsubscribeUrlFor: async (id) => `https://sportsvyn.com/api/email/unsubscribe?u=${id}`,
    clickUrlFor: ({ to }) => to, unsubscribeHeaders: () => ({}),
  };
  const only = Object.values(U);
  delete process.env.MORNING_EMAIL;
  assert.deepEqual(await ms.runMorning({ ...deps, onlyUserIds: only }), { day: ms.etDay(), decision: 'skipped-off' }, 'the kill switch defaults OFF');
  assert.equal(sent.length, 0);

  const first = await ms.runMorning({ ...deps, force: true, onlyUserIds: only });
  assert.equal(first.sent, 3);
  assert.deepEqual(sent.map((m) => m.to).sort(), [`${NS}-active@example.invalid`, `${NS}-new@example.invalid`, `${NS}-optedin@example.invalid`].sort());
  assert.ok(!sent.some((m) => m.to.includes('-bounced')), 'hard bounce never mailed');
  const second = await ms.runMorning({ ...deps, force: true, onlyUserIds: only });
  assert.equal(second.sent, 0, 'a second firing the same ET day mails nobody');
  assert.equal(second.skipped, 3);
  const rows = await sql`SELECT summary FROM sync_runs WHERE source = 'morning-email' AND kind = 'send' AND (summary->>'userId')::int = ANY(${only})`;
  assert.equal(rows.length, 3, 'one ledger row per reader per day');
  assert.ok(rows.every((r) => r.summary.outcome === 'sent' && r.summary.day === ms.etDay()));
  assert.ok(sent.every((m) => /Unsubscribe/.test(m.html) && /Play today's Daily/.test(m.html)));
});

test('THE CRON: kill switch first, 15:00Z, watched; the switch reads only MORNING_EMAIL=on', () => {
  assert.equal(ms.morningEnabled({}), false);
  assert.equal(ms.morningEnabled({ MORNING_EMAIL: 'off' }), false);
  assert.equal(ms.morningEnabled({ MORNING_EMAIL: 'on' }), true);
  const route = src('app/api/cron/morning-email/route.js');
  assert.ok(route.indexOf('if (!morningEnabled())') < route.indexOf('runMorning('), 'off means no run at all');
  assert.match(route, /const SOURCE = 'morning-email';/);
  assert.equal(ms.SOURCE, 'morning-email');
  const crons = JSON.parse(src('vercel.json')).crons;
  assert.ok(crons.some((c) => c.path === '/api/cron/morning-email' && c.schedule === '0 15 * * *'));
  assert.match(src('lib/ops/cronWatchdog.js'), /job: 'morning-email', path: '\/api\/cron\/morning-email', source: 'morning-email', schedule: '0 15 \* \* \*'/);
  assert.match(src('scripts/morning-email.mjs'), /if \(!OWNER_ADDRESSES\.includes\(to\)\)/, 'a test goes only to an owner address');
});

test('THE TEMPLATE: blocks only when true, hyphens only, a way out on every mail', () => {
  const links = { daily: 'https://s/d', scores: 'https://s/s', game: 'https://s/g', unsubscribe: 'https://s/u' };
  const bare = buildMorningEmail({ day: '2026-10-20', wordmarkUrl: 'https://s/w.png', links });
  assert.equal(bare.subject, "Today's Daily is live - Tue, Oct 20");
  assert.ok(!/YOUR YESTERDAY|GAME OF THE DAY|LOCKING TODAY/.test(bare.html), 'no empty blocks');
  const full = buildMorningEmail({
    day: '2026-10-20', wordmarkUrl: 'https://s/w.png', links,
    yesterday: { score: 2388.5, rank: 3, of: 41 }, game: { away: 'Yankees', home: 'Dodgers', league: 'MLB', time: '8:08 PM ET' },
    locks: [{ label: "Pick'em NFL", time: '8:15 PM ET', entered: true, href: 'https://s/p' }],
  });
  assert.equal(full.subject, "You were 3rd of 41 yesterday - today's Daily is live");
  for (const b of ['YOUR YESTERDAY', 'GAME OF THE DAY', 'LOCKING TODAY', "You're in - locks 8:15 PM ET", '2,388.5']) assert.ok(full.html.includes(b) || full.text.includes(b), b);
  assert.equal(morningSubject({ day: '2026-10-20', game: { away: 'A', home: 'B' } }), 'A at B today - and a new Daily');
  for (const m of [bare, full]) {
    assert.ok(!/[–—]/.test(m.html + m.text + m.subject), 'hyphens only');
    assert.ok(m.html.includes('https://s/u') && m.text.includes('https://s/u'), 'the unsubscribe link');
    assert.ok(m.text.includes(MORNING_FOOTER));
  }
});
