// lib/push/mlbScoreCompose.test.mjs - the MLB score push, composed end to end.
//
// 17:24 PT, 24 Sep: "TB 3, NYY 0 · TB extra point". The poller called onScore()
// and scoreKindLabel() with no sport, both default to football, and a one-run
// single became a kick. These tests walk the composition the poller now runs
// - composeScorePush() -> pushPayload() - with a real MLB match, so the title
// asserted here is the title a phone receives.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { composeScorePush } from './scoreCompose.js';
import { pushPayload } from './payload.js';

const MATCH = {
  id: 40188, leagueSlug: 'mlb', slug: 'mlb-2026-09-24-tb-nyy',
  homeAbbr: 'NYY', awayAbbr: 'TB',
};
const FOOTBALL_WORDS = /touchdown|field goal|extra point|safety|two-point|kickoff/i;
const live = (away, home, delta) => ({
  homeScore: home, awayScore: away, homeDelta: 0, awayDelta: delta, period: 3, half: 'top',
});

/** The poller's composition for one team's change, then the payload dispatch builds. */
function composed(delta, { away, home, scoringPlay = null, pending = null, leagueSlug = 'mlb' } = {}) {
  const r = composeScorePush(pending, {
    delta, teamAbbr: 'TB', leagueSlug, state: live(away, home, delta), scoringPlay, now: 1_000,
  });
  return { ...r, payloads: r.sends.map((st) => pushPayload('score', { ...MATCH, leagueSlug, ...st, matchId: MATCH.id })) };
}

test('A LIVE MLB 1-RUN CHANGE READS "TB 3, NYY 0 · TB scores" - never a football word', () => {
  const { payloads, pending } = composed(1, { away: 3, home: 0, scoringPlay: 'Caminero singled to center, Díaz scored.' });
  assert.equal(pending, null, 'nothing held');
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].title, 'TB 3, NYY 0 · TB scores');
  assert.doesNotMatch(payloads[0].title, FOOTBALL_WORDS);
  assert.doesNotMatch(payloads[0].body ?? '', FOOTBALL_WORDS);
});

test('"HOMERS" ONLY WHEN THE SCORING PLAY SAYS SO', () => {
  const hr = composed(1, { away: 3, home: 0, scoringPlay: 'Lowe homered to right (402 feet).' });
  assert.equal(hr.payloads[0].title, 'TB 3, NYY 0 · TB homers');
  // No play text, or a play that is not a home run: the delta's word.
  assert.equal(composed(1, { away: 3, home: 0 }).payloads[0].title, 'TB 3, NYY 0 · TB scores');
  assert.equal(composed(2, { away: 3, home: 0, scoringPlay: 'Díaz doubled, Lowe scored and Caminero scored.' }).payloads[0].title,
    'TB 3, NYY 0 · TB 2 runs');
});

test('A 6-RUN CHANGE IS NEVER HELD - it goes out now, counted as runs', () => {
  const { pending, payloads } = composed(6, { away: 6, home: 0 });
  assert.equal(pending, null, 'no hold opened');
  assert.equal(payloads.length, 1, 'sent on the same poll');
  assert.equal(payloads[0].title, 'TB 6, NYY 0 · TB 6 runs');
  // And every other delta a big inning can post, the same.
  for (const d of [1, 2, 3, 6, 7, 8]) {
    const r = composed(d, { away: d, home: 0 });
    assert.equal(r.pending, null, `delta ${d} held`);
    assert.doesNotMatch(r.payloads[0].title, FOOTBALL_WORDS, `delta ${d}`);
  }
});

test('A FOOTBALL PLAY OBJECT NEVER NAMES A BASEBALL KIND', () => {
  // "safety squeeze" is a baseball sentence; a football parse of it must not
  // reach an MLB push even if a caller hands one in.
  const r = composeScorePush(null, {
    delta: 1, teamAbbr: 'TB', leagueSlug: 'mlb', state: live(1, 0, 1),
    play: { kind: 'safety', scorer: null, credit: null }, now: 1_000,
  });
  assert.equal(r.sends[0].scoreKind, 'TB scores');
});

test('FOOTBALL IS UNCHANGED: the six still holds for its try', () => {
  const r = composeScorePush(null, {
    delta: 6, teamAbbr: 'KC', leagueSlug: 'nfl',
    state: { homeScore: 6, awayScore: 0, homeDelta: 6, awayDelta: 0 }, now: 1_000,
  });
  assert.ok(r.pending, 'a bare NFL six holds');
  assert.equal(r.sends.length, 0);
  const fg = composeScorePush(null, {
    delta: 3, teamAbbr: 'KC', leagueSlug: 'nfl', state: { homeScore: 3, awayScore: 0, homeDelta: 3, awayDelta: 0 }, now: 1_000,
  });
  assert.equal(fg.sends[0].scoreKind, 'KC field goal');
});

test('THE POLLER SENDS THROUGH composeScorePush, with the league', () => {
  const src = readFileSync(new URL('../../services/live-poller/poll.mjs', import.meta.url), 'utf8');
  assert.match(src, /composeScorePush\(pendingScore\.get\(key\) \?\? null, \{\s*delta, teamAbbr, leagueSlug: m\.league_slug,/);
  // No bare call that would default the sport to football.
  assert.doesNotMatch(src, /\bonScore\(/);
  assert.doesNotMatch(src, /scoreKindLabel\(/);
});
