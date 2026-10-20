// lib/coins/drum.test.mjs - The Drum: coins in hand, the drop (final, server-
// validated, race-safe), who may enter (18+, not house), the live counts.
//
// Fixture: a 1998 drawing week with the default prizes, SENTINEL users with
// minted coins. after() deletes every row and asserts it did.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const drum = await import('./drum.js');
const { ensureWeek } = await import('./mint.js');
const { sql } = await import('../db.js');

const NS = `cdrum-${process.pid}-${Date.now()}`;
const NOW = new Date('1998-04-22T20:00:00Z');   // Wed; week opened Tue 21 Apr 09:00 PDT
const U = {};
let week;

async function mkUser(tag, { dob = '1970-01-01', house = false, coins = 0 } = {}) {
  const [u] = await sql`INSERT INTO users (email, is_house, date_of_birth) VALUES (${`${NS}-${tag}@example.invalid`}, ${house}, ${dob}) RETURNING id`;
  U[tag] = u.id;
  if (coins) await sql`INSERT INTO coin_mint (user_id, week_id, qty, seq, source) VALUES (${u.id}, ${week.id}, ${coins}, ${coins}, 'test')`;
  return u.id;
}

before(async () => {
  week = await ensureWeek(sql, NOW);
  await mkUser('adult', { coins: 4 });
  await mkUser('racer', { coins: 3 });
  await mkUser('minor', { dob: '1984-06-01', coins: 2 });   // 13 in April 1998
  await mkUser('nodob', { dob: null, coins: 2 });
  await mkUser('house', { house: true, coins: 2 });
});

after(async () => {
  const ids = Object.values(U);
  await sql`DELETE FROM drum_entries WHERE user_id = ANY(${ids})`;
  await sql`DELETE FROM coin_mint WHERE user_id = ANY(${ids})`;
  await sql`DELETE FROM drum_prizes WHERE week_id = ${week.id}`;
  await sql`DELETE FROM coin_weeks WHERE id = ${week.id}`;
  await sql`DELETE FROM users WHERE email LIKE ${`${NS}-%@example.invalid`}`;
  const [{ n }] = await sql`SELECT (SELECT count(*) FROM users WHERE email LIKE ${`${NS}-%@example.invalid`}) + (SELECT count(*) FROM coin_weeks WHERE id = ${week.id}) AS n`;
  assert.equal(Number(n), 0, 'teardown left nothing behind');
});

const drop = (tag, body, now = NOW) => drum.dropCoins({ userId: U[tag], body, now });

test('parseDrop, PURE: one drum or several, merged; nothing malformed', () => {
  assert.deepEqual(drum.parseDrop({ prize_key: 'gc10', qty: 2 }), { ok: true, drops: [{ prize_key: 'gc10', qty: 2 }] });
  assert.deepEqual(drum.parseDrop({ drops: [{ prize_key: 'gc10', qty: 1 }, { prize_key: 'gc10', qty: 1 }, { prize_key: 'cap', qty: 1 }] }).drops,
    [{ prize_key: 'gc10', qty: 2 }, { prize_key: 'cap', qty: 1 }]);
  for (const bad of [{ prize_key: 'gc10', qty: 0 }, { prize_key: 'gc10', qty: 1.5 }, { prize_key: 'gc10', qty: -1 }, { prize_key: "x'; drop", qty: 1 }, { drops: [] }]) {
    assert.equal(drum.parseDrop(bad).ok, false, JSON.stringify(bad));
  }
});

test('THE DROP: within the hand it lands; over it is refused; the view counts it', async () => {
  const ok = await drop('adult', { drops: [{ prize_key: 'gc25', qty: 2 }, { prize_key: 'cap', qty: 1 }] });
  assert.equal(ok.ok, true);
  assert.equal(ok.inHand, 1);
  const over = await drop('adult', { prize_key: 'gc10', qty: 2 });
  assert.deepEqual([over.ok, over.status], [false, 409]);
  const v = await drum.drumView({ userId: U.adult, now: NOW });
  assert.deepEqual([v.me.minted, v.me.dropped, v.me.inHand, v.me.eligible], [4, 3, 1, true]);
  const gc25 = v.drums.find((d) => d.prize_key === 'gc25');
  assert.ok(gc25.coins >= 2 && gc25.players >= 1);
  assert.equal(v.drums.at(-1).lowest || v.drums.find((d) => d.lowest).prize_key === 'gc10', true);
  assert.equal(v.drums.find((d) => d.lowest).prize_key, 'gc10');
});

test('WHO MAY DROP: a minor, a NULL date of birth and a house account earn but cannot enter', async () => {
  for (const tag of ['minor', 'nodob', 'house']) {
    const r = await drop(tag, { prize_key: 'gc10', qty: 1 });
    assert.deepEqual([r.ok, r.status], [false, 403], tag);
  }
  const v = await drum.drumView({ userId: U.minor, now: NOW });
  assert.deepEqual([v.me.inHand, v.me.eligible, v.me.ineligible], [2, false, 'age']);
  const n = await drum.drumView({ userId: U.nodob, now: NOW });
  assert.equal(n.me.ineligible, 'age', 'NULL is not 18+ until the first-win sheet collects it');
});

test('AFTER THE CLOSE nothing drops; an unknown drum is refused', async () => {
  const late = await drop('adult', { prize_key: 'gc10', qty: 1 }, new Date(new Date(week.closes_at).getTime() + 1000));
  assert.equal(late.ok, false);
  const bad = await drop('adult', { prize_key: 'nope', qty: 1 });
  assert.deepEqual([bad.ok, bad.status], [false, 400]);
});

test('A RACE SPENDS EACH COIN ONCE: two tabs drop all 3 at once, one wins', async () => {
  const rs = await Promise.all([drop('racer', { prize_key: 'gc10', qty: 3 }), drop('racer', { prize_key: 'gc25', qty: 3 })]);
  assert.equal(rs.filter((r) => r.ok).length, 1, JSON.stringify(rs));
  const [{ q }] = await sql`SELECT COALESCE(sum(qty), 0)::int AS q FROM drum_entries WHERE user_id = ${U.racer}`;
  assert.equal(q, 3);
});

test('NO UN-DROP: nothing in the app updates or deletes a drum entry', async () => {
  const { readFileSync, readdirSync, statSync } = await import('node:fs');
  const path = await import('node:path');
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
  const walk = (d) => readdirSync(d).flatMap((f) => {
    const p = path.join(d, f);
    if (/node_modules|\.next|\.git|test-tmp/.test(p)) return [];
    return statSync(p).isDirectory() ? walk(p) : /\.(js|mjs)$/.test(f) && !/\.test\.mjs$/.test(f) ? [p] : [];
  });
  const hits = [...walk(path.join(root, 'app')), ...walk(path.join(root, 'lib'))]
    .filter((f) => /(UPDATE|DELETE FROM)\s+drum_entries/i.test(readFileSync(f, 'utf8')));
  assert.deepEqual(hits, []);
});
