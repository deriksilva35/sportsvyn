// lib/onboardingDb.test.mjs - the broadcast recipient query, against the schema.
//
// THE ONE THING THAT MUST NOT REGRESS: the broadcast must reach the address a
// person TYPED, not the Apple relay alias they signed up with - and must still
// honour an opt-out and the owner exclusions when it does.

import { test, before, after } from 'node:test';
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
})(path.resolve(__dirname, '..', '.env.local'));

const { sql } = await import('./db.js');

const OWNER = ['deriksilva@gmail.com', 'derik@safetymanagers.com', 'derik@sportsvyn.com',
  'deriksilva+welcome@gmail.com', 'deriksilva+welcome2@gmail.com'];
const MARK = '%@onbtest.invalid';
const ids = {};

const mk = async (key, email, contact = null, optedOut = false) => {
  const r = await sql`
    INSERT INTO users (email, contact_email, contact_email_at, email_opted_out_at)
    VALUES (${email}, ${contact}, ${contact ? new Date().toISOString() : null},
            ${optedOut ? new Date().toISOString() : null})
    RETURNING id`;
  ids[key] = r[0].id;
  return r[0].id;
};

before(async () => {
  await mk('relayOnly', 'aaa@privaterelay.appleid.com');
  await mk('relayPlusContact', 'bbb@privaterelay.appleid.com', 'real@onbtest.invalid');
  await mk('realOnly', 'plain@onbtest.invalid');
  await mk('optedOut', 'quiet@onbtest.invalid', 'also@onbtest.invalid', true);
});

after(async () => {
  await sql`DELETE FROM users WHERE id = ANY(${Object.values(ids)})`;
});

/** The exact query scripts/broadcast.mjs runs. */
const recipients = () => sql`
  SELECT id, COALESCE(contact_email, email) AS email
    FROM users
   WHERE COALESCE(contact_email, email) IS NOT NULL
     AND email_opted_out_at IS NULL
     AND NOT (email = ANY(${OWNER}))
     AND NOT (COALESCE(contact_email, '') = ANY(${OWNER}))
   ORDER BY id`;

test('THE CONTACT ADDRESS IS PREFERRED over the relay alias', async () => {
  const rows = await recipients();
  const got = rows.find((r) => r.id === ids.relayPlusContact);
  assert.ok(got, 'the user must be a recipient');
  assert.equal(got.email, 'real@onbtest.invalid', 'must reach the typed address');
  assert.equal(/privaterelay/.test(got.email), false, 'never the alias when a contact exists');
});

test('a relay address with NO contact is still reached - we do not drop them', async () => {
  // Thirty of the current recipients are relay-only. Excluding them because the
  // address is an alias would silently halve the list.
  const rows = await recipients();
  const got = rows.find((r) => r.id === ids.relayOnly);
  assert.ok(got);
  assert.equal(got.email, 'aaa@privaterelay.appleid.com');
});

test('a plain address with no contact is unchanged', async () => {
  const rows = await recipients();
  assert.equal(rows.find((r) => r.id === ids.realOnly).email, 'plain@onbtest.invalid');
});

test('SUPPRESSION KEYS ON THE USER, so it survives a changed address', async () => {
  const rows = await recipients();
  assert.equal(rows.some((r) => r.id === ids.optedOut), false,
    'an opt-out is a decision about a person, not an address');
});

test('the owner exclusion catches EITHER column', async () => {
  // Derik's accounts must be excluded whichever address they would be reached
  // at - supplying a contact address must not smuggle one back onto the list.
  const id = await mk('ownerViaContact', 'someone@onbtest.invalid', 'derik@sportsvyn.com');
  const rows = await recipients();
  assert.equal(rows.some((r) => r.id === id), false, 'excluded via contact_email');
  await sql`DELETE FROM users WHERE id = ${id}`;
});

test('the columns migration 069 adds are all present', async () => {
  const cols = (await sql`
    SELECT column_name FROM information_schema.columns
     WHERE table_name = 'users'
       AND column_name IN ('contact_email','contact_email_at','onboarded_at')`).map((r) => r.column_name);
  assert.deepEqual(cols.sort(), ['contact_email', 'contact_email_at', 'onboarded_at']);
});

test('contact_email is NOT unique - a shared household inbox must not fail signup', async () => {
  const a = await mk('dupA', 'one@onbtest.invalid', 'shared@onbtest.invalid');
  const b = await mk('dupB', 'two@onbtest.invalid', 'shared@onbtest.invalid');
  assert.ok(a && b, 'two accounts may name the same contact address');
  await sql`DELETE FROM users WHERE id = ANY(${[a, b]})`;
});
