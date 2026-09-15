// lib/push/scoringPlay.test.mjs - every scoring shape, from REAL rows.
//
// Each string below is quoted verbatim from `plays` on the 2026 slate, pulled
// on 13 Sep 2026. They are the reason the parser is written the way it is:
// two providers with two grammars share one column, and a rule invented
// without looking at both would have named the passer on every passing
// touchdown in one of them.
//
// TWO SHAPES HAVE NO REAL NFL ROW YET - a two-point conversion and a safety
// had not occurred in the NFL corpus when this was written (the corpus had 12
// safeties and 15 two-point attempts, all CFB). Those cases are covered by the
// real CFB text PLUS a SYNTHETIC NFL fixture, and every synthetic test says so
// in its own name rather than passing itself off as observed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScoringPlay, scorerOf, passerOf } from './scoringPlay.js';

const play = (play_type, text, home_score = 7, away_score = 0) => ({ play_type, text, home_score, away_score });

// ---------------------------------------------------------------------------
// NFL (balldontlie) - lowercase-hyphen types, names as "T.Lawrence"
// ---------------------------------------------------------------------------
test('NFL passing touchdown names the RECEIVER, not the passer', () => {
  const r = parseScoringPlay(play('passing-touchdown',
    'T.Lawrence pass short middle to J.Cameron for 4 yards, TOUCHDOWN. C.Little extra point is GOOD, Center-R.Matiscik, Holder-L.Cooke.'));
  assert.equal(r.kind, 'touchdown');
  assert.equal(r.scorer, 'J.Cameron');
  assert.equal(r.tryResolved, true);
  assert.equal(r.tryKind, 'kick-good');
});

test('NFL passing touchdown with a defender in brackets after the word', () => {
  const r = parseScoringPlay(play('passing-touchdown',
    '(Shotgun) T.Lawrence pass deep right to P.Washington for 30 yards, TOUCHDOWN [M.Collins]. C.Little extra point is GOOD, Center-R.Matiscik, Holder-L.Cooke.'));
  assert.equal(r.scorer, 'P.Washington', 'the bracketed defender is after TOUCHDOWN and must not win');
});

test('NFL rushing touchdown names the carrier', () => {
  const r = parseScoringPlay(play('rushing-touchdown',
    'D.Henry right tackle for 4 yards, TOUCHDOWN. T.Loop extra point is GOOD, Center-N.Moore, Holder-R.Eckley.'));
  assert.equal(r.scorer, 'D.Henry');
  assert.equal(r.tryKind, 'kick-good');
});

test('NFL rushing touchdown behind an eligibility announcement', () => {
  // Two sentences, two players; the man who scored is in the second.
  const r = parseScoringPlay(play('rushing-touchdown',
    'L.Borom reported in as eligible.  J.Gibbs up the middle for 1 yard, TOUCHDOWN. J.Bates extra point is GOOD, Center-H.Hatten, Holder-J.Fox.'));
  assert.equal(r.scorer, 'J.Gibbs', 'not L.Borom, who only reported in');
});

test('NFL touchdown with a MISSED extra point resolves the try as missed', () => {
  const r = parseScoringPlay(play('rushing-touchdown',
    'J.Taylor right end for 1 yard, TOUCHDOWN. S.Shrader extra point is No Good, Wide Right, Center-L.Rhodes, Holder-R.Sanchez.'));
  assert.equal(r.scorer, 'J.Taylor');
  assert.equal(r.tryResolved, true, 'a missed try is still a RESOLVED try - nothing more is coming');
  assert.equal(r.tryKind, 'kick-missed');
  assert.equal(r.tryPoints, 0);
});

test('NFL field goal names the kicker', () => {
  const r = parseScoringPlay(play('field-goal-good',
    'J.Slye 42 yard field goal is GOOD, Center-M.Cox, Holder-T.Townsend.'));
  assert.equal(r.kind, 'field goal');
  assert.equal(r.scorer, 'J.Slye');
  assert.equal(r.tryResolved, false, 'a field goal has no try to wait for');
});

