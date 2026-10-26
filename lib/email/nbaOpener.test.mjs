// lib/email/nbaOpener.test.mjs - the NBA opener broadcast (mon-5): Group B's
// exclusions, no doubles between A and B (one ledger), the stop rule, the
// kill switch and the day/clock gates, and B's mail (no YOUR MOVE, account footer).
//
// Fixture: SENTINEL users (nbo-...@example.invalid) and ledger rows on two FAKE
// days (1998-02-xx), so nothing here meets a real morning. after() deletes every
// one and asserts it did.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const nbo = await import('./nbaOpener.js');
const ms = await import('./morningSend.js');
const { ACCOUNT_FOOTER, MORNING_FOOTER } = await import('../emails/morning.js');
const { sql } = await import('../db.js');

const NS = `nbo-${process.pid}-${Date.now()}`;
const dd = String(1 + (process.pid % 27)).padStart(2, '0');
const DAY1 = `1998-02-${dd}`;
const DAY2 = `1998-03-${dd}`;
const U = {};
let boardId;
const addr = (tag) => `${NS}-${tag}@example.invalid`;

async function mkUser(tag, { daysOld = 100, pref = null, optedOut = false, house = false, contact = null } = {}) {
  const [u] = await sql`
    INSERT INTO users (email, contact_email, created_at, morning_email, email_opted_out_at, is_house)
    VALUES (${addr(tag)}, ${contact}, now() - make_interval(days => ${daysOld}), ${pref}, ${optedOut ? new Date().toISOString() : null}, ${house})
    RETURNING id`;
  U[tag] = u.id;
  return u.id;
}
const webhook = (kind, summary) => sql`
  INSERT INTO sync_runs (source, kind, started_at, finished_at, ok, summary)
  VALUES ('resend-webhook', ${kind}, now(), now(), false, ${JSON.stringify({ outcome: kind, ...summary })}::jsonb)`;

let n = 0;
const sent = [];
const deps = {
  send: async (m) => { sent.push(m); n += 1; return { data: { id: `${NS}-msg-${n}` } }; },
  unsubscribeUrlFor: async (id) => `https://sportsvyn.com/api/email/unsubscribe?u=${id}`,
  clickUrlFor: ({ to }) => to, unsubscribeHeaders: () => ({}),
};

before(async () => {
  const [b] = await sql`
    INSERT INTO daily_boards (edition_date, season_year, seed, board, ceiling, best_roster, slots, opens_at, closes_at)
    VALUES (${`1998-04-${dd}`}, 1998, ${NS}, '[]'::jsonb, 100, '[]'::jsonb, '[]'::jsonb, '1998-01-01T00:00:00Z', '1998-01-02T00:00:00Z')
    RETURNING id`;
  boardId = b.id;
  const played = (uid) => sql`
    INSERT INTO daily_board_runs (board_id, user_id, picks, score, pct, matched, elapsed_s, completed_at, started_at)
    VALUES (${boardId}, ${uid}, '[]'::jsonb, 1000, 50, 1, 60, now() - interval '2 days', now() - interval '2 days')`;
  await played(await mkUser('active'));        // A
  await mkUser('dormant');                     // B
  await mkUser('dormant2');                    // B
  await mkUser('unsub', { optedOut: true });   // neither
  await mkUser('bounced');                     // neither
  await mkUser('softbounce');                  // B: a transient bounce does not suppress
  await mkUser('complained');                  // neither
  await mkUser('house', { house: true });      // neither
  await mkUser('prefoff', { pref: false });    // neither: Morning email OFF at /you
  await mkUser('owner');                       // neither (passed as an owner address)
  await mkUser('twinb', { contact: addr('dormant') });  // neither: dormant's address, a second account
  await mkUser('twina', { contact: addr('active') });   // neither: an address A already mails
  await webhook('bounced', { to: addr('bounced'), bounceType: 'Permanent' });
  await webhook('bounced', { to: addr('softbounce'), bounceType: 'Transient' });
  await webhook('complained', { to: addr('complained') });
});

after(async () => {
  const ids = Object.values(U);
  await sql`DELETE FROM sync_runs WHERE source = 'morning-email' AND (summary->>'userId')::int = ANY(${ids})`;
  await sql`DELETE FROM sync_runs WHERE source = 'morning-email' AND kind = ${nbo.STOP_KIND} AND summary->>'day' = ANY(${[DAY1, DAY2]})`;
  await sql`DELETE FROM sync_runs WHERE source = 'resend-webhook' AND (summary->>'to' LIKE ${`${NS}-%`} OR summary->>'messageId' LIKE ${`${NS}-%`})`;
  await sql`DELETE FROM daily_board_runs WHERE board_id = ${boardId}`;
  await sql`DELETE FROM daily_boards WHERE id = ${boardId}`;
  await sql`DELETE FROM users WHERE email LIKE ${`${NS}-%@example.invalid`}`;
  const [{ left }] = await sql`
    SELECT (SELECT count(*) FROM users WHERE email LIKE ${`${NS}-%@example.invalid`})
         + (SELECT count(*) FROM sync_runs WHERE source = 'morning-email' AND ((summary->>'userId')::int = ANY(${ids}) OR summary->>'day' = ANY(${[DAY1, DAY2]})))
         + (SELECT count(*) FROM sync_runs WHERE source = 'resend-webhook' AND (summary->>'to' LIKE ${`${NS}-%`} OR summary->>'messageId' LIKE ${`${NS}-%`})) AS left`;
  assert.equal(Number(left), 0, 'teardown left nothing behind');
});

