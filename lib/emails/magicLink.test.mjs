// Code-only sign-in email: assert the email carries the code as the hero and
// contains NO sign-in link / callback URL / raw token (pure; no DB/env).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMagicLinkEmail } from './magicLink.js';

// The `url` Auth.js hands us still carries the raw token — the email must NOT
// leak any of it now that redemption is code-only.
const url = 'https://sportsvyn.com/api/auth/callback/resend?token=SECRETRAWTOKEN123&email=a%40b.com&callbackUrl=%2Fsim';

test('email shows the code as the hero', () => {
  const { html, text, subject } = buildMagicLinkEmail({ url, identifier: 'a@b.com', code: '482913' });
  assert.ok(html.includes('482913'), 'code in html');
  assert.ok(text.includes('482913'), 'code in text');
  assert.match(subject, /code/i);
});

test('email contains NO sign-in URL, callback path, or raw token', () => {
  const { html, text } = buildMagicLinkEmail({ url, identifier: 'a@b.com', code: '000111' });
  for (const body of [html, text]) {
    assert.ok(!body.includes(url), 'no callback url');
    assert.ok(!body.includes('SECRETRAWTOKEN123'), 'no raw token');
    assert.ok(!/\/api\/auth\/callback/.test(body), 'no auth callback path');
    assert.ok(!/token=/.test(body), 'no token query param');
  }
});

test('email HTML has no clickable anchor (link path removed)', () => {
  const { html } = buildMagicLinkEmail({ url, identifier: 'a@b.com', code: '246810' });
  assert.ok(!/<a\s[^>]*href=/i.test(html), 'no <a href> anchors');
});