test('NFL defensive touchdown off a strip sack names the RECOVERER', () => {
  // The sentence contains the quarterback, two tacklers and the recoverer.
  const r = parseScoringPlay(play('sack-opp-fumble-recovery',
    '(No Huddle) B.Mayfield sacked at TB 25 for -8 yards (sack split by M.Murphy and B.Carter). FUMBLES (M.Murphy) [B.Carter], touched at TB 26, RECOVERED by CIN-D.Knight at TB 27. D.Knight for 27 yards, TOUCHDOWN. E.McPherson extra point is GOOD, Center-W.Wagner, Holder-R.Rehkow.'));
  assert.equal(r.kind, 'touchdown');
  assert.equal(r.scorer, 'D.Knight', 'not Mayfield, Murphy or Carter');
});

// ---------------------------------------------------------------------------
// CFB (CFBD) - Title Case types, names as "#14 J.Maiava"
// ---------------------------------------------------------------------------
test('CFB passing touchdown drops the jersey number and keeps the receiver', () => {
  const r = parseScoringPlay(play('Passing Touchdown',
    '(02:45) Shotgun #7 L.Winfield pass complete short left to #10 R.Babineaux caught at USC00, for 14 yards to the USC00 TOUCHDOWN, clock 02:38, 1ST DOWN #95 T.Sterner kick attempt good (H: #49 M.Golding, LS: #54 C.Kraft)'));
  assert.equal(r.scorer, 'R.Babineaux');
  assert.equal(r.tryKind, 'kick-good');
});

test('CFB rushing touchdown through a review clause', () => {
  const r = parseScoringPlay(play('Rushing Touchdown',
    '(09:26) No Huddle-Shotgun #24 S.Blanco rush middle for 1 yard gain to the USC00 TOUCHDOWN, clock 09:21. The previous play is under automatic review - "Runner broke the plane". CALL UPHELD #95 T.Sterner kick attempt good (H: #49 M.Golding, LS: #54 C.Kraft)'));
  assert.equal(r.scorer, 'S.Blanco');
  assert.equal(r.tryKind, 'kick-good');
});

test('CFB TWO-POINT conversion, successful, folded into the touchdown text', () => {
  const r = parseScoringPlay(play('Rushing Touchdown',
    '(09:30) No Huddle-Shotgun #4 D.Dampier rush left for 7 yards gain to the Ark00 TOUCHDOWN, clock 09:23, 1ST DOWN #8 M.Carvalho rush attempt Successful'));
  assert.equal(r.scorer, 'D.Dampier', 'the man in the end zone, not the man who ran the conversion');
  assert.equal(r.tryKind, 'two-good');
  assert.equal(r.tryPoints, 2);
});

test('CFB TWO-POINT conversion, failed', () => {
  const r = parseScoringPlay(play('Passing Touchdown',
    '(11:22) Shotgun #23 A.Newberry pass complete short left to #2 B.Atkinson caught at TTU05, for 4 yards to the TTU00 TOUCHDOWN, clock 11:17 rush attempt failed'));
  assert.equal(r.scorer, 'B.Atkinson');
  assert.equal(r.tryKind, 'two-failed');
  assert.equal(r.tryPoints, 0);
});

test('CFB SAFETY names nobody, and must not', () => {
  const r = parseScoringPlay(play('Safety',
    '(00:35) #37 T.White punt 50 yards to the MSU06 #0 J.Robinson return for loss of 6 yards to the fumbled by #0 J.Robinson at recovered by MSU  at MSU00. Texas A&M SAFETY, clock 00:26'));
  assert.equal(r.kind, 'safety');
  assert.equal(r.scorer, null,
    'the text is about the team that CONCEDED it - the two points go the other way');
});

test('CFB interception return touchdown names the returner', () => {
  const r = parseScoringPlay(play('Interception Return Touchdown',
    '(00:17) Shotgun #9 C.Gonzales pass intercepted by #29 N.Cull at OM24 QB hurried by #3 B.Purchase #29 N.Cull return 76 yards to the CLT00 TOUCHDOWN, clock 00:04'));
  assert.equal(r.scorer, 'N.Cull', 'not the quarterback who threw it');
  assert.equal(r.tryResolved, false, 'this one has no try in its text');
});

test('CFB punt return touchdown names the returner, not the punter', () => {
  const r = parseScoringPlay(play('Punt Return Touchdown',
    '(01:46) #49 M.Golding punt 41 yards to the USC14 #4 T.Mosley return 86 yards to the UL00 TOUCHDOWN, clock 01:24 #45 C.Chittenden kick attempt good (H: #35 L.Carrigan, LS: #53 L.Brown)'));
  assert.equal(r.scorer, 'T.Mosley');
});

