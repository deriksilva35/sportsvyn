// app/api/email/unsubscribe/unsubscribe.test.mjs - both doors of the opt-out,
// called as the route handlers they are (wed-2).
//
// WHY BEHAVIOUR AND NOT A SOURCE MATCH. Every mail we send carries
// `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, which tells Gmail and
// Apple Mail to POST to the link. The route had only GET, so each native
// Unsubscribe button got a 405 and nobody was taken off - and every source
// test passed, because the header and the GET were both present. This test
// POSTs the way a mail client does and reads the row.
//
// One DEV user on the reserved test domain (scripts/dev-orphan-sweep.mjs
// lists @example.invalid), created in before() and deleted in after().
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { install } from '../../../../lib/testing/nextResolve.mjs';

install();
process.env.EMAIL_LINK_SECRET ||= 'test-only-email-link-secret-0123456789abcdef';
const { sql } = await import('../../../../lib/db.js');
const { unsubscribeToken } = await import('../../../../lib/email/linkSecret.js');
const { GET, POST } = await import('./route.js');

const EMAIL = `unsub-route-${process.pid}@example.invalid`;
let uid;
before(async () => {
  [{ id: uid }] = await sql`INSERT INTO users (name, email) VALUES ('unsub route test', ${EMAIL}) RETURNING id`;
});
after(async () => {
  await sql`DELETE FROM users WHERE id = ${uid} AND email = ${EMAIL}`;
  const left = await sql`SELECT 1 FROM users WHERE email = ${EMAIL}`;
  assert.equal(left.length, 0, 'teardown removed its user');
});

const url = (u, t) => `https://sportsvyn.com/api/email/unsubscribe?u=${encodeURIComponent(u)}&t=${t}`;
const optedOut = async () => (await sql`SELECT email_opted_out_at FROM users WHERE id = ${uid}`)[0].email_opted_out_at;
const oneClick = (u, t) => new Request(url(u, t), {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: 'List-Unsubscribe=One-Click',
});

test('POST (RFC 8058 one-click): a bad signature is refused and writes nothing', async () => {
  const res = await POST(oneClick(uid, 'f'.repeat(32)));
  assert.equal(res.status, 400);
  assert.equal(await optedOut(), null);
  assert.equal((await POST(new Request(url(uid, '').replace(/&t=$/, ''), { method: 'POST' }))).status, 400, 'no token');
});

test('POST (RFC 8058 one-click): the signed link opts out, 200, and a repeat keeps the first time', async () => {
  const res = await POST(oneClick(uid, unsubscribeToken(uid)));
  assert.equal(res.status, 200);
  const first = await optedOut();
  assert.ok(first, 'email_opted_out_at set');
  const again = await POST(oneClick(uid, unsubscribeToken(uid)));
  assert.equal(again.status, 200);
  assert.equal((await optedOut()).getTime(), first.getTime(), 'idempotent');
});

test('GET (the browser link) still works: same signed link, the confirmation page', async () => {
  await sql`UPDATE users SET email_opted_out_at = NULL WHERE id = ${uid}`;
  const bad = await GET(new Request(url(uid, '0'.repeat(32))));
  assert.match(await bad.text(), /Link not recognised/);
  assert.equal(await optedOut(), null);
  const ok = await GET(new Request(url(uid, unsubscribeToken(uid))));
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /You are unsubscribed/);
  assert.ok(await optedOut());
});
