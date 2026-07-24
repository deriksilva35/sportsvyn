// Dash-scan + shape for the post-tournament homepage copy. Pure, no env.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completedIntro, completedSignpost } from './tournamentCopy.js';

test('completedIntro: references the champion, finished-story register', () => {
  const s = completedIntro('Spain');
  assert.match(s, /Spain are champions/);
  assert.match(s, /finished story/);
});

test('completedSignpost: champion + readable-archive line to the bracket', () => {
  const s = completedSignpost('Spain');
  assert.match(s, /Spain are champions/);
  assert.match(s, /the tournament stays readable/);
});

test('hyphens only (no em/en dashes) for any champion name', () => {
  for (const name of ['Spain', 'Argentina', 'United States']) {
    assert.ok(!/[—–]/.test(completedIntro(name)), 'intro');
    assert.ok(!/[—–]/.test(completedSignpost(name)), 'signpost');
  }
});
