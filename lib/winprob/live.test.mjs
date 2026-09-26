// lib/winprob/live.test.mjs - the pure parts of the live path: the feed's
// clock into the model's, the snap into a state, a stored spread into points,
// and the card's fresh / stale / gone rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { install } from '../testing/nextResolve.mjs';

install();
const { timeState, clockSecs, modelState, spreadPoints, DISPLAYED, newestSnap, playsBehindScore, winProbTick, logWinProb } = await import('./live.js');
const { liveWinProbView, STALE_SEC, DEAD_SEC } = await import('../../components/gridiron/LiveWinProb.js');

test('the clock: regulation seconds left, seconds left in the half, overtime', () => {
  assert.equal(clockSecs('8:41'), 521); assert.equal(clockSecs('15:00'), 900); assert.equal(clockSecs('x'), null);
  assert.deepEqual(timeState(1, '15:00'), { secs_game: 3600, secs_half: 1800, is_ot: 0 });
  assert.deepEqual(timeState(2, '0:30'), { secs_game: 1830, secs_half: 30, is_ot: 0 });
  assert.deepEqual(timeState(3, '8:41'), { secs_game: 1421, secs_half: 1421, is_ot: 0 });
  assert.deepEqual(timeState(4, '2:00'), { secs_game: 120, secs_half: 120, is_ot: 0 });
  assert.deepEqual(timeState(5, '7:12'), { secs_game: 0, secs_half: 432, is_ot: 1 });
  assert.equal(timeState(null, '8:41'), null); assert.equal(timeState(3, null), null);
});

test('the state: the newest play, the live score, whose ball - or null when the clock, score or play is missing', () => {
  const play = { down: 3, distance: 4, yards_to_goal: 22, offense_team_id: 9 };
  const s = modelState({ period: 4, clock: '1:10', homeScore: 20, awayScore: 24, play, homeTeamId: 9, season: 2026 });
  assert.deepEqual(s, { score_diff: -4, secs_game: 70, secs_half: 70, is_ot: 0, posteam_is_home: 1, down_f: 3, ydstogo_f: 4, yards_to_goal: 22, season: 2026 });
  assert.equal(modelState({ period: 4, clock: '1:10', homeScore: 20, awayScore: 24, play, homeTeamId: 8 }).posteam_is_home, 0);
  assert.equal(modelState({ period: 4, clock: '1:10', homeScore: 20, awayScore: 24, play: { ...play, offense_team_id: null }, homeTeamId: 9 }), null, 'no offense, no possession');
  assert.equal(modelState({ period: 4, clock: '1:10', homeScore: null, awayScore: 24, play, homeTeamId: 9 }), null);
  assert.equal(modelState({ period: 4, clock: '1:10', homeScore: 20, awayScore: 24, play: null, homeTeamId: 9 }), null);
});

test('a stored spread into points: signs, pick\'em, and nothing that is not one', () => {
  assert.equal(spreadPoints('-3.5'), -3.5); assert.equal(spreadPoints('+2'), 2); assert.equal(spreadPoints('PK'), 0);
  assert.equal(spreadPoints(''), null); assert.equal(spreadPoints(null), null); assert.equal(spreadPoints('off'), null);
});

test('only NFL is displayed; CFB is shadow', () => {
  assert.deepEqual(DISPLAYED, { nfl: true, cfb: false });
});

test('the card: fresh, stale past 90 s, gone past 5 minutes, and nothing without a real number', () => {
  const now = new Date('2026-09-27T18:00:00Z');
  const at = (sec) => new Date(now.getTime() - sec * 1000).toISOString();
  assert.equal(STALE_SEC, 90); assert.equal(DEAD_SEC, 300);
  assert.deepEqual(liveWinProbView({ win_prob: 64, win_prob_at: at(10) }, now), { home: 64, away: 36, stale: false });
  assert.deepEqual(liveWinProbView({ win_prob: 64, win_prob_at: at(91) }, now), { home: 64, away: 36, stale: true });
  assert.equal(liveWinProbView({ win_prob: 64, win_prob_at: at(301) }, now), null);
  assert.equal(liveWinProbView({ win_prob: 64 }, now), null, 'no stamp, no card');
  assert.equal(liveWinProbView({ win_prob: null, win_prob_at: at(1) }, now), null);
  assert.equal(liveWinProbView({ win_prob: 150, win_prob_at: at(1) }, now), null);
  assert.equal(liveWinProbView(null, now), null);
});

