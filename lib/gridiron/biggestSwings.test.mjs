// lib/gridiron/biggestSwings.test.mjs - BIGGEST SWINGS (relay sat-1): NFL
// finals only, only for games logged after the fri-4 inputs fix, the top three
// moves between consecutive STATE rows with kickoffs and tries left out.
//
// PURE first (selection, exclusions, the consecutive-state rule, signs, ties,
// eligibility), on hand-written rows whose probabilities are exact in binary
// so a tie is a tie. Then DEV: a sentinel copy of PHI@CHI 2026 week 3 (the
// recorded fixture) twice - once as the real pre-fix game with the three rows
// PROD logged for it (no module), once kicked off on 4 Oct with a log the
// shipped model computes after the cutoff (the module, three swings).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { install } from '../testing/nextResolve.mjs';
import { stubPath } from '../testing/stubDir.mjs';
install();

const LINK = stubPath('__link_stub_swings.mjs');
registerHooks({ resolve(spec, ctx, next) {
  if (spec === 'next/link') return { url: pathToFileURL(LINK).href, shortCircuit: true };
  if (/^\.\.?\//.test(spec) && !/\.[a-z]+$/i.test(spec)) {
    try { return next(`${spec}.js`, ctx); } catch { /* fall through */ }
  }
  return next(spec, ctx);
} });

let A, React, render, parts;
before(async () => {
  writeFileSync(LINK, "import React from 'react'; export default function Link({ href, children, ...rest }) { return React.createElement('a', { ...rest, href: String(href) }, children); }\n");
  A = await import('./gamePageArcade.js');
  React = await import('react');
  render = (await import('react-dom/server')).renderToStaticMarkup;
  parts = await import('../../components/gridiron/GamePageArcade.js');
});

const GAME = { home: { id: 1, abbreviation: 'CHI' }, away: { id: 2, abbreviation: 'PHI' } };
const T0 = Date.parse('2026-10-04T17:05:00Z');
const at = (i) => new Date(T0 + i * 60_000).toISOString();
// A state row is the model's read AT ITS PLAY'S SNAP (lib/winprob/live.js), so a
// non-scoring move from row A to row B is what A's play did; a move that
// changes the score is B's play (the scoring row carries its points).
const R = (id, play_seq, p, type, { text = 'a play', off = 1, reason = null, period = 2, clock = '7:00', hs = 0, as = 0 } = {}) => ({
  id, ts: at(id), play_seq, p_home: p,
  inputs: reason ? { reason } : { secs_game: 2000, home_score: hs, away_score: as, score_diff: hs - as },
  period, clock, play_type: type, text, offense_team_id: off,
});
const ROWS = [
  R(1, 101, 0.5, 'rush'),
  R(2, 102, 0.5625, 'pass-reception'),                                              // (1,2) +.0625 -> 101
  R(3, 103, 0.75, 'passing-touchdown', { text: 'X pass to Y for 9 yards, TOUCHDOWN. Z extra point is GOOD', clock: '3:12', hs: 7 }), // (2,3) +.1875, the score moved -> 103, the TD row (its folded try counts)
  R(4, 104, 0.625, 'kickoff', { off: 2, text: 'K kicks 65 yards from CHI 35', hs: 7 }), // (3,4) INTO a kickoff: out
  R(5, 104, 0.625, 'kickoff', { reason: 'hold' }),                                   // not a state
  R(6, 104, 0.625, 'kickoff', { reason: 'release' }),                                // not a state
  R(7, 105, 0.65625, 'rush', { off: 2, hs: 7 }),                                     // (4,7) OUT OF the kickoff: out
  R(8, 106, 0.6875, 'pass-interception-return', { off: 2, text: 'Q pass INTERCEPTED by D', period: 3, clock: '11:02', hs: 7 }), // (7,8) +.03125 -> 105
  R(9, 107, 0.9375, 'rush', { hs: 7 }),                                              // (8,9) +.25 -> 106, the interception
  R(10, 108, 0.8125, 'two-point-conversion', { off: 2, hs: 7 }),                     // (9,10) INTO a try: out
  R(11, 109, 0.5625, 'rush', { period: 4, clock: '2:00', hs: 7 }),                   // (10,11) OUT OF a try: out
  R(12, 110, 0.375, 'pass-reception', { hs: 7 }),                                    // (11,12) -.1875 -> 109; ties (2,3) -> the EARLIER wins
  R(13, 110, 0.4375, 'pass-reception', { hs: 7 }),                                   // (12,13) same play re-read: out
  R(14, null, 0.25, null, { text: null, hs: 7 }),                                     // (13,14) INTO no play: out
  R(15, 111, 0.5, 'rush', { hs: 7 }),                                                // (14,15) OUT OF no play: out
  R(16, 111, 1, 'rush', { reason: 'final' }),                                         // not a state
];

