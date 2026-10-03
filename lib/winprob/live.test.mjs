// lib/winprob/live.test.mjs - the pure parts of the live path: the feed's
// clock into the model's, the snap into a state, a stored spread into points,
// and the card's fresh / stale / gone rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { install } from '../testing/nextResolve.mjs';

install();
const { timeState, clockSecs, modelState, spreadPoints, DISPLAYED, newestSnap, snapClock, playsBehindScore, winProbTick, logWinProb, heldWinProb, HOLD_FRESH_SEC, nflKickerSide, nflTrySpot } = await import('./live.js');
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

// sat-1: CFB is displayed (tagged Calibrating) - lib/winprob/display.js.
test('NFL and CFB are displayed (sat-1; CFB was shadow until then)', () => {
  assert.deepEqual(DISPLAYED, { nfl: true, cfb: true });
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

test('newestSnap READS A CFB TIMEOUT AS TRAINING DID: CFBD /plays carries it, with an offense (parity ruling, 27 Sep)', async () => {
  const rows = [{ id: 3, play_type: 'Timeout', down: 0, distance: 3, yards_to_goal: 3, offense_team_id: 9, home_score: 3, away_score: 7 }];
  assert.equal((await newestSnap(() => Promise.resolve(rows), 1)).id, 3, 'the timeout row is the snap - no correction ahead of a retrain');
  assert.equal(await newestSnap(() => Promise.resolve([]), 1), null);
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

test('THE HOLD IS FRESH FOR 180 s, THEN LEFT TO AGE: at 170 s the stamp is refreshed, at 190 s it is not (ruling, 26 Sep)', () => {
  assert.equal(HOLD_FRESH_SEC, 180);
  const t0 = Date.parse('2026-09-26T20:00:00Z');
  const iso = (s) => new Date(t0 + s * 1000).toISOString();
  // the hold begins: the value is kept, the stamp refreshed, the start marked
  const start = heldWinProb({ win_prob: 62, win_prob_at: iso(-20) }, new Date(t0));
  assert.deepEqual(start, { win_prob: 62, win_prob_at: iso(0), win_prob_hold_since: iso(0) });
  const at170 = heldWinProb({ ...start, win_prob_at: iso(160) }, new Date(t0 + 170_000));
  assert.equal(at170.win_prob_at, iso(170), '170 s into the hold: fresh');
  const at190 = heldWinProb({ ...start, win_prob_at: iso(180) }, new Date(t0 + 190_000));
  assert.equal(at190.win_prob_at, iso(180), '190 s into the hold: not refreshed - it will read Paused 90 s after');
  assert.equal(at190.win_prob, 62); assert.equal(at190.win_prob_hold_since, iso(0), 'the start is kept through the hold');
  assert.equal(heldWinProb({ win_prob: null }, new Date(t0)), null, 'nothing to hold');
  assert.equal(heldWinProb(null, new Date(t0)), null);
});

test('the poller writes the held fields through heldWinProb when a tick holds', () => {
  const src = readFileSync(new URL('../../services/live-poller/poll.mjs', import.meta.url), 'utf8');
  assert.match(src, /else if \(wp\?\.hold\) \{\s*const held = heldWinProb\(m\.before_live_state, now\);\s*if \(held\) upd\.liveState = \{ \.\.\.\(upd\.liveState \?\? \{\}\), \.\.\.held \};/);
});

// ROWS AS THEY ARE STORED (ARI @ LAC, 2026 wk1), and what nflverse carries for the same play.
test('NFL KICKOFF AS TRAINING SAW IT: the receiver has the ball, the spot in the receiver frame (331/331 on PROD rows, 26 Sep)', () => {
  const base = { period: 1, clock: '8:49', homeScore: 0, awayScore: 7, homeTeamId: 1, season: 2026, sport: 'nfl', homeAbbr: 'LAC', awayAbbr: 'ARI' };
  // BDL: offense = the kicker (ARI, away), 0 & 0 at 65; nflverse: posteam LAC (receiver), down NA, ydstogo 0, yardline 35
  const k = modelState({ ...base, play: { play_type: 'kickoff', down: 0, distance: 0, yards_to_goal: 65, offense_team_id: 2, text: 'C.Ryland kicks 65 yards from ARZ 35 to LAC 0. K.Mitchell to LAC 20 for 20 yards' } });
  assert.deepEqual([k.posteam_is_home, k.down_f, k.ydstogo_f, k.yards_to_goal], [1, 1, 0, 35]);
  // the opening kickoff: BDL carries NO offense - the text still names the kicker
  const open = modelState({ ...base, homeScore: 0, awayScore: 0, play: { play_type: 'kickoff', down: 0, distance: 0, yards_to_goal: 65, offense_team_id: null, text: 'C.Dicker kicks 60 yards from LAC 35 to ARZ 5.' } });
  assert.equal(open.posteam_is_home, 0, 'ARI receives');
  // and BDL's own codes: BLT, CLV, HST, ARZ, LA, WAS
  assert.equal(nflKickerSide('S.Shrader kicks 61 yards from IND 35 to BLT 4.', 'IND', 'BAL'), 'home');
  assert.equal(nflKickerSide('K.Fairbairn kicks 57 yards from HST 35 to BUF 8.', 'HOU', 'BUF'), 'home');
  assert.equal(nflKickerSide('E.Pineiro kicks 65 yards from SF 35 to LA 0.', 'LAR', 'SF'), 'away');
  // CFB is untouched: our rows ARE CFBD's (6,550/6,550): offense = the kicker, 1 & 10 at 65, as stored
  const cfb = modelState({ ...base, sport: 'cfb', play: { play_type: 'Kickoff', down: 1, distance: 10, yards_to_goal: 65, offense_team_id: 1 } });
  assert.deepEqual([cfb.posteam_is_home, cfb.down_f, cfb.ydstogo_f, cfb.yards_to_goal], [1, 1, 10, 65]);
});

test('NFL TOUCHDOWN AS THE TRY ROW TRAINING HAD: scorer ball, 1st & 0 at the 15 - BDL folds the try into the TD row (165 joined, 26 Sep)', () => {
  const base = { period: 1, clock: '8:49', homeScore: 0, awayScore: 7, homeTeamId: 1, season: 2026, sport: 'nfl', homeAbbr: 'LAC', awayAbbr: 'ARI' };
  const td = modelState({ ...base, play: { play_type: 'rushing-touchdown', down: 2, distance: 5, yards_to_goal: 5, offense_team_id: 2, text: '(Shotgun) J.Love left end for 5 yards, TOUCHDOWN. C.Ryland extra point is GOOD, Center-C.Kreiter, Holder-B.Kern.' } });
  assert.deepEqual([td.posteam_is_home, td.down_f, td.ydstogo_f, td.yards_to_goal, td.score_diff], [0, 1, 0, 15, -7]);
  assert.equal(nflTrySpot('pass to C.Olave for 21 yards, TOUCHDOWN. TWO-POINT CONVERSION ATTEMPT. T.Etienne rushes right end. ATTEMPT SUCCEEDS.', 'NO'), 2);
  assert.equal(nflTrySpot('pass short middle to S.Diggs for 10 yards, TOUCHDOWN.PENALTY on WAS-S.Diggs, Unsportsmanlike Conduct, 15 yards, enforced between downs. D.Stevens extra point is GOOD', 'WSH'), 30, 'the scorer\'s penalty moves the try back');
  assert.equal(nflTrySpot('TOUCHDOWN.PENALTY on DAL-X, Unsportsmanlike Conduct, 15 yards, enforced between downs. extra point is GOOD', 'WSH'), 15, 'the other side\'s is not read');
  // a defensive touchdown: the defence scored, so the defence tries
  const pick6 = modelState({ ...base, play: { play_type: 'interception-return-touchdown', down: 3, distance: 7, yards_to_goal: 60, offense_team_id: 1, text: 'INTERCEPTED ... TOUCHDOWN. extra point is GOOD' } });
  assert.equal(pick6.posteam_is_home, 0);
  // CFB touchdowns pass through: our rows equal CFBD's (303 scoring rows, 100%)
  const cfbTd = modelState({ ...base, sport: 'cfb', play: { play_type: 'Rushing Touchdown', down: 2, distance: 5, yards_to_goal: 5, offense_team_id: 2 } });
  assert.deepEqual([cfbTd.down_f, cfbTd.ydstogo_f, cfbTd.yards_to_goal], [2, 5, 5]);
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
  // sat-1: NFL carries no Calibrating tag - the header is the caption alone.
  assert.match(stale, /<div class="gi-odds-h gi-wp-h"><span class="lbl">Win Probability · our live read<\/span><\/div><div class="gi-wp-paused">Paused — feed reconnecting<\/div>/);
  assert.doesNotMatch(stale, /Calibrating|gi-wp-cal/);
  assert.match(stale, /<div class="gi-odds-fine">Sportsvyn model · market prior \+ game state<\/div>/, 'the method note');
  const fresh = html(5);
  assert.doesNotMatch(fresh, /gi-wp-paused/);
  assert.equal(html(301), '', 'past five minutes: nothing');
});

test('the model reads the SNAP\'s clock, the scoreboard\'s only when the snap has none (relay fri-4 c)', () => {
  const board = { period: 2, clock: '6:14' };
  // PHI@CHI 11198: the interception was snapped at Q2 6:21 while the
  // scoreboard already read 6:14 - training saw the snap's own time.
  assert.deepEqual(snapClock({ period: 2, clock: '6:21' }, board), { period: 2, clock: '6:21', source: 'play' });
  assert.equal(timeState(snapClock({ period: 2, clock: '6:21' }, board).period, snapClock({ period: 2, clock: '6:21' }, board).clock).secs_game, 2181);
  assert.deepEqual(snapClock({ period: 2, clock: null }, board), { period: 2, clock: '6:14', source: 'scoreboard' }, 'no clock on the play');
  assert.deepEqual(snapClock({ period: null, clock: '6:21' }, board), { period: 2, clock: '6:14', source: 'scoreboard' }, 'no period on the play');
  assert.deepEqual(snapClock({ period: 2, clock: 'garbage' }, board), { period: 2, clock: '6:14', source: 'scoreboard' }, 'an unreadable clock');
  assert.deepEqual(snapClock(null, board), { period: 2, clock: '6:14', source: 'scoreboard' });
  assert.deepEqual(snapClock(null, null), { period: null, clock: null, source: 'scoreboard' });
  assert.deepEqual(snapClock({ period: 5, clock: '8:00' }, board), { period: 5, clock: '8:00', source: 'play' }, 'overtime is a clock too');
});
