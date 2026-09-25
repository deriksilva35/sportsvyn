// lib/mlb/bdlLive.test.mjs - the live baseball state from BDL alone: the count
// against statsapi's on a whole real game, the newest plate appearance, the
// non-outcome result, the batting orders, and the cached names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { countNow, liveFromPlateAppearances, isOutcome, lineupsFromRows, playerNames, _resetNameCache, OUTCOMES } from './bdlLive.js';

const FIX = JSON.parse(readFileSync(new URL('./fixtures/count-parity-5060187.json', import.meta.url), 'utf8'));

test('THE COUNT, against statsapi on every pitch of CHC @ BOS: right or empty, never wrong', () => {
  let n = 0, right = 0, empty = 0; const wrong = [];
  for (const c of FIX.cases) {
    c.pitches.forEach((_, i) => {
      n += 1;
      const got = countNow(c.pitches.slice(0, i + 1));
      const [b, s] = c.statsapiAfter[i];
      if (got == null) { empty += 1; return; }
      if (got.balls === b && got.strikes === s) right += 1; else wrong.push(`pa ${c.pa} pitch ${i + 1}`);
    });
  }
  assert.equal(FIX.cases.length, 74); assert.equal(n, 289);
  assert.deepEqual(wrong, [], 'an empty count beats a wrong one - and there are no wrong ones');
  assert.equal(right, 216); assert.equal(empty, 73, 'the pitch that ends an at-bat has no count after it');
});

test('the count rules: a ball, a strike, a two-strike foul, a foul bunt, and a call it does not know', () => {
  const p = (balls, strikes, code) => [{ balls, strikes, pitch_call_code: code }];
  assert.deepEqual(countNow([]), { balls: 0, strikes: 0 });
  assert.deepEqual(countNow(p(2, 1, 'ball')), { balls: 3, strikes: 1 });
  assert.equal(countNow(p(3, 1, 'ball')), null, 'ball four ends it');
  assert.deepEqual(countNow(p(1, 2, 'foul')), { balls: 1, strikes: 2 }, 'a two-strike foul keeps two');
  assert.equal(countNow(p(1, 2, 'foul_tip')), null, 'a two-strike foul tip is strike three');
  assert.equal(countNow(p(1, 2, 'foul_bunt')), null, 'a two-strike foul bunt is strike three');
  assert.equal(countNow(p(0, 0, 'hit_into_play')), null);
  assert.equal(countNow(p(0, 0, 'automatic_ball_maybe')), null, 'an unknown call is no count, not a guess');
});

test('THE NEWEST PLATE APPEARANCE WINS, and a non-outcome result is still an at-bat in progress', () => {
  const pa = (n, result, extra = {}) => ({ pa_number: n, inning: 6, half_inning: 'bottom', outs: 1, runner_on_first: false,
    runner_on_second: true, runner_on_third: false, batter_id: 7, pitcher_id: 8, result, pitches: [], ...extra });
  const s = liveFromPlateAppearances([pa(12, 'Single'), pa(13, 'Batter Timeout', { pitches: [{ balls: 0, strikes: 0, pitch_call_code: 'called_strike' }] })]);
  assert.equal(s.paNumber, 13); assert.equal(s.inProgress, true, '"Batter Timeout" is not how an at-bat ends');
  assert.deepEqual([s.period, s.half, s.outs, s.balls, s.strikes], [6, 'Bottom', 1, 0, 1]);
  assert.deepEqual(s.bases, { first: false, second: true, third: false });
  const done = liveFromPlateAppearances([pa(13, 'Groundout')]);
  assert.equal(done.inProgress, false); assert.equal(done.balls, null, 'a finished at-bat shows no count');
  assert.equal(liveFromPlateAppearances([]), null);
  assert.equal(isOutcome('Strikeout'), true); assert.equal(isOutcome('Batter Timeout'), false); assert.equal(isOutcome(null), false);
  assert.ok(OUTCOMES.size >= 28, 'every result seen on 1,858 finished plate appearances');
});

test('the batting orders: batting_order is the order, starters are not batters, an unposted side is null', () => {
  const r = (abbr, id, order, pos = 'CF') => ({ team: { abbreviation: abbr }, player: { id, full_name: `P${id}` }, batting_order: order, position: pos });
  const rows = [r('TB', 3, 3), r('TB', 1, 1), r('TB', 2, 2), { team: { abbreviation: 'TB' }, player: { id: 9, full_name: 'SP' }, is_probable_pitcher: true, batting_order: null }];
  assert.deepEqual(lineupsFromRows(rows, { awayAbbr: 'TB', homeAbbr: 'NYY' }), { away: [
    { id: '1', name: 'P1', position: 'CF', order: 1 }, { id: '2', name: 'P2', position: 'CF', order: 2 }, { id: '3', name: 'P3', position: 'CF', order: 3 },
  ], home: null });
  assert.equal(lineupsFromRows([], { awayAbbr: 'TB', homeAbbr: 'NYY' }), null);
});

test('names are looked up once per player and cached', async () => {
  _resetNameCache();
  const calls = [];
  const fetchImpl = async (url) => { calls.push(String(url)); return { ok: true, json: async () => ({ data: [{ id: 1, full_name: 'One' }, { id: 2, first_name: 'Tw', last_name: 'O' }] }) }; };
  const a = await playerNames([1, 2, 2], { key: 'k', fetchImpl });
  assert.equal(a.names.get('1'), 'One'); assert.equal(a.names.get('2'), 'Tw O'); assert.equal(a.calls, 1);
  const b = await playerNames([2, 1], { key: 'k', fetchImpl });
  assert.equal(b.calls, 0); assert.equal(calls.length, 1);
});