test('THE SELECTION: top 3 by |delta| over consecutive STATE rows, biggest first, ties to the earlier', () => {
  const s = A.biggestSwings(ROWS, GAME);
  assert.deepEqual(s.map((x) => x.playSeq), [106, 103, 109]);
  assert.deepEqual(s.map((x) => x.label), ['CHI +25%', 'CHI +19%', 'PHI +19%']);
  assert.deepEqual(s.map((x) => x.deltaHome), [0.25, 0.1875, -0.1875], 'signed in the home frame');
  assert.deepEqual(s.map((x) => x.when), ['Q3 11:02', 'Q2 3:12', 'Q4 2:00']);
  assert.equal(s[1].text, 'X pass to Y for 9 yards, TOUCHDOWN. Z extra point is GOOD');
  // The interception is PHI's offense (the thrower); the swing goes CHI's way.
  assert.equal(s[0].team, 'PHI'); assert.equal(s[0].gainer, 'CHI');
});

test('WHICH PLAY MADE IT: a non-scoring move is the EARLIER row\'s play; a scoring move is the later row\'s', () => {
  // 107's row is where the interception's result first shows (PHI's ball gone,
  // CHI at the snap) - the swing is the interception's, not 107's.
  const s = A.biggestSwings(ROWS, GAME, { top: 99 });
  assert.ok(s.some((x) => x.playSeq === 106) && !s.some((x) => x.playSeq === 107));
  // The touchdown row carries the score: the move into it is the touchdown's.
  assert.ok(s.some((x) => x.playSeq === 103) && !s.some((x) => x.playSeq === 102 && x.deltaHome > 0.1));
  assert.equal(A.scoreMoved({ inputs: { home_score: 0, away_score: 0 } }, { inputs: { home_score: 3, away_score: 0 } }), true);
  assert.equal(A.scoreMoved({ inputs: { home_score: 3, away_score: 0 } }, { inputs: { home_score: 3, away_score: 0 } }), false);
  assert.equal(A.scoreMoved({ inputs: { score_diff: 0 } }, { inputs: { score_diff: -3 } }), true, 'older rows: score_diff');
  assert.equal(A.scoreMoved({ inputs: { score_diff: 7 } }, { inputs: { score_diff: 7 } }), false);
});

test('THE ORDER IS THE LOG\'S: shuffled input gives the same answer (ts, then id)', () => {
  const shuffled = [...ROWS].reverse();
  assert.deepEqual(A.biggestSwings(shuffled, GAME).map((x) => x.playSeq), [106, 103, 109]);
  // Same ts: id decides.
  const same = [R(1, 1, 0.5, 'rush'), R(2, 2, 0.75, 'rush'), R(3, 3, 0.25, 'rush')].map((r) => ({ ...r, ts: at(0) }));
  assert.deepEqual(A.biggestSwings([same[2], same[0], same[1]], GAME).map((x) => [x.playSeq, x.deltaHome]), [[2, -0.5], [1, 0.25]]);
});

test('EXCLUDED PAIRS ARE DROPPED, NEVER BRIDGED: nothing across a kickoff or a try', () => {
  const s = A.biggestSwings(ROWS, GAME, { top: 99 });
  assert.deepEqual(s.map((x) => x.playSeq), [106, 103, 109, 101, 105]);
  // The pairs that touch 104 (kickoff), 108 (try), the no-play row and the
  // re-read of 110 give nothing; a bridge 103 (.75) -> 105 (.65625) would be
  // a -.09375 swing, 107 (.9375) -> 109 (.5625) a -.375 one: neither exists.
  for (const bad of [0.65625 - 0.75, 0.5625 - 0.9375]) assert.ok(!s.some((x) => Math.abs(x.deltaHome - bad) < 1e-12), `no bridge ${bad}`);
  assert.ok(!s.some((x) => [104, 108, 111].includes(x.playSeq)));
});