const mine = (rows) => rows.map((r) => Object.keys(U).find((k) => U[k] === Number(r.id))).filter(Boolean).sort();

test('THE STOP RULE, PURE: more than 1 complaint, or hard bounces above 5% of B', () => {
  assert.equal(nbo.stopReason({ complaints: 1, hardBounces: 0, sent: 50 }), null, 'one complaint is allowed');
  assert.match(nbo.stopReason({ complaints: 2, sent: 50 }), /complaints 2 > 1/);
  assert.equal(nbo.stopReason({ hardBounces: 5, sent: 100 }), null, 'exactly 5% does not stop');
  assert.match(nbo.stopReason({ hardBounces: 6, sent: 100 }), /hard bounces 6\/100/);
  assert.match(nbo.stopReason({ hardBounces: 3, sent: 50 }), /6\.0%/, 'checked at any point, after one batch too');
  assert.equal(nbo.stopReason({ hardBounces: 0, sent: 0 }), null);
});

test('GROUP B: everyone else with an address; never unsubscribed, bounced, complained, house, owner, OFF at /you, or A', async () => {
  const b = await nbo.groupB(sql, { day: DAY1, owners: [addr('owner')] });
  assert.deepEqual(mine(b), ['dormant', 'dormant2', 'softbounce']);
  const a = (await (await import('./morningAudience.js')).morningAudience(sql, { owners: [addr('owner')] }));
  // SCOPED to this run's own users: A and B are two reads of the WHOLE users table, and in the
  // shared CI database another file's user can turn active (or be created) between the two
  // reads - landing in B on the first and A on the second. Rows that are not ours say nothing.
  const own = new Set(Object.values(U).map(Number));
  const aIds = new Set(a.map((r) => Number(r.id)).filter((id) => own.has(id)));
  const bOwn = b.filter((r) => own.has(Number(r.id)));
  assert.ok(aIds.has(U.active), 'the active player is in A');
  assert.ok(bOwn.length > 0 && !bOwn.some((r) => aIds.has(Number(r.id))), 'nobody is in both A and B');
  assert.ok(!mine(b).includes('twinb') && !mine(b).includes('twina'), 'one send per ADDRESS: a second account on a B or A address is not B');
});