// ---------------------------------------------------------------------------
// SYNTHETIC NFL FIXTURES (relay ruling R2) - the two shapes the NFL corpus did
// not yet contain. Written in balldontlie's grammar from its documented
// phrasing; every one is labelled synthetic so nobody reads it as observed.
// ---------------------------------------------------------------------------
test('SYNTHETIC NFL two-point conversion', () => {
  const r = parseScoringPlay(play('rushing-touchdown',
    '(Shotgun) I.Pacheco left guard for 2 yards, TOUCHDOWN. TWO-POINT CONVERSION ATTEMPT. P.Mahomes pass to T.Kelce is complete. ATTEMPT SUCCEEDS.'));
  assert.equal(r.kind, 'touchdown');
  assert.equal(r.scorer, 'I.Pacheco');
  assert.equal(r.tryKind, 'two-good');
  assert.equal(r.tryPoints, 2);
});

test('SYNTHETIC NFL two-point conversion, failed', () => {
  const r = parseScoringPlay(play('passing-touchdown',
    'P.Mahomes pass short right to R.Rice for 6 yards, TOUCHDOWN. TWO-POINT CONVERSION ATTEMPT. P.Mahomes pass to T.Kelce is incomplete. ATTEMPT FAILS.'));
  assert.equal(r.scorer, 'R.Rice');
  assert.equal(r.tryKind, 'two-failed');
});

test('SYNTHETIC NFL safety names nobody', () => {
  const r = parseScoringPlay(play('safety',
    'B.Purdy sacked in End Zone by C.Jones, SAFETY.'));
  assert.equal(r.kind, 'safety');
  assert.equal(r.scorer, null);
});

// ---------------------------------------------------------------------------
// REFUSALS - a null is a fallback, never a failure
// ---------------------------------------------------------------------------
test('a non-scoring play parses to null, and the caller keeps its delta wording', () => {
  assert.equal(parseScoringPlay(play('rush', '(Shotgun) K.Miller rush middle for 6 yards gain to the USC19 (#44 J.St. Andre)')), null);
  assert.equal(parseScoringPlay(play('pass-incompletion', 'Shotgun #14 J.Maiava pass incomplete short right to #8 K.Miller')), null);
  assert.equal(parseScoringPlay(play('field-goal-missed', 'T.Bass 46 yard field goal is No Good, Wide Left.')), null);
  assert.equal(parseScoringPlay(null), null);
  assert.equal(parseScoringPlay(play('rush', '')), null);
});

test('the play row carries the POST-TRY score, and it is handed back', () => {
  const r = parseScoringPlay(play('rushing-touchdown',
    'D.Henry right tackle for 4 yards, TOUCHDOWN. T.Loop extra point is GOOD.', 14, 7));
  assert.equal(r.homeScore, 14);
  assert.equal(r.awayScore, 7);
});

test('scorerOf finds nothing where there is nothing, rather than guessing', () => {
  assert.equal(scorerOf('no touchdown here'), null);
  assert.equal(scorerOf('TOUCHDOWN'), null, 'no name before the word');
  assert.equal(scorerOf(null), null);
});

test('a suffixed name survives', () => {
  const r = parseScoringPlay(play('passing-touchdown',
    'B.Mayfield pass short left to C.Godwin Jr. for 9 yards, TOUCHDOWN. C.McLaughlin extra point is GOOD.'));
  assert.equal(r.scorer, 'C.Godwin Jr.');
});

// ===========================================================================
// THE CREDIT LINE (15 Sep: the names moved to the body, so a play that has two
// men in it has to give both)
// ===========================================================================
test('a passing touchdown credits the PASSER AND the receiver', () => {
  assert.equal(parseScoringPlay(play('passing-touchdown',
    '(Shotgun) P.Mahomes pass short right to R.Rice for 13 yards, TOUCHDOWN. H.Butker extra point is GOOD.')).credit,
  'P.Mahomes to R.Rice');
  assert.equal(parseScoringPlay(play('passing-touchdown',
    '(Shotgun) B.Nix pass deep left to E.Engram for 19 yards, TOUCHDOWN. W.Lutz extra point is GOOD.')).credit,
  'B.Nix to E.Engram');
});

