// lib/push/liveDeviceTokens.test.mjs - the master-toggle filter (relay 5b
// item 3), against real DEV state. Two sentinel users, one device each:
// U1 has silenced every team they've configured (master=false on every
// alert_prefs row) - excluded when excludeMasterOff. U2 has no alert_prefs
// rows at all - included regardless (resolvePrefs()'s own "no row =
// DEFAULTS" rule, and DEFAULTS.master is true).

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
(function loadEnv(p) {
  let t; try { t = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of t.split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const k = s.slice(0, eq).trim(); let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.resolve(__dirname, '..', '..', '.env.local'));

const { sql } = await import('../db.js');
const { liveDeviceTokens } = await import('./notify.js');

const RUN_TAG = Date.now();
const TOKEN_OFF = `sentinel-off-${RUN_TAG}`;
const TOKEN_ON = `sentinel-on-${RUN_TAG}`;
let userOff = null;
let userOn = null;
const prefIds = [];

test('master toggle: a user who silenced every team they follow is excluded; a user with no prefs is included', async () => {
  const uOff = await sql`INSERT INTO users (email) VALUES (${`sentinel-master-off-${RUN_TAG}@example.invalid`}) RETURNING id`;
  userOff = uOff[0].id;
  const uOn = await sql`INSERT INTO users (email) VALUES (${`sentinel-master-on-${RUN_TAG}@example.invalid`}) RETURNING id`;
  userOn = uOn[0].id;

  await sql`INSERT INTO device_tokens (token, user_id, platform) VALUES (${TOKEN_OFF}, ${userOff}, 'ios')`;
  await sql`INSERT INTO device_tokens (token, user_id, platform) VALUES (${TOKEN_ON}, ${userOn}, 'ios')`;

  // U-off: two team prefs, BOTH master=false - every team they've
  // configured is silenced.
  const p1 = await sql`INSERT INTO alert_prefs (user_id, scope, scope_id, master) VALUES (${userOff}, 'team', 999001, false) RETURNING id`;
  const p2 = await sql`INSERT INTO alert_prefs (user_id, scope, scope_id, master) VALUES (${userOff}, 'team', 999002, false) RETURNING id`;
  prefIds.push(p1[0].id, p2[0].id);
  // U-on: NO alert_prefs rows at all - the "never configured anything" case.

  const unrestricted = await liveDeviceTokens(sql, { excludeMasterOff: false });
  assert.ok(unrestricted.includes(TOKEN_OFF), 'unrestricted (v1\'s own default) includes everyone, even the silenced one');
  assert.ok(unrestricted.includes(TOKEN_ON));

  const filtered = await liveDeviceTokens(sql, { excludeMasterOff: true });
  console.log('\n--- master-toggle-filtered audience (DEV) ---');
  console.log(JSON.stringify(filtered));
  assert.ok(!filtered.includes(TOKEN_OFF), 'the fully-silenced user must be excluded');
  assert.ok(filtered.includes(TOKEN_ON), 'the never-configured user must still be included (default master=true)');
});

after(async () => {
  if (prefIds.length) await sql`DELETE FROM alert_prefs WHERE id = ANY(${prefIds})`;
  await sql`DELETE FROM device_tokens WHERE token = ANY(${[TOKEN_OFF, TOKEN_ON]})`;
  const ids = [userOff, userOn].filter((x) => x != null);
  if (ids.length) await sql`DELETE FROM users WHERE id = ANY(${ids})`;
});