test('swingExcluded: kickoffs and try rows by play_type and text; a touchdown row with its folded try counts', () => {
  const ex = (play_type, text = '') => A.swingExcluded({ play_type, text });
  assert.equal(ex('kickoff'), true);
  assert.equal(ex('Kickoff'), true, 'CFB-cased types read the same');
  assert.equal(ex('onside-kick'), true);
  assert.equal(ex('kickoff-return-touchdown', 'K kicks 65 yards ... TOUCHDOWN'), false, 'a return touchdown is a score, not a kickoff state');
  assert.equal(ex('extra-point-good'), true);
  assert.equal(ex('two-point-conversion'), true);
  assert.equal(ex('pat'), true);
  assert.equal(ex('unknown', 'C.Santos extra point is GOOD, Center-S.Daly, Holder-T.Taylor.'), true, 'a try on a row of its own');
  assert.equal(ex('unknown', 'TWO-POINT CONVERSION ATTEMPT. J.Hurts rushes. ATTEMPT SUCCEEDS.'), true);
  assert.equal(ex('passing-touchdown', 'pass to C.Olave for 21 yards, TOUCHDOWN. TWO-POINT CONVERSION ATTEMPT. ATTEMPT SUCCEEDS.'), false);
  assert.equal(ex('rushing-touchdown', 'J.Hurts up the middle for 1 yard, TOUCHDOWN. J.Elliott extra point is GOOD'), false);
  assert.equal(ex('rush', 'A run'), false);
  assert.equal(A.swingExcluded(null), true, 'no play');
  assert.equal(A.swingExcluded({ play_type: null, text: null }), true, 'a play_seq that resolved to nothing');
});

test('THE TEAM: the offense; a defensive or return touchdown is the scoring side', () => {
  const rows = [R(1, 1, 0.5, 'rush'), R(2, 2, 0.25, 'interception-return-touchdown', { off: 1, as: 7 })];
  assert.equal(A.biggestSwings(rows, GAME)[0].team, 'PHI', 'CHI threw it, PHI scored it');
  const blocked = [R(1, 1, 0.5, 'rush'), R(2, 2, 0.75, 'blocked-punt-touchdown', { off: 2, hs: 7 })];
  assert.equal(A.biggestSwings(blocked, GAME)[0].team, 'CHI');
  assert.equal(A.biggestSwings([R(1, 1, 0.5, 'rush', { off: null }), R(2, 2, 0.625, 'rush')], GAME)[0].team, '', 'no offense: no team');
});

test('NOTHING TO SHOW: under two state rows, or only zero moves', () => {
  assert.deepEqual(A.biggestSwings([], GAME), []);
  assert.deepEqual(A.biggestSwings([R(1, 1, 0.5, 'rush')], GAME), []);
  assert.deepEqual(A.biggestSwings([R(1, 1, 0.5, 'rush'), R(2, 2, 0.5, 'rush')], GAME), []);
});

test('ELIGIBILITY, BOTH CONDITIONS: NFL final, kickoff >= 4 Oct 00:00Z, every state row after 2 Oct 20:21:04Z', () => {
  const states = ROWS.filter((r) => !r.inputs.reason);
  const base = { league: 'nfl', state: 'final', kickoffAt: '2026-10-04T17:00:00Z', rows: ROWS };
  assert.equal(A.SWINGS_KICKOFF_FROM, '2026-10-04T00:00:00Z');
  assert.equal(A.SWINGS_LOGGED_AFTER, '2026-10-02T20:21:04Z');
  assert.equal(A.swingsEligible(base), true);
  assert.equal(A.swingsEligible({ ...base, kickoffAt: '2026-10-04T00:00:00Z' }), true, 'the boundary is in');
  assert.equal(A.swingsEligible({ ...base, kickoffAt: '2026-10-03T23:59:59Z' }), false, 'a Saturday kickoff is out');
  assert.equal(A.swingsEligible({ ...base, kickoffAt: new Date('2026-10-05T00:15:00Z') }), true, 'a Date reads the same');
  assert.equal(A.swingsEligible({ ...base, league: 'cfb' }), false, 'NFL only');
  assert.equal(A.swingsEligible({ ...base, state: 'live' }), false, 'finals only');
  assert.equal(A.swingsEligible({ ...base, kickoffAt: null }), false);
  // ONE state row before the cutoff and the game is out - even at the boundary instant.
  const early = [{ ...states[0], ts: '2026-10-02T20:21:04Z' }, ...states.slice(1)];
  assert.equal(A.swingsEligible({ ...base, rows: early }), false, 'logged AT the cutoff is not after it');
  const earlier = [{ ...states[0], ts: '2026-10-01T18:00:00Z' }, ...states.slice(1)];
  assert.equal(A.swingsEligible({ ...base, rows: earlier }), false);
  // Hold / release / final rows are not states: an old one does not disqualify.
  const oldHold = [{ id: 0, ts: '2026-10-01T18:00:00Z', p_home: 0.5, inputs: { reason: 'hold' } }, ...ROWS];
  assert.equal(A.swingsEligible({ ...base, rows: oldHold }), true);
  assert.equal(A.swingsEligible({ ...base, rows: ROWS.filter((r) => r.inputs.reason) }), false, 'no state rows, nothing to show');
});