test('CFB drops the jersey numbers from both halves', () => {
  assert.equal(parseScoringPlay(play('Passing Touchdown',
    '(02:45) Shotgun #7 L.Winfield pass complete short left to #10 R.Babineaux caught at USC00, for 14 yards to the USC00 TOUCHDOWN, clock 02:38 #95 T.Sterner kick attempt good')).credit,
  'L.Winfield to R.Babineaux');
});

test('a rushing touchdown credits ONE man', () => {
  assert.equal(parseScoringPlay(play('rushing-touchdown',
    'D.Henry right tackle for 4 yards, TOUCHDOWN. T.Loop extra point is GOOD.')).credit, 'D.Henry');
});

test('A QUARTERBACK WHO RAN IT IN IS ONE MAN, not two', () => {
  // "P.Mahomes to P.Mahomes" is how a naive passer-plus-scorer would read it.
  assert.equal(parseScoringPlay(play('rushing-touchdown',
    '(Shotgun) P.Mahomes scrambles up the middle for 15 yards, TOUCHDOWN. H.Butker extra point is GOOD.')).credit,
  'P.Mahomes');
});

test('a defensive touchdown credits the man who reached the end zone', () => {
  assert.equal(parseScoringPlay(play('sack-opp-fumble-recovery',
    '(No Huddle) B.Mayfield sacked at TB 25 for -8 yards (sack split by M.Murphy and B.Carter). FUMBLES (M.Murphy) [B.Carter], touched at TB 26, RECOVERED by CIN-D.Knight at TB 27. D.Knight for 27 yards, TOUCHDOWN. E.McPherson extra point is GOOD.')).credit,
  'D.Knight');
});

test('a field goal credits the kicker AND the distance', () => {
  assert.equal(parseScoringPlay(play('field-goal-good',
    'H.Butker 42 yard field goal is GOOD, Center-J.Winchester, Holder-M.Araiza.')).credit, 'H.Butker 42 yards');
});

test('A SAFETY CREDITS NOBODY, and that is deliberate', () => {
  const r = parseScoringPlay(play('Safety',
    '(00:35) #37 T.White punt 50 yards to the MSU06 #0 J.Robinson return for loss of 6 yards to the fumbled by #0 J.Robinson at recovered by MSU at MSU00. Texas A&M SAFETY, clock 00:26'));
  assert.equal(r.kind, 'safety');
  assert.equal(r.credit, null, 'the text names the team that CONCEDED it');
});

test('passerOf finds nothing on a play with no pass in it', () => {
  assert.equal(passerOf('D.Henry right tackle for 4 yards, TOUCHDOWN.'), null);
  assert.equal(passerOf(null), null);
});

test('A PASS THE DEFENCE CAUGHT CREDITS ONLY THE RETURNER', () => {
  // "C.Gonzales to N.Cull" would read as a touchdown THROWN to Cull - the
  // exact opposite of what happened to Gonzales, who was intercepted. Caught
  // by reading the composed payloads, not by a test.
  assert.equal(parseScoringPlay(play('Interception Return Touchdown',
    '(00:17) Shotgun #9 C.Gonzales pass intercepted by #29 N.Cull at OM24 QB hurried by #3 B.Purchase #29 N.Cull return 76 yards to the CLT00 TOUCHDOWN, clock 00:04')).credit,
  'N.Cull');
});

test('a fumble the defence returned credits only the man who scored', () => {
  assert.equal(parseScoringPlay(play('Fumble Return Touchdown',
    '(14:55) Shotgun #5 D.Lane Jr. rush right for 1 yard loss fumbled by #5 D.Lane Jr. recovered by UND #5 B.Traore at Rice24 #5 B.Traore return 24 yards to the Rice00 TOUCHDOWN')).credit,
  'B.Traore');
});

test('and a clean passing touchdown still credits both', () => {
  assert.equal(parseScoringPlay(play('passing-touchdown',
    '(Shotgun) P.Mahomes pass short right to R.Rice for 13 yards, TOUCHDOWN. H.Butker extra point is GOOD.')).credit,
  'P.Mahomes to R.Rice');
});
