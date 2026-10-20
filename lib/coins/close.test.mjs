// lib/coins/close.test.mjs - the Tuesday drawing: a reproducible seeded draw,
// the dry run that writes nothing, the auto-drop (eligible players only), one
// claim, winners without replacement, the next week, every entrant told once.
//
// Fixture: a 1998 drawing week (closed at NOW), SENTINEL users with minted
// coins and drops. after() deletes every row and asserts it did.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const draw = await import('./draw.js');
const close = await import('./close.js');
const { ensureWeek } = await import('./mint.js');
const { resultsMail } = await import('./resultsEmail.js');
const { renderCopy } = await import('../push/copy.js');
const { sql } = await import('../db.js');

const NS = `cclose-${process.pid}-${Date.now()}`;
const IN_WEEK = new Date('1998-05-06T20:00:00Z');   // Wed; the week opened Tue 5 May 09:00 PDT
let week; const U = {};
let NOW;

async function mkUser(tag, { dob = '1970-01-01', house = false, coins = 0 } = {}) {
  const [u] = await sql`INSERT INTO users (email, handle, is_house, date_of_birth) VALUES (${`${NS}-${tag}@example.invalid`}, ${`${NS}-${tag}`.slice(0, 30)}, ${house}, ${dob}) RETURNING id`;
  U[tag] = u.id;
  if (coins) await sql`INSERT INTO coin_mint (user_id, week_id, qty, seq, source) VALUES (${u.id}, ${week.id}, ${coins}, ${coins}, 'test')`;
}
const drop = (tag, prize, qty) => sql`INSERT INTO drum_entries (user_id, week_id, prize_key, qty) VALUES (${U[tag]}, ${week.id}, ${prize}, ${qty})`;
const counts = async () => (await sql`
  SELECT (SELECT count(*) FROM drum_entries WHERE week_id = ${week.id})::int AS e,
         (SELECT count(*) FROM drum_winners WHERE week_id = ${week.id})::int AS w,
         (SELECT count(*) FROM coin_weeks WHERE opens_at >= ${week.opens_at} AND opens_at <= ${week.closes_at})::int AS k,
         (SELECT drawn_at FROM coin_weeks WHERE id = ${week.id}) AS d`)[0];

before(async () => {
  week = await ensureWeek(sql, IN_WEEK);
  NOW = new Date(new Date(week.closes_at).getTime() + 60_000);
  for (let i = 0; i < 6; i += 1) await mkUser(`a${i}`, { coins: 3 });
  await mkUser('minor', { dob: '1984-06-01', coins: 2 });
  await mkUser('house', { house: true, coins: 2 });
  await drop('a0', 'gc25', 3);
  await drop('a1', 'gc25', 1);
  await drop('a2', 'cap', 2);
});

after(async () => {
  // THIS FILE'S WEEKS ONLY (the drawn one and the one it opened): other files hold 1998 weeks in parallel.
  const weeks = (await sql`SELECT id FROM coin_weeks WHERE opens_at IN (${week.opens_at}, ${week.closes_at})`).map((w) => w.id);
  const ids = Object.values(U);
  await sql`DELETE FROM drum_winners WHERE week_id = ANY(${weeks})`;
  await sql`DELETE FROM drum_entries WHERE week_id = ANY(${weeks})`;
  await sql`DELETE FROM coin_mint WHERE week_id = ANY(${weeks})`;
  await sql`DELETE FROM arcade_points WHERE week_id = ANY(${weeks})`;
  await sql`DELETE FROM drum_prizes WHERE week_id = ANY(${weeks})`;
  await sql`DELETE FROM coin_weeks WHERE id = ANY(${weeks})`;
  await sql`DELETE FROM sync_runs WHERE source = 'coins-email' AND (summary->>'userId')::int = ANY(${ids})`;
  await sql`DELETE FROM users WHERE email LIKE ${`${NS}-%@example.invalid`}`;
  const [{ n }] = await sql`SELECT (SELECT count(*) FROM users WHERE email LIKE ${`${NS}-%@example.invalid`}) + (SELECT count(*) FROM coin_weeks WHERE id = ANY(${weeks})) AS n`;
  assert.equal(Number(n), 0, 'teardown left nothing behind');
});

test('THE DRAW, PURE: the same seed gives the same order; another seed another; no ticket twice', () => {
  const a = draw.shuffleOrder(200, 'DET 27 - SEA 20', 'gc25');
  assert.deepEqual(a, draw.shuffleOrder(200, 'DET 27 - SEA 20', 'gc25'), 'reproducible');
  assert.notDeepEqual(a, draw.shuffleOrder(200, 'DET 27 - SEA 21', 'gc25'));
  assert.notDeepEqual(a, draw.shuffleOrder(200, 'DET 27 - SEA 20', 'gc10'), 'each drum its own stream');
  assert.equal(new Set(a).size, 200);
  const d = draw.drawDrum({ entries: [{ id: 2, user_id: 7, qty: 1 }, { id: 1, user_id: 5, qty: 2 }], seed: 's', prizeKey: 'gc10', count: 5 });
  assert.deepEqual(d.tickets.map((t) => t.user_id), [5, 5, 7], 'tickets in drop-id order, one per coin');
  assert.equal(d.winners.length, 3, 'fewer coins than prizes: every coin wins, the rest unawarded');
  assert.equal(new Set(d.winners.map((w) => w.coin_index)).size, 3);
  // Uniform enough: over many seeds each of 4 tickets leads about a quarter of the time.
  const first = [0, 0, 0, 0];
  for (let s = 0; s < 4000; s += 1) first[draw.shuffleOrder(4, `seed${s}`, 'x')[0]] += 1;
  for (const f of first) assert.ok(f > 850 && f < 1150, JSON.stringify(first));
  assert.equal(draw.seedText({ away_abbr: 'DET', away_score: 27, home_abbr: 'SEA', home_score: 20 }), 'DET 27 - SEA 20');
});