test('A KICKOFF OR A PAT IS FILLED AS TRAINING FILLED IT, not carried from the last snap', () => {
  // The kickoff after a score: no down, no distance, no spot on the row.
  const kickoff = { down: null, distance: null, yards_to_goal: null, offense_team_id: 9 };
  const k = modelState({ period: 2, clock: '4:12', homeScore: 14, awayScore: 7, play: kickoff, homeTeamId: 9, season: 2026 });
  assert.equal(k.down_f, 1, 'down fillna(1)'); assert.equal(k.ydstogo_f, 10, 'distance fillna(10)'); assert.equal(k.yards_to_goal, 50, 'spot fillna(50)');
  // A PAT: the feed gives a spot at the 2 and nothing else.
  const pat = modelState({ period: 2, clock: '4:15', homeScore: 13, awayScore: 7, play: { down: null, distance: null, yards_to_goal: 2, offense_team_id: 9 }, homeTeamId: 9 });
  assert.deepEqual([pat.down_f, pat.ydstogo_f, pat.yards_to_goal], [1, 10, 2]);
  // and the clips: a 5th down, 40 to go and a spot at 0 are pulled into range.
  const odd = modelState({ period: 1, clock: '10:00', homeScore: 0, awayScore: 0, play: { down: 5, distance: 40, yards_to_goal: 0, offense_team_id: 8 }, homeTeamId: 9 });
  assert.deepEqual([odd.down_f, odd.ydstogo_f, odd.yards_to_goal, odd.posteam_is_home], [4, 30, 1, 0]);
});

test('newestSnap PASSES OVER A CFB TIMEOUT: it carries an offense and a spot at the 3 (26 Sep audit)', async () => {
  const rows = [
    { id: 3, play_type: 'Timeout', down: 0, distance: 3, yards_to_goal: 3, offense_team_id: 9 },
    { id: 2, play_type: 'End Period', down: 1, distance: 10, yards_to_goal: 75, offense_team_id: 9 },
    { id: 1, play_type: 'Rush', down: 2, distance: 6, yards_to_goal: 40, offense_team_id: 9 },
  ];
  assert.equal((await newestSnap(() => Promise.resolve(rows), 1)).id, 1, 'the rush, not the timeout or the period end');
  assert.equal(await newestSnap(() => Promise.resolve([rows[0]]), 1), null, 'nothing but stoppages: no snap');
  assert.equal((await newestSnap(() => Promise.resolve([{ id: 5, play_type: 'official-timeout', offense_team_id: 9 }, { id: 4, play_type: 'pass', offense_team_id: 9 }]), 1)).id, 4);
});

test('THE PLAYS BEHIND THE SCORE: the tick HOLDS - nothing computed, nothing logged (ruling, 26 Sep)', async () => {
  const snap = { id: 7, play_type: 'Rush', down: 1, distance: 1, yards_to_goal: 1, offense_team_id: 9, home_score: 14, away_score: 7 };
  assert.equal(playsBehindScore(snap, 14, 7), false);
  assert.equal(playsBehindScore(snap, 20, 7), true, 'the touchdown is on the scoreboard, not yet in the plays');
  assert.equal(playsBehindScore({ ...snap, home_score: null }, 20, 7), false, 'unknown: nothing to say');
  assert.equal(playsBehindScore(null, 20, 7), false);

  const m = { id: 1, league_slug: 'nfl', home_team_id: 9, season_year: 2026, market_prior: { spread: -3, n_books: 8 } };
  const sql = () => Promise.resolve([snap]);
  const liveState = { period: 2, clock: '5:00' };
  const held = await winProbTick(sql, m, { liveState, homeScore: 20, awayScore: 7 });
  assert.equal(held.hold, true); assert.equal(held.p, null); assert.equal(held.display, null);
  const live = await winProbTick(sql, m, { liveState, homeScore: 14, awayScore: 7 });
  assert.ok(live.p > 0 && live.p < 1); assert.equal(live.hold, undefined);
  let wrote = 0;
  assert.equal(await logWinProb(() => { wrote += 1; return Promise.resolve([]); }, 1, held), false);
  assert.equal(wrote, 0, 'a hold issues no statement at all');
});

test('the poller keeps the last value through a hold, with a fresh stamp, so the card does not read Paused', () => {
  const src = readFileSync(new URL('../../services/live-poller/poll.mjs', import.meta.url), 'utf8');
  assert.match(src, /else if \(wp\?\.hold && m\.before_live_state\?\.win_prob != null\) \{\s*upd\.liveState = \{ \.\.\.\(upd\.liveState \?\? \{\}\), win_prob: m\.before_live_state\.win_prob, win_prob_at: new Date\(now\)\.toISOString\(\) \};/);
});

test('STALE renders the caption on its own line, outside the header, and the header stays two spans', async () => {
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { default: LiveWinProb } = await import('../../components/gridiron/LiveWinProb.js');
  const now = new Date('2026-09-27T18:00:00Z');
  const html = (agoSec) => renderToStaticMarkup(React.createElement(LiveWinProb, {
    liveState: { win_prob: 71, win_prob_at: new Date(now.getTime() - agoSec * 1000).toISOString() }, awayAbbr: 'ATL', homeAbbr: 'GB', now,
  }));
  const stale = html(150);
  assert.match(stale, /data-stale="1"/);
  assert.match(stale, /<div class="gi-odds-h gi-wp-h"><span class="lbl">Win Probability · our live read<\/span><span class="gi-wp-cal">Calibrating<\/span><\/div><div class="gi-wp-paused">Paused — feed reconnecting<\/div>/);
  const fresh = html(5);
  assert.doesNotMatch(fresh, /gi-wp-paused/);
  assert.equal(html(301), '', 'past five minutes: nothing');
});
