// scripts/push-sentinel.mjs — prove one delivery end to end, then leave no
// trace. Committed because every future change to the dispatcher wants exactly
// this run before it ships.
//
// A SENTINEL USER AND A SENTINEL DEVICE, NEVER A REAL ONE. Seeding a real
// account's row to prove a write path is how a real reader ends up with a test
// notification, and the row you restore afterwards is never quite the row you
// found. Everything here is created by this script and deleted by it.
//
// THE SENDER IS A FAKE BY DEFAULT. What is being proved is the pipeline -
// audience resolution, pref gating, the dedupe claim, the payload - not that
// Google's push service is up. Pass --real to use the live VAPID sender
// against a real endpoint supplied in SENTINEL_ENDPOINT.
//
// Usage: set -a && . ./.env.local && set +a && node scripts/push-sentinel.mjs

import { neon } from '@neondatabase/serverless';
import { dispatch } from '../lib/push/dispatch.js';

const sql = neon(process.env.PROD_DATABASE_URL);
const MARK = `sentinel-push-${Date.now()}`;
const log = (...a) => console.log(...a);

let userId = null, deviceToken = null, prefIds = [];
const delivered = [];

async function teardown() {
  log('\n--- teardown ---');
  if (deviceToken) {
    const r = await sql`DELETE FROM push_sends WHERE device_token = ${deviceToken} RETURNING id`;
    log(`  push_sends deleted: ${r.length}`);
    await sql`DELETE FROM device_tokens WHERE token = ${deviceToken}`;
    log('  device_tokens deleted: 1');
  }
  if (prefIds.length) {
    const r = await sql`DELETE FROM alert_prefs WHERE id = ANY(${prefIds}) RETURNING id`;
    log(`  alert_prefs deleted: ${r.length}`);
  }
  if (userId) {
    await sql`DELETE FROM user_team_follows WHERE user_id = ${userId}`;
    await sql`DELETE FROM users WHERE id = ${userId}`;
    log('  sentinel user deleted: 1');
  }
  // VERIFY THE TEARDOWN RATHER THAN ASSUMING IT. A sentinel that leaks into a
  // production table is worse than no sentinel, and this project has leaked
  // one before.
  const left = await sql`
    SELECT (SELECT count(*)::int FROM users WHERE email LIKE 'sentinel-push-%') AS users,
           (SELECT count(*)::int FROM device_tokens WHERE token LIKE 'sentinel-push-%') AS devices`;
  log(`  residue check -> users ${left[0].users}, devices ${left[0].devices}`);
  if (left[0].users || left[0].devices) throw new Error('SENTINEL RESIDUE LEFT BEHIND');
}

try {
  // A live-ish gridiron match to hang the event on. Read-only: we never write
  // to it, only name it.
  const [match] = await sql`
    SELECT m.id, m.slug, m.home_team_id, m.away_team_id, l.slug AS "leagueSlug",
           h.abbreviation AS "homeAbbr", a.abbreviation AS "awayAbbr"
      FROM matches m JOIN leagues l ON l.id = m.league_id AND l.slug IN ('nfl','cfb')
      JOIN teams h ON h.id = m.home_team_id JOIN teams a ON a.id = m.away_team_id
     WHERE m.status = 'scheduled' ORDER BY m.kickoff_at LIMIT 1`;
  if (!match) throw new Error('no match to test against');
  log(`match: ${match.awayAbbr} at ${match.homeAbbr} (#${match.id})`);

  const [u] = await sql`
    INSERT INTO users (name, email) VALUES ('Sentinel Push', ${`${MARK}@example.invalid`})
    RETURNING id`;
  userId = u.id;
  await sql`INSERT INTO user_team_follows (user_id, team_id) VALUES (${userId}, ${match.home_team_id})`;
  await sql`
    INSERT INTO device_tokens (token, user_id, platform, endpoint, p256dh, auth, user_agent)
    VALUES (${MARK}, ${userId}, 'web', ${MARK}, 'sentinel-p256dh', 'sentinel-auth', 'sentinel')`;
  deviceToken = MARK;
  log(`sentinel user #${userId}, device ${deviceToken}, following ${match.homeAbbr}`);

  const fake = async (device, payload) => { delivered.push({ device: device.token, payload }); return { ok: true, status: 201, gone: false }; };
  const senders = { web: fake, ios: fake };
  const state = { homeScore: 14, awayScore: 10, period: 2, clock: '8:41' };

  log('\n--- fire 1: a score change ---');
  const one = await dispatch(sql, { match: { ...match, home_abbr: match.homeAbbr }, event: 'score', state, senders, log });
  log(`  ${JSON.stringify(one)}`);
  log(`  delivered: ${delivered.length}  title="${delivered[0]?.payload?.title}" body="${delivered[0]?.payload?.body}"`);

  log('\n--- fire 2: the SAME score again (the restart case) ---');
  const two = await dispatch(sql, { match: { ...match, home_abbr: match.homeAbbr }, event: 'score', state, senders, log });
  log(`  ${JSON.stringify(two)}`);
  log(`  delivered total: ${delivered.length}  (must still be 1)`);

  log('\n--- fire 3: master off ---');
  const [pref] = await sql`
    INSERT INTO alert_prefs (user_id, scope, scope_id, master) VALUES (${userId}, 'match', ${match.id}, false)
    RETURNING id`;
  prefIds.push(pref.id);
  const three = await dispatch(sql, { match: { ...match, home_abbr: match.homeAbbr }, event: 'score',
    state: { ...state, homeScore: 21 }, senders, log });
  log(`  ${JSON.stringify(three)}`);
  log(`  delivered total: ${delivered.length}  (must still be 1)`);

  const pass = one.sent === 1 && two.sent === 0 && two.skipped === 1 && three.sent === 0 && delivered.length === 1;
  log(`\nRESULT: ${pass ? 'PASS - one delivery, one dedupe, one suppression' : 'FAIL'}`);
  if (!pass) process.exitCode = 1;
} catch (e) {
  log('ERROR:', e.message);
  process.exitCode = 1;
} finally {
  await teardown();
}