test('THE MODULE SLOT: finals only, NFL only, after the curve, only when there are swings', () => {
  assert.deepEqual(A.arcadeModules({ state: 'final', league: 'nfl', hasCurve: true, hasSwings: true }), ['card', 'winprob', 'swings', 'yours', 'scoring', 'leaders']);
  assert.deepEqual(A.arcadeModules({ state: 'final', league: 'nfl', hasCurve: true, hasSwings: false }), ['card', 'winprob', 'yours', 'scoring', 'leaders']);
  assert.ok(!A.arcadeModules({ state: 'final', league: 'cfb', hasCurve: true, hasSwings: true }).includes('swings'), 'never CFB');
  assert.ok(!A.arcadeModules({ state: 'live', league: 'nfl', hasCurve: true, hasSwings: true }).includes('swings'), 'never live');
  assert.ok(!A.arcadeModules({ state: 'pre', league: 'nfl', hasSwings: true }).includes('swings'));
});

test('THE ROW: when · team · play · delta, three of them', () => {
  const h = render(React.createElement(parts.Swings, { list: A.biggestSwings(ROWS, GAME) }));
  assert.match(h, /data-gpa="swings"/);
  assert.match(h, /Biggest swings/);
  assert.equal([...h.matchAll(/<li data-swing="\d">/g)].length, 3);
  assert.match(h, /<li data-swing="1"><span class="w">Q3 11:02<\/span><b class="t">PHI<\/b><span class="tx" title="Q pass INTERCEPTED by D">Q pass INTERCEPTED by D<\/span><b class="d" data-delta="home">CHI \+25%<\/b><\/li>/);
  assert.equal(render(React.createElement(parts.Swings, { list: [] })), '', 'no swings, no module');
});

// ---------------------------------------------------------------------------
// DEV: the real pre-fix game, and a post-cutoff final
// ---------------------------------------------------------------------------
const { sql } = await import('../db.js');
const W = await import('../testing/wpSentinel.mjs');
const { getGamePage } = await import('./gameDetail.js');
const { arcadeGameView } = await import('./gamePageArcadeView.js');

const NS = `sentinel-swings-${process.pid}-${Date.now()}`;
const made = [];
let PRE, POST;

