import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { emailLinkSecret, unsubscribeToken, clickToken, verifyUnsubscribe, verifyClick } from './linkSecret.js';

const saved = process.env.EMAIL_LINK_SECRET;
beforeEach(() => { process.env.EMAIL_LINK_SECRET = 'a'.repeat(64); });
afterEach(() => { if (saved == null) delete process.env.EMAIL_LINK_SECRET; else process.env.EMAIL_LINK_SECRET = saved; });

test('with the secret set, a signed link verifies and a tampered one does not', () => {
  const t = unsubscribeToken(7); assert.equal(t.length, 32);
  assert.equal(verifyUnsubscribe(7, t), true); assert.equal(verifyUnsubscribe(8, t), false); assert.equal(verifyUnsubscribe(7, t.slice(0, 31) + '0'), false);
  const c = clickToken({ campaign: 'abc', userId: 7, to: '/weekly' });
  assert.equal(verifyClick({ campaign: 'abc', userId: 7, to: '/weekly' }, c), true);
  assert.equal(verifyClick({ campaign: 'abc', userId: 7, to: '/draft' }, c), false);
  assert.equal(verifyClick({ campaign: 'abc', userId: 7, to: '' }, c), false, 'no destination, no verification');
});

test('a different secret signs differently - the droplet and Vercel must hold the same value', () => {
  const t1 = unsubscribeToken(7); process.env.EMAIL_LINK_SECRET = 'b'.repeat(64);
  assert.notEqual(unsubscribeToken(7), t1); assert.equal(verifyUnsubscribe(7, t1), false);
});

test('without the secret there is NO fallback: signing throws, verifying is false, and the app secret is not consulted', () => {
  const t = unsubscribeToken(7);
  delete process.env.EMAIL_LINK_SECRET; process.env.NEXTAUTH_SECRET = 'x'.repeat(64); process.env.AUTH_SECRET = 'y'.repeat(64);
  assert.equal(emailLinkSecret(), null);
  assert.throws(() => unsubscribeToken(7), /EMAIL_LINK_SECRET is not set/);
  assert.throws(() => clickToken({ campaign: 'abc', userId: 7, to: '/weekly' }), /EMAIL_LINK_SECRET is not set/);
  assert.equal(verifyUnsubscribe(7, t), false);
  assert.equal(verifyClick({ campaign: 'abc', userId: 7, to: '/weekly' }, t), false);
  process.env.EMAIL_LINK_SECRET = 'short'; assert.equal(emailLinkSecret(), null, 'a short value is treated as unset');
});
