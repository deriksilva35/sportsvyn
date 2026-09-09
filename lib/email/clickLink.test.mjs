// lib/email/clickLink.test.mjs - two eyes: the signed click link and the
// broadcast's href rewrite. Pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rewriteHrefs, emailMeta, htmlToText } from './broadcastRules.js';
import { clickToken, clickUrlFor } from '../auth/welcomeEmail.js';
import { readFileSync } from 'node:fs';

const C = 'ae8602ffad2c741203229dc90dfb46d0df175820951876fcd32d3424fb8d3fd0';

test('a click URL carries campaign, user, destination and a signature over all three', () => {
  const u = clickUrlFor({ campaign: C, userId: 4, to: '/weekly', base: 'https://sportsvyn.com' });
  const q = new URL(u).searchParams;
  assert.equal(new URL(u).pathname, '/api/email/click');
  assert.equal(q.get('c'), C); assert.equal(q.get('u'), '4'); assert.equal(q.get('to'), '/weekly');
  assert.equal(q.get('t'), clickToken({ campaign: C, userId: 4, to: '/weekly' }));
  assert.equal(q.get('t').length, 32);
});

test('the signature binds every part: change the user, the campaign or the destination and it no longer verifies', () => {
  const t = clickToken({ campaign: C, userId: 4, to: '/weekly' });
  assert.notEqual(t, clickToken({ campaign: C, userId: 5, to: '/weekly' }));
  assert.notEqual(t, clickToken({ campaign: 'other', userId: 4, to: '/weekly' }));
  assert.notEqual(t, clickToken({ campaign: C, userId: 4, to: '/draft' }));
});

test('rewriteHrefs turns every site href into a click URL and leaves the rest alone', () => {
  const html = '<a href="/weekly">a</a> <a href="https://sportsvyn.com/draft">b</a> <a href="https://www.sportsvyn.com/pickem/nfl?x=1&amp;y=2">c</a> '
    + '<a href="{{unsubscribe_url}}">u</a> <a href="mailto:hello@sportsvyn.com">m</a> <a href="https://example.com/">x</a> <a href="//evil.com/">p</a>';
  const seen = [];
  const r = rewriteHrefs(html, (to) => { seen.push(to); return `https://sportsvyn.com/api/email/click?c=x&to=${encodeURIComponent(to)}`; }, { skip: ['{{unsubscribe_url}}'] });
  assert.equal(r.siteHrefs, 3); assert.equal(r.rewrittenCount, 3);
  assert.deepEqual(seen, ['/weekly', 'https://sportsvyn.com/draft', 'https://www.sportsvyn.com/pickem/nfl?x=1&y=2']);
  assert.match(r.html, /href="\{\{unsubscribe_url\}\}"/, 'the unsubscribe placeholder is untouched');
  assert.match(r.html, /href="mailto:hello@sportsvyn\.com"/); assert.match(r.html, /href="https:\/\/example\.com\/"/); assert.match(r.html, /href="\/\/evil\.com\/"/);
  assert.equal((r.html.match(/api\/email\/click/g) ?? []).length, 3);
  assert.match(r.html, /click\?c=x&amp;to=%2Fweekly"/, 'ampersands inside the rewritten href are entity-escaped');
  assert.doesNotMatch(r.html, /click\?c=x&to=/, 'no raw ampersand survives in an href');
});

test('emailMeta reads the subject from <title> and the preheader from the hidden block', () => {
  const html = readFileSync(new URL('../../docs/email/kickoff-sep9.html', import.meta.url), 'utf8');
  assert.deepEqual(emailMeta(html), { subject: 'Kickoff tonight. Your board locks at 8:20 ET.', preheader: 'Kickoff tonight. Your board locks at 8:20 ET.' });
  const launch = readFileSync(new URL('../../docs/email/launch-email-sep8.html', import.meta.url), 'utf8');
  assert.equal(emailMeta(launch).subject, 'You came for the mock draft. Now it counts.');
  assert.equal(emailMeta(launch).preheader, 'Four ranked games, all free. The Weekly locks at first kickoff Wednesday night.');
});

test('the kickoff scaffold: four links, no images, and a [[COPY marker the script refuses', () => {
  const html = readFileSync(new URL('../../docs/email/kickoff-sep9.html', import.meta.url), 'utf8');
  const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, ['/weekly', '/draft', '/pickem/nfl', '/daily/board/2026-09-08', '{{unsubscribe_url}}']);
  assert.equal(html.includes('<img'), false, 'no images');
  assert.ok(html.includes('[[COPY'), 'the copy is not in yet - the marker is what stops a send');
  const text = htmlToText(html);
  assert.match(text, /The Weekly \(\/weekly\)/); assert.doesNotMatch(text, /<[a-z]/);
});