before(async () => {
  // PRE-FIX: PHI@CHI as it was - DEV's own schedule row says when it kicked
  // off, and the three winprob_log rows are the ones PROD logged for it
  // (fixture `winprob`, ids 11182/11198/11291), on the copied plays.
  const [real] = await sql`SELECT kickoff_at FROM matches WHERE slug = 'nfl-2026-reg-w3-phi-chi'`;
  const ko = new Date(real?.kickoff_at ?? '2026-09-29T00:15:00Z');
  PRE = await W.seedPhiChi(sql, { slug: `${NS}-pre`, kickoffAt: ko.toISOString() });
  made.push(PRE.matchId);
  const provOfStored = new Map(W.PHI_CHI.stored.map((s) => [s.id, s.provider_play_id]));
  const idOfProv = new Map(PRE.plays.map((p) => [p.providerPlayId, p.id]));
  // The rows' ts: kickoff plus the game seconds they were at - the night of
  // the game, days before the cutoff (the fixture carries no ts of its own).
  const real3 = W.PHI_CHI.winprob.map((w) => ({
    play_seq: idOfProv.get(provOfStored.get(w.play_seq)), p_home: w.p_home, inputs: w.inputs,
    ts: new Date(ko.getTime() + (3600 - w.inputs.secs_game) * 1500).toISOString(),
  }));
  assert.ok(real3.every((r) => r.play_seq), 'every PROD row found its play in the copy');
  await W.writeLog(sql, PRE.matchId, real3, { startMs: ko.getTime() });

  // POST-CUTOFF: the same plays, kicked off Sunday 4 Oct, the shipped model's
  // log stamped after kickoff, with a hold / release pair and the final row.
  const ko2 = Date.parse('2026-10-04T17:00:00Z');
  POST = await W.seedPhiChi(sql, { slug: `${NS}-post`, kickoffAt: new Date(ko2).toISOString() });
  made.push(POST.matchId);
  const rows = W.modelRows(POST.plays, { home: POST.home });
  const mid = Math.floor(rows.length / 2);
  const withHold = [
    ...rows.slice(0, mid),
    { play_seq: rows[mid - 1].play_seq, p_home: rows[mid - 1].p_home, inputs: { reason: 'hold', why: 'plays-behind-score' } },
    { play_seq: rows[mid - 1].play_seq, p_home: rows[mid - 1].p_home, inputs: { reason: 'release', secs_held: 40 } },
    ...rows.slice(mid),
    { play_seq: rows.at(-1).play_seq, p_home: 1, inputs: { reason: 'final', secs_game: 0, is_ot: 0, home_score: 27, away_score: 7, score_diff: 20 } },
  ];
  await W.writeLog(sql, POST.matchId, withHold, { startMs: ko2 + 5 * 60_000 });
});

after(async () => {
  await W.teardown(sql, made);
  const [left] = await sql`SELECT count(*)::int n FROM matches WHERE slug LIKE ${`${NS}%`}`;
  assert.equal(left.n, 0, 'the sentinels are gone');
  try { unlinkSync(LINK); } catch { /* gone */ }
});

const viewOf = async (slug) => arcadeGameView({ game: await getGamePage(slug), now: new Date('2026-10-05T12:00:00Z') });

test('THE REAL PRE-FIX GAME (PHI@CHI wk3, its PROD rows): NO Biggest swings', async () => {
  const v = await viewOf(`${NS}-pre`);
  assert.equal(v.state, 'final');
  assert.ok(v.modules.includes('winprob'), 'the curve still draws');
  assert.ok(!v.modules.includes('swings'), `no swings module: ${v.modules}`);
  assert.deepEqual(v.swings, []);
  // THE GUARD IS REAL: the same rows would yield swings if eligibility let them.
  const rows = await A.biggestSwingRows(PRE.matchId);
  assert.ok(A.biggestSwings(rows, v.g).length > 0, 'the rows have swings in them - it is the cutoff that keeps them off the page');
  assert.equal(A.swingsEligible({ league: 'nfl', state: 'final', kickoffAt: v.g.kickoffAt, rows }), false);
});

test('A FINAL KICKED OFF 4 OCT WITH CLEAN ROWS: the module, after the curve, three swings', async () => {
  const v = await viewOf(`${NS}-post`);
  assert.equal(v.state, 'final');
  const i = v.modules.indexOf('swings');
  assert.ok(i > 0 && v.modules[i - 1] === 'winprob', `swings right after the curve: ${v.modules}`);
  assert.equal(v.swings.length, 3);
  const pcts = v.swings.map((s) => s.pct);
  assert.deepEqual([...pcts].sort((a, b) => b - a), pcts, 'biggest first');
  for (const s of v.swings) {
    assert.match(s.label, /^(PHI|CHI) \+\d+%$/);
    assert.match(s.when, /^Q[1-4] \d{1,2}:\d{2}$/);
    assert.ok(s.text.length > 10);
    assert.ok(!/kicks \d+ yards from/.test(s.text), `never a kickoff: ${s.text}`);
    assert.ok(['PHI', 'CHI'].includes(s.team));
  }
  // The final row (p = 1) and the hold pair are not states: no swing is the
  // jump to the result.
  assert.ok(v.swings.every((s) => s.pct < 100));
  const h = render(React.createElement(parts.Swings, { list: v.swings }));
  assert.equal([...h.matchAll(/<li data-swing=/g)].length, 3);
});
