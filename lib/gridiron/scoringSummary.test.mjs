// lib/gridiron/scoringSummary.test.mjs - the one-line scoring summary (thu-5),
// against REAL rows: every scoring play of PHI@CHI (21586) and ATL@GB (21571),
// 2026 week 3, plus other 2026 NFL rows for the shapes those two games lack -
// all read once, read-only, from PROD plays into fixtures/scoringPlays.prod.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scoringSummary, cleanPlayText, twoPointPart, firstClause } from './scoringSummary.js';
import { scoreChanges, whenLabel } from './gamePageArcade.js';

const F = JSON.parse(readFileSync(new URL('./fixtures/scoringPlays.prod.json', import.meta.url), 'utf8'));
const byId = new Map([...F.games, ...F.extra].map((r) => [r.id, r]));
const sum = (id) => { const r = byId.get(id); assert.ok(r, `fixture row ${id}`); return scoringSummary(r.text, { playType: r.play_type }); };

test('PHI@CHI (21586): every scoring play, text in -> line out', () => {
  assert.deepEqual([2002586, 2003900, 2004382, 2005560, 2006201, 2008393].map(sum), [
    'C.Keenum 8-yd TD pass to L.Burden',     // (Shotgun) ... C.Santos extra point is GOOD, Center-..., Holder-...
    'C.Santos 29-yd FG',
    'J.Hurts 1-yd TD run',                   // (No Huddle) ... up the middle
    'C.Santos 48-yd FG',                     // the feed's own leading space
    'C.Keenum 41-yd TD pass to K.Raymond',
    'C.Keenum 1-yd TD run',                  // ...Holder-T.Taylor.PENALTY on CHI-J.Jackson... dropped
  ]);
});

test('ATL@GB (21571): every scoring play, incl. "reported in as eligible" and a 2-pt pass', () => {
  assert.deepEqual([1124435, 1126389, 1133568, 1136324, 1144558, 1148004, 1149227, 1151631].map(sum), [
    'J.Love 4-yd TD pass to C.Watson',
    'Bi.Robinson 3-yd TD run',
    'N.Folk 44-yd FG',
    'M.Penix 5-yd TD pass to A.Hooper',
    'Br.Robinson 7-yd TD run',               // "J.Taylor reported in as eligible.  Br.Robinson left guard ..."
    'N.Folk 31-yd FG',
    'J.Love 15-yd TD pass to M.Golden',
    'Bi.Robinson 2-yd TD run · 2-pt pass good', // "C.Levin and M.Jerrell reported in as eligible. ... TWO-POINT ... SUCCEEDS."
  ]);
});

test('the shapes those games lack, from other 2026 NFL rows (cited by plays.id)', () => {
  assert.equal(sum(273300), 'D.Maye 2-yd TD pass to E.Raridon');                       // match 21539, eligible prefix
  assert.equal(sum(802749), 'D.Henry 1-yd TD run');                                    // 21562, (Shotgun) + eligible + "Direct snap to"
  assert.equal(sum(838572), 'T.Shough 21-yd TD pass to C.Olave · 2-pt run good');      // 21562, 2-pt run
  assert.equal(sum(544123), 'J.Allen 34-yd TD pass to J.Palmer');                      // 21548, a FAILED 2-pt is not named
  assert.equal(sum(511976), 'J.Trotter 38-yd INT return TD');                          // 21541
  assert.equal(sum(840962), 'E.Ponder 19-yd fumble return TD');                        // 21559
  assert.equal(sum(1910735), 'M.Price 86-yd punt return TD');                          // 21582, penalty clause dropped
  assert.equal(sum(916544), 'Safety');                                                 // 21565, holding in the end zone
});

test('kick returns, the unparseable fallback, and the pieces', () => {
  // No 2026 NFL kickoff-return TD is stored yet; this is the feed's sentence shape for one.
  assert.equal(scoringSummary('J.Bates kicks 65 yards from DET 35 to NO 0. R.Shaheed for 100 yards, TOUCHDOWN.', { playType: 'kickoff-return-touchdown' }), 'R.Shaheed 100-yd kick return TD');
  assert.equal(scoringSummary('Something nobody wrote a rule for, then more.'), 'Something nobody wrote a rule for');
  assert.equal(firstClause('(Shotgun) Weird thing. Then more'), 'Weird thing');
  assert.equal(cleanPlayText('(No Huddle, Shotgun) J.Taylor reported in as eligible.  B.Hall left end'), 'B.Hall left end');
  assert.equal(twoPointPart('x. TWO-POINT CONVERSION ATTEMPT. J.Allen pass to K.Coleman is incomplete. ATTEMPT FAILS.'), null);
});

test('THE LINE THE PAGE SHOWS: scoreChanges over the real PHI@CHI rows, one row each', () => {
  const plays = F.games.filter((r) => r.match_id === 21586).map((r) => ({
    period: r.period, clock: r.clock, text: r.text, playType: r.play_type, homeScore: r.home_score, awayScore: r.away_score,
  }));
  const lines = scoreChanges(plays).map((s) => `${whenLabel(s.period, s.clock)} · ${s.side === 'home' ? 'CHI' : 'PHI'} · ${scoringSummary(s.text, { playType: s.playType })} · PHI ${s.awayScore} - CHI ${s.homeScore}`);
  assert.deepEqual(lines, [
    'Q1 8:47 · CHI · C.Keenum 8-yd TD pass to L.Burden · PHI 0 - CHI 7',
    'Q2 1:52 · CHI · C.Santos 29-yd FG · PHI 0 - CHI 10',
    'Q2 0:00 · PHI · J.Hurts 1-yd TD run · PHI 7 - CHI 10',
    'Q3 10:17 · CHI · C.Santos 48-yd FG · PHI 7 - CHI 13',
    'Q3 5:47 · CHI · C.Keenum 41-yd TD pass to K.Raymond · PHI 7 - CHI 20',
    'Q4 7:19 · CHI · C.Keenum 1-yd TD run · PHI 7 - CHI 27',
  ]);
});
