// lib/email/probeExclusion.test.mjs - the crew lobby-probe account (users.is_probe, migration 150) is a machine:
// never mailed, never counted. The DB half runs the real morning audience on DEV with SENTINEL users (one probe,
// one control person, both new enough to be mailed otherwise); the source half pins that every reader that counts
// the users table or builds an email audience names the flag. The inventory and the readers judged not to need
// it (entry-based boards) are in docs/reports/2026-11-03-probe-exclusion.md.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '../db.js';
import { morningAudience, testAccountRoster } from './morningAudience.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const NS = `probeex-${process.pid}-${Date.now()}`;
const ids = {};

before(async () => {
  for (const [tag, probe] of [['person', false], ['probe', true]]) {
    const [u] = await sql`
      INSERT INTO users (email, contact_email, created_at, is_probe)
      VALUES (${`${NS}-${tag}@example.invalid`}, ${`${NS}-${tag}@example.invalid`}, now(), ${probe}) RETURNING id`;
    ids[tag] = u.id;
  }
});
after(async () => {
  await sql`DELETE FROM users WHERE id = ANY(${[ids.person, ids.probe]})`;
  const [{ n }] = await sql`SELECT count(*)::int n FROM users WHERE email LIKE ${`${NS}%`}`;
  assert.equal(n, 0, 'teardown removed the sentinels');
});

test('morningAudience: a brand-new person is in, a brand-new probe account is not', async () => {
  const a = await morningAudience(sql, { owners: [] });
  assert.ok(a.some((r) => r.id === ids.person), 'control: the person is mailed');
  assert.ok(!a.some((r) => r.id === ids.probe), 'the probe never is');
});

test('the test-account roster skips the probe even when its address is listed as an owner', async () => {
  const roster = await testAccountRoster(sql, { owners: [`${NS}-probe@example.invalid`, `${NS}-person@example.invalid`] });
  assert.ok(roster.some((r) => r.id === ids.person));
  assert.ok(!roster.some((r) => r.id === ids.probe));
});

test('source: every email audience and users-table count names is_probe', () => {
  const must = {
    'lib/email/morningAudience.js': 2,
    'lib/email/nbaOpener.js': 1,
    'scripts/broadcast.mjs': 1,
    'lib/email/morningSend.js': 2,
    'lib/admin/reads.js': 1,
    'lib/auth/welcomeEmail.js': 1,
  };
  for (const [file, n] of Object.entries(must)) {
    const hits = (src(file).match(/\bis_probe\b/g) ?? []).length;
    assert.ok(hits >= n, `${file} names is_probe ${hits}x, wants ${n}`);
  }
});

test('source: the Pulse stats script excludes the probe in every query that reads users_v', () => {
  const lines = src('docs/crew/sportsvyn-stats').split('\n').filter((l) => /^q \w+ "/.test(l) && l.includes('crew_stats.users_v'));
  assert.ok(lines.length >= 10);
  for (const l of lines) assert.match(l, /is_probe/, l.slice(0, 40));
  assert.match(src('migrations/150_users_is_probe.sql'), /crew_stats\.users_v[\s\S]*is_probe/);
});