test('NO DOUBLES: A then B on one day, one ledger; reruns of either mail nobody; B is the B mail', async () => {
  const only = Object.values(U);
  const now = new Date(`${DAY1}T15:00:30Z`);
  const a = await ms.runMorning({ ...deps, now, force: true, onlyUserIds: only });
  assert.equal(a.sent, 1, 'A: the active player');
  const aMail = sent.at(-1);
  const b = await nbo.runOpenerBatch({ ...deps, force: true, day: DAY1, onlyUserIds: [U.dormant, U.active, U.unsub, U.house, U.prefoff], batch: 50 });
  assert.equal(b.decision, 'sent-batch');
  assert.equal(b.sent, 1, 'B: only the dormant account of those offered - A, unsub, house and OFF are not B');
  const bMail = sent.at(-1);
  assert.equal(bMail.to, addr('dormant'));
  assert.equal(bMail.subject, aMail.subject, 'the same subject line');
  assert.ok(bMail.html.includes(ACCOUNT_FOOTER.replace(/'/g, '&#39;')) || bMail.html.includes(ACCOUNT_FOOTER), 'the account footer');
  assert.ok(!bMail.html.includes('play on Sportsvyn'), 'not the players\' footer');
  assert.ok(bMail.text.includes(ACCOUNT_FOOTER) && !bMail.text.includes(MORNING_FOOTER));
  assert.ok(!/YOUR MOVE/i.test(bMail.html), 'no YOUR MOVE');
  assert.ok(/Unsubscribe from all email/.test(bMail.html));

  const before = sent.length;
  const again = await nbo.runOpenerBatch({ ...deps, force: true, day: DAY1, onlyUserIds: [U.dormant, U.active] });
  assert.equal(again.decision, 'done');
  const aAgain = await ms.runMorning({ ...deps, now, force: true, onlyUserIds: [U.active, U.dormant] });
  assert.equal(aAgain.sent, 0, 'A rerun after B mails nobody - not even the B reader');
  assert.equal(sent.length, before);
  const rows = await sql`SELECT (summary->>'userId')::int AS u, count(*)::int AS c FROM sync_runs
                          WHERE source = 'morning-email' AND kind = 'send' AND summary->>'day' = ${DAY1} AND (summary->>'userId')::int = ANY(${only})
                          GROUP BY 1`;
  assert.ok(rows.every((r) => r.c === 1), 'one ledger row per person per day');
  assert.deepEqual(rows.map((r) => r.u).sort((x, y) => x - y), [U.active, U.dormant].sort((x, y) => x - y));
});

test('ONE PER ADDRESS ACROSS BATCHES: the first twin mailed, the second never surfaces', async () => {
  const day = `1998-05-${dd}`;
  const r = await nbo.runOpenerBatch({ ...deps, force: true, day, onlyUserIds: [U.dormant, U.twinb], batch: 50 });
  assert.equal(r.sent, 1);
  assert.equal(sent.at(-1).to, addr('dormant'));
  const again = await nbo.runOpenerBatch({ ...deps, force: true, day, onlyUserIds: [U.dormant, U.twinb], batch: 50 });
  assert.equal(again.decision, 'done', 'twinb shares the mailed address');
  await sql`DELETE FROM sync_runs WHERE source = 'morning-email' AND kind = 'send' AND summary->>'day' = ${day}`;
});

test('BATCHES: at most `batch` per firing; the rest wait for the next', async () => {
  const r = await nbo.runOpenerBatch({ ...deps, force: true, day: DAY2, onlyUserIds: [U.dormant, U.dormant2], batch: 1 });
  assert.equal(r.sent, 1);
  assert.equal(r.remaining, 1);
});

test('THE STOP: a hard bounce on B above 5% stops the rest, and it stays stopped', async () => {
  const [{ id }] = await sql`SELECT summary->>'id' AS id FROM sync_runs WHERE source = 'morning-email' AND kind = 'send'
                              AND summary->>'day' = ${DAY2} AND summary->>'why' = ${nbo.WHY} LIMIT 1`;
  await webhook('bounced', { messageId: id, to: 'x', bounceType: 'Permanent' });
  const r = await nbo.runOpenerBatch({ ...deps, force: true, day: DAY2, onlyUserIds: [U.dormant, U.dormant2] });
  assert.equal(r.decision, 'stopped');
  assert.match(r.reason, /hard bounces 1\/1/);
  assert.equal(r.justStopped, true);
  const before = sent.length;
  const again = await nbo.runOpenerBatch({ ...deps, force: true, day: DAY2, onlyUserIds: [U.dormant, U.dormant2] });
  assert.equal(again.decision, 'stopped');
  assert.equal(sent.length, before, 'nothing more goes out');
});

test('THE STOP: two complaints on the day (A or B) stop B', async () => {
  const ids = await sql`SELECT summary->>'id' AS id FROM sync_runs WHERE source = 'morning-email' AND kind = 'send' AND summary->>'day' = ${DAY1} AND summary->>'outcome' = 'sent'`;
  assert.equal(ids.length, 2);
  await webhook('complained', { messageId: ids[0].id });
  assert.equal(nbo.stopReason(await nbo.dayHealth(sql, { day: DAY1 })), null, 'one complaint: carry on');
  await webhook('complained', { messageId: ids[1].id });
  const r = await nbo.runOpenerBatch({ ...deps, force: true, day: DAY1, onlyUserIds: [U.dormant2] });
  assert.equal(r.decision, 'stopped');
  assert.match(r.reason, /complaints 2/);
});

test('THE GATES: switch OFF by default; Tue 20 Oct only; not before 15:05Z; A must have finished', async () => {
  const keep = process.env.BROADCAST_NBA_OPENER;
  try {
    delete process.env.BROADCAST_NBA_OPENER;
    assert.equal((await nbo.runOpenerBatch({ ...deps })).decision, 'skipped-off');
    assert.equal(nbo.openerEnabled({ BROADCAST_NBA_OPENER: 'off' }), false);
    assert.equal(nbo.openerEnabled({ BROADCAST_NBA_OPENER: 'on' }), true);
    process.env.BROADCAST_NBA_OPENER = 'on';
    assert.equal((await nbo.runOpenerBatch({ ...deps, now: new Date('2026-10-21T15:10:00Z') })).decision, 'wrong-day', 'Wednesday: back to A only');
    assert.equal((await nbo.runOpenerBatch({ ...deps, now: new Date('2026-10-20T15:04:00Z') })).decision, 'too-early');
    assert.equal(await nbo.groupAFinished(sql, { day: '1998-05-01' }), false, 'no A run: B waits');
  } finally {
    if (keep == null) delete process.env.BROADCAST_NBA_OPENER; else process.env.BROADCAST_NBA_OPENER = keep;
  }
  assert.equal(nbo.OPENER_DAY, '2026-10-20');
  assert.equal(nbo.BATCH, 50);
  const crons = JSON.parse(src('vercel.json')).crons;
  assert.ok(crons.some((c) => c.path === '/api/cron/nba-opener' && c.schedule === '5-45 15 20 10 *'), 'every minute from 15:05Z, 20 Oct');
  const route = src('app/api/cron/nba-opener/route.js');
  assert.ok(route.indexOf('openerEnabled()') < route.indexOf('runOpenerBatch('), 'the switch is read before anything runs');
});
