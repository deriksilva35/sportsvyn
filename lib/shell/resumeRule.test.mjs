// lib/shell/resumeRule.test.mjs - where an activation lands, every branch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resumeDecision, STALE_MS } from './resumeRule.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ---------------------------------------------------------------------------
// the threshold, at its exact boundary
// ---------------------------------------------------------------------------

test('under five minutes resumes in place; at five, goes home', () => {
  assert.equal(resumeDecision({ gapMs: STALE_MS - 1, pathname: '/daily' }), null,
    'a Messages flip mid-draft keeps the room');
  assert.equal(resumeDecision({ gapMs: STALE_MS, pathname: '/daily' }), '/games',
    'the boundary itself is stale - >= not >');
  assert.equal(resumeDecision({ gapMs: STALE_MS * 100, pathname: '/sim' }), '/games');
});

test('cold start (no stamp) goes home - the belt to the 307 suspenders', () => {
  assert.equal(resumeDecision({ gapMs: null, pathname: '/sim/history' }), '/games');
  assert.equal(resumeDecision({ pathname: '/daily' }), '/games');
});

test('already home means stand still - a redirect to where you stand is jank', () => {
  assert.equal(resumeDecision({ gapMs: STALE_MS + 1, pathname: '/games' }), null);
  assert.equal(resumeDecision({ gapMs: null, pathname: '/games?pane=history' }), null);
});

// ---------------------------------------------------------------------------
// the shields
// ---------------------------------------------------------------------------

test('a LIVE TRACKER ROOM is never interrupted, at any gap', () => {
  for (const gapMs of [0, STALE_MS, STALE_MS * 12, null]) {
    assert.equal(
      resumeDecision({ gapMs, dataTab: 'tracker', pathname: '/sim/draft/9' }),
      null, `gap ${gapMs}: draft night is sacred`);
  }
  // The mock room has NO shield - its road back is the resume card on /sim.
  assert.equal(
    resumeDecision({ gapMs: STALE_MS, dataTab: 'practice', pathname: '/sim/draft/9' }),
    '/games');
});

test('/signin is exempt - mount-time cold start must not yank a reader mid-OTP', () => {
  assert.equal(resumeDecision({ gapMs: null, pathname: '/signin?callbackUrl=%2Fgames' }), null);
  assert.equal(resumeDecision({ gapMs: STALE_MS * 2, pathname: '/signin' }), null);
});

test('a push-tap deep link wins outright - the reader chose a destination', () => {
  assert.equal(
    resumeDecision({ gapMs: STALE_MS * 10, deepLinkPending: true, pathname: '/sim' }),
    null);
  assert.equal(
    resumeDecision({ gapMs: null, deepLinkPending: true, pathname: '/sim' }),
    null, 'the deep link beats even the cold-start belt');
});

// ---------------------------------------------------------------------------
// wiring - the manager feeds the rule what the rule expects
// ---------------------------------------------------------------------------

test('the manager stamps on background and decides on activation', () => {
  const t = stripComments(src('components/shell/ResumeManager.js'));
  assert.match(t, /sessionStorage\.setItem/, 'the clock lives in sessionStorage');
  assert.ok(!t.includes('localStorage'), 'localStorage survives the process and breaks cold-start');
  assert.match(t, /resumeDecision\(\{/);
  assert.match(t, /getAttribute\('data-tab'\)/, 'the tracker shield reads RoomScope');
  assert.match(t, /isShellClient/, 'the web must never grow this behavior');
});

test('MOUNT is an activation - a reloaded restoration fires no event at all', () => {
  const t = stripComments(src('components/shell/ResumeManager.js'));
  assert.match(t, /evaluate\('mount'\)/, 'the still-lands-on-Mock fix');
  assert.match(t, /window\.addEventListener\('pagehide'/, 'pagehide stamps before every teardown');
});

test('bfcache restoration is handled - pageshow persisted, the WKWebView trap', () => {
  const t = stripComments(src('components/shell/ResumeManager.js'));
  assert.match(t, /pageshow/);
  assert.match(t, /e\.persisted/);
});

test('every evaluation is observable - the debug surface', () => {
  const t = stripComments(src('components/shell/ResumeManager.js'));
  assert.match(t, /data-resume-last/);
  assert.match(t, /debug.*resume|'resume'/, '?debug=resume renders the strip on device');
});

test('both event sources feed one handler - and visibility is unconditional now', () => {
  const t = stripComments(src('components/shell/ResumeManager.js'));
  assert.match(t, /appStateChange/);
  assert.match(t, /visibilitychange/, 'a binary without @capacitor/app still gets the behavior');
  // the double-fire on plugin devices is harmless: evaluate re-stamps, so the
  // second reads a zero gap - pinned by the re-stamp inside evaluate
  assert.match(t, /stamp\(\);/);
});

test('the push-tap listener navigates to the payload url and stands the rule down', () => {
  const t = stripComments(src('components/shell/ResumeManager.js'));
  assert.match(t, /pushNotificationActionPerformed/);
  assert.match(t, /deepLinkPending = true/);
  assert.match(t, /url\.startsWith\('\/'\)/, 'in-app paths only - a payload cannot send readers off-site');
});

test('the manager is mounted in the root layout beside the bar', () => {
  assert.match(stripComments(src('app/layout.js')), /<ResumeManager \/>/);
});