test('THE COPY: push and email for a win and a miss render whole', () => {
  assert.match(renderCopy('coins-won:12', { week: '7', prize: 'a $25 gift card' }).body, /won a \$25 gift card/);
  assert.equal(renderCopy('coins-result:12', { week: '7', coins: '4 coins', next: '8' }).url, '/coins/results/12');
  const m = resultsMail({ ordinal: 7, prize: '$25 gift card', nextOrdinal: 8, href: 'https://x/c', unsubscribe: 'https://x/u' });
  assert.equal(m.subject, 'You won a $25 gift card in The Drum');
  assert.ok(!/[–—]/.test(m.html + m.text), 'hyphens only');
  assert.match(resultsMail({ ordinal: 7, coins: 4, nextOrdinal: 8, href: 'h', unsubscribe: 'u' }).subject, /not this week/);
});

test('DRY RUN writes nothing and shows the would-be winners, auto-drops included', async () => {
  const before = await counts();
  const r = await close.runClose({ now: NOW, dryRun: true, weekId: week.id });
  assert.equal(r.decision, 'dry-run');
  assert.deepEqual(await counts(), before, 'no row moved');
  assert.equal(r.autoDropped, 3 * 3 + 2 + 1 + 0, 'a2 kept 1, a1 kept 2, a3-a5 kept 3 each; a0 none; minor and house never');
  const gc10 = r.drums.find((d) => d.prize_key === 'gc10');
  assert.equal(gc10.coins, 12, 'the auto-drops land in the lowest drum');
  assert.equal(gc10.winners.length, 5);
});

test('THE CLOSE: one claim, auto-drop for eligible players only, winners, next week, everyone told once', async () => {
  const pushes = []; const mails = [];
  const notify = async (eventId, recipients) => { pushes.push({ eventId, n: recipients.length, users: recipients.map((r) => r.userId) }); return { sent: recipients.length }; };
  const send = async ({ won, coins }) => { mails.push({ won: won.size, coins: coins.size }); return { sent: coins.size }; };
  const r = await close.runClose({ now: NOW, notify, send, mint: false, weekId: week.id }); // the mint has its own tests; here it would touch other files' 1998 weeks
  assert.equal(r.decision, 'drawn');
  const auto = await sql`SELECT user_id, prize_key, qty FROM drum_entries WHERE week_id = ${week.id} AND auto ORDER BY user_id`;
  assert.ok(auto.every((a) => a.prize_key === 'gc10'));
  assert.ok(!auto.some((a) => [U.minor, U.house].includes(a.user_id)), 'a minor and a house account are never entered');
  assert.equal(auto.reduce((s, a) => s + a.qty, 0), 12);
  const w = await sql`SELECT prize_key, count(*)::int AS n FROM drum_winners WHERE week_id = ${week.id} GROUP BY 1 ORDER BY 1`;
  assert.deepEqual(Object.fromEntries(w.map((x) => [x.prize_key, x.n])), { cap: 1, gc10: 5, gc25: 2 });
  const [wk] = await sql`SELECT drawn_at, seed_text, draw FROM coin_weeks WHERE id = ${week.id}`;
  assert.ok(wk.drawn_at && wk.seed_text);
  assert.equal(wk.draw.coins, 4 + 2 + 12);
  // Anyone can rerun it: the published tickets + seed reproduce the published winners.
  for (const d of wk.draw.drums) {
    const order = draw.shuffleOrder(d.tickets.length, wk.seed_text, d.prize_key);
    assert.deepEqual(order.slice(0, Math.min(d.count, d.tickets.length)), d.winners.map((x) => x.coin_index), d.prize_key);
  }
  assert.ok(r.next && r.next !== week.id, 'the next week opened');
  assert.deepEqual(pushes.map((p) => p.eventId), [`coins-won:${week.id}`, `coins-result:${week.id}`]);
  const told = new Set(pushes.flatMap((p) => p.users));
  assert.equal(told.size, 6, 'every entrant once (the six adults), across the two waves');
  assert.equal(pushes[0].users.filter((u) => pushes[1].users.includes(u)).length, 0, 'a winner is not also told "not this week"');
  assert.equal(mails.length, 1);

  const again = await close.runClose({ now: NOW, notify, send, weekId: week.id });
  assert.equal(again.decision, 'nothing-to-close', 'the week is drawn; the next has not closed');
  assert.equal(pushes.length, 2);
});
