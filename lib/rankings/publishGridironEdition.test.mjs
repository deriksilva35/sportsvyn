// lib/rankings/publishGridironEdition.test.mjs - the pure half of the
// publisher: the tie rule, the movement rule, and what the field IS.
//
// THE DATABASE HALF IS NOT TESTED HERE and that is deliberate: it is one
// INSERT per row and two UPDATEs, and a test that mocked `sql` would assert
// that I wrote the SQL I wrote. What CAN be wrong without anybody noticing is
// the arithmetic in between - who is in the field, who shares a rank, and what
// a "previous" is - so that is what is pinned.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildEntries, rankBySort, applyMovement, LEAGUE_CONFIG, METHODOLOGY_VERSION,
  parseEditorList, resolveEditorRows, buildEditorLayer, anchorElo, publishedFieldSize,
} from './publishGridironEdition.js';
import { normalizeRankToScore } from './sitesLayer.js';
import { FCS_KEY } from '../ratings/elo.js';

const team = (id, abbr, classification = 'fbs') => ({ id, abbreviation: abbr, name: abbr, shortName: abbr, classification });
const seat = (elo, history = []) => ({ elo, games: history.length, history });
const game = (gameId, opp, result, margin, eloBefore, eloAfter) =>
  ({ gameId, opp, result, margin, eloBefore, eloAfter, home: true, season: 2026, phase: 'REG', kickoffAt: '2026-09-06T17:00:00Z' });

test('TIES SHARE A RANK AND THE NEXT RANK SKIPS - 1, 2, 2, 4', () => {
  const ranked = rankBySort([
    { teamId: 4, score: 6 }, { teamId: 1, score: 9 }, { teamId: 3, score: 8 }, { teamId: 2, score: 8 },
  ]);
  assert.deepEqual(ranked.map((r) => [r.teamId, r.rank]), [[1, 1], [2, 2], [3, 2], [4, 4]]);
  // Within a tie the order is by team id - stable, so a re-run cannot reorder
  // two teams that are on the same number, which would look like movement.
  assert.deepEqual(rankBySort([{ teamId: 9, score: 8 }, { teamId: 2, score: 8 }]).map((r) => r.teamId), [2, 9]);
  // A whole field on one score is all rank 1.
  assert.deepEqual(rankBySort([{ teamId: 1, score: 5 }, { teamId: 2, score: 5 }, { teamId: 3, score: 5 }])
    .map((r) => r.rank), [1, 1, 1]);
  assert.deepEqual(rankBySort([]), []);
});

test('THE FIELD IS THE PUBLISHABLE TEAMS: FCS is rated, pooled, and NOT an entry', () => {
  const table = new Map([
    [10, seat(1600, [game(1, FCS_KEY, 'W', 42, 1500, 1600)])],
    [11, seat(1400, [game(2, 10, 'L', 7, 1500, 1400)])],
    [FCS_KEY, seat(1100, [game(1, 10, 'L', 42, 1500, 1100)])],
    [99, seat(1500, [])],                                  // a rated id with no team row
  ]);
  const teams = [team(10, 'AAA'), team(11, 'BBB'), team(901, 'FCS1', 'fcs')];
  const rows = buildEntries({ table, teams, apByTeam: new Map(), cfg: LEAGUE_CONFIG.nfl });
  assert.deepEqual(rows.map((r) => r.teamId), [10, 11], 'the pool and the unknown id are both absent');
  assert.equal(rows.some((r) => r.teamId === FCS_KEY), false);
  // The pool DOES shape the field it is not in: team 10 beat it, and that win
  // is in team 10's last3 under the pool's own label.
  assert.deepEqual(rows.find((r) => r.teamId === 10).inputs.last3,
    [{ opp: FCS_KEY, result: 'W', margin: 42 }]);
  // An FCS team that somehow reached the table by id is still excluded by its
  // classification, not only by its key.
  const withFcsId = buildEntries({
    table: new Map([[10, seat(1600, [])], [901, seat(1200, [])]]),
    teams, apByTeam: new Map(), cfg: LEAGUE_CONFIG.nfl,
  });
  assert.deepEqual(withFcsId.map((r) => r.teamId), [10]);
});

test('THE INPUTS BLOB CARRIES THE WORKING, in the shape migration 108 documents', () => {
  // THREE SEATED TEAMS, so the PUBLISHED FIELD is 3 and an AP rank of 3 is
  // inside it. Under the field-size ruling a rank outside the published field
  // has no score at all, which is correct and is why the fixture has to be a
  // field that can hold the rank it hands out.
  const table = new Map([
    [10, seat(1600, [game(1, 11, 'W', 7, 1500, 1550), game(2, 12, 'W', 3, 1550, 1600)])],
    [11, seat(1400, [game(1, 10, 'L', 7, 1500, 1400)])],
    [12, seat(1500, [game(2, 10, 'L', 3, 1550, 1500)])],
  ]);
  const teams = [team(10, 'AAA'), team(11, 'BBB'), team(12, 'CCC')];
  const rows = buildEntries({
    table, teams, apByTeam: new Map([[10, 3]]), cfg: LEAGUE_CONFIG.cfb,
  });
  const top = rows.find((r) => r.teamId === 10);
  assert.deepEqual(Object.keys(top.inputs).sort(),
    ['ap', 'composite', 'delta3', 'editor', 'elo', 'field', 'last3', 'weights']);
  // THE FIELD EVERY CURVE ON THIS ROW WAS TAKEN OVER, stored so the panel's
  // caption cannot drift away from the score it is describing.
  assert.equal(top.inputs.field, 3, 'three publishable teams in this fixture');
  assert.equal(top.inputs.elo, 1600);
  assert.equal(top.inputs.delta3, 100, '1600 - 1500, the chain end to end');
  assert.deepEqual(top.inputs.last3, [
    { opp: 'BBB', result: 'W', margin: 7 }, { opp: 'CCC', result: 'W', margin: 3 },
  ], 'opponents by the abbreviation a reader sees, not by id');
  // AP 3 on a 25-team field, through the same curve sitesLayer.test.mjs pins.
  // THE PUBLISHED FIELD, not the poll's length: three teams are publishable
  // here, so rank 3 is last of three and scores the floor.
  assert.deepEqual(top.inputs.ap, { rank: 3, score: normalizeRankToScore(3, 3) });
  assert.equal(top.apScore, normalizeRankToScore(3, 3));
  assert.deepEqual(top.inputs.weights, { editorial: 0.7, sites: 0.3 });
  // AN UNRANKED TEAM CARRIES ap: null, not a zero and not an absent key.
  const un = rows.find((r) => r.teamId === 11);
  assert.equal(un.inputs.ap, null);
  assert.equal(un.apRank, null); assert.equal(un.apScore, null);
  // THE EDITOR IS ABSENT HERE - no file was supplied - and absent reads as
  // null, the same shape `ap` uses, so the blob has one convention for it.
  assert.equal(top.inputs.editor, null);
  assert.deepEqual(top.inputs.composite.dims, ['result']);
  // TWO OF FIVE DIMENSIONS, every row, and the three held ones are named.
  assert.deepEqual(top.scoredDims, ['result', 'momentum']);
  assert.deepEqual(top.heldDims, ['process', 'squad', 'coherence']);
});

test('THE NFL CARRIES NO AP AT ALL, by configuration and not by an empty map', () => {
  const table = new Map([[10, seat(1600, [])], [11, seat(1400, [])]]);
  const teams = [team(10, 'AAA'), team(11, 'BBB')];
  // Even handed a poll, an NFL edition must not blend one in.
  const rows = buildEntries({ table, teams, apByTeam: new Map([[10, 1]]), cfg: LEAGUE_CONFIG.nfl });
  for (const r of rows) {
    assert.equal(r.apRank, null); assert.equal(r.apScore, null); assert.equal(r.inputs.ap, null);
  }
  assert.equal(LEAGUE_CONFIG.nfl.usesAp, false);
  assert.deepEqual(rows[0].inputs.weights, { editorial: 1, sites: 0 });
});

test('MOVEMENT COMES FROM A PRIOR EDITION, and NO prior is "new" - never zero', () => {
  const rows = [{ teamId: 1, rank: 1, score: 9 }, { teamId: 2, rank: 2, score: 8 }, { teamId: 3, rank: 3, score: 7 }];
  const prior = { byTeam: new Map([[1, { rank: 3, score: 6.5 }], [2, { rank: 2, score: 8 }]]) };
  applyMovement(rows, prior);
  // POSITIVE MEANS CLIMBED - 3rd to 1st is +2, the convention lib/cfb/
  // rankings.js already uses for the AP poll's own movement.
  assert.deepEqual(rows.map((r) => [r.teamId, r.previousRank, r.rankMovement, r.movementLabel]), [
    [1, 3, 2, 'up'], [2, 2, 0, 'hold'], [3, null, null, 'new'],
  ]);
  assert.equal(rows[0].scoreMovement, 2.5);
  assert.equal(rows[1].scoreMovement, 0);
  assert.equal(rows[2].scoreMovement, null, 'a new team has no score to have moved from');
  // NO PRIOR AT ALL - the first computed edition - is every row "new", which
  // is what stops a movement glyph appearing on edition 1.
  applyMovement(rows, null);
  assert.deepEqual(rows.map((r) => r.movementLabel), ['new', 'new', 'new']);
  assert.deepEqual(rows.map((r) => r.rankMovement), [null, null, null]);
});

test('EDITION 0 IS NEVER A PREVIOUS - the prior is found by methodology_version', () => {
  // The hand-seeded boards are methodology_version '1.0'; every edition this
  // file writes is '3.0', and loadPriorComputedEdition filters on exactly that.
  // Asserting the constant here is what keeps the two halves in step: change
  // the version string without changing the lookup and edition 0 becomes a
  // previous again, which is the one thing the header forbids.
  assert.equal(METHODOLOGY_VERSION, '3.0');
  const src = readSource('lib/rankings/publishGridironEdition.js');
  assert.match(src, /methodology_version = \$\{METHODOLOGY_VERSION\}/,
    'the prior lookup must filter on the computed methodology version');
  assert.equal(/edition_number\s*>\s*0/.test(src), false,
    'and must NOT identify a computed edition by its number, which a re-seed could reuse');
});

const readSource = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

// ------------------------------------------------------- the editor's layer

const EDITOR_TEXT = `# Sportsvyn Power · CFB · 2026 week 4 · editor's 25
1 Texas
2 Ole Miss
3 Miami
`;
const EDITOR_TEAMS = [
  { id: 10, name: 'Texas', shortName: 'Texas', abbreviation: 'TEX' },
  { id: 11, name: 'Ole Miss', shortName: 'Ole Miss', abbreviation: 'MISS' },
  { id: 12, name: 'Miami', shortName: 'Miami', abbreviation: 'MIA' },
  { id: 13, name: 'Duke', shortName: 'Duke', abbreviation: 'DUKE' },
];

test('the editor file parses to rank + name, and a heading is not a team', () => {
  assert.deepEqual(parseEditorList(EDITOR_TEXT), [
    { rank: 1, name: 'Texas' }, { rank: 2, name: 'Ole Miss' }, { rank: 3, name: 'Miami' },
  ]);
  // Blank lines and any number of headings are skipped; "1." and "1)" are the
  // same line as "1", because a person typing twenty-five lines will not be
  // consistent about it and a punctuation mark is not a different opinion.
  assert.deepEqual(parseEditorList('# h\n\n1. Texas\n2) Ole Miss\n'),
    [{ rank: 1, name: 'Texas' }, { rank: 2, name: 'Ole Miss' }]);
  assert.deepEqual(parseEditorList(''), []);
  // A LINE THAT IS NOT A RANK AND A NAME IS A FAILURE, not a skipped line -
  // twenty-five hand-typed lines, and a shrugging parser would publish a
  // 24-team editorial layer silently.
  assert.throws(() => parseEditorList('1 Texas\nOle Miss\n'), /line 2: expected "<rank> <team>"/);
  assert.throws(() => parseEditorList('1 Texas\n1 Ole Miss\n'), /rank 1 appears twice/);
});

test('A MISS IN THE FILE FAILS LOUDLY, naming every miss at once', () => {
  // The resolver's own rule: exact name, scoped to the league, never a guess.
  assert.throws(
    () => resolveEditorRows([{ rank: 1, name: 'Texas' }, { rank: 2, name: 'Ole Miss' }], [EDITOR_TEAMS[0]]),
    /1 name\(s\) match no team in this league: #2 "Ole Miss"/,
  );
  // EVERY miss is named in one message, so a person fixing the file fixes them
  // all in one pass rather than one cron failure at a time.
  assert.throws(
    () => resolveEditorRows(parseEditorList('1 Texas\n2 Nowhere State\n3 Also Nowhere\n'), EDITOR_TEAMS),
    /2 name\(s\).*#2 "Nowhere State", #3 "Also Nowhere"/,
  );
  // AND IT THROWS RATHER THAN DROPPING THE ROW. A dropped name would move
  // every team below it up one place with no error anywhere - the failure this
  // test exists to make impossible.
  assert.throws(() => buildEditorLayer({ text: '1 Nowhere State\n', teams: EDITOR_TEAMS }), /match no team/);
  // Case is typing, not ambiguity.
  assert.equal(resolveEditorRows([{ rank: 1, name: 'ole miss' }], EDITOR_TEAMS)[0].teamId, 11);
});

test('NO FILE IS NOT AN ERROR - the NFL has none and never will', () => {
  const none = buildEditorLayer({ text: null, teams: EDITOR_TEAMS });
  assert.equal(none.present, false);
  assert.equal(none.byTeam.size, 0);
  assert.deepEqual(none.rows, []);
});

test('A RANKED TEAM BLENDS; AN UNRANKED ONE DOES NOT', () => {
  // A two-team field so the result dimension is computable by hand: elo 1600
  // and 1400, mean 1500, sd 100, so z is +1 and -1 and dim = 5 + 2z = 7 and 3.
  const table = new Map([[10, seat(1600, [])], [13, seat(1400, [])]]);
  const teams = EDITOR_TEAMS.map((t) => ({ ...t, classification: 'fbs' }));
  const editor = buildEditorLayer({ text: '1 Texas\n', teams });
  assert.equal(editor.byTeam.get(10).score, 10, 'rank 1 is 10.00 in any field');

  const rows = buildEntries({
    table, teams, apByTeam: new Map(), editorByTeam: editor.byTeam,
    cfg: { ...LEAGUE_CONFIG.cfb, editorialWeight: 1, sitesWeight: 0 },
  });
  const tex = rows.find((r) => r.teamId === 10);
  const duke = rows.find((r) => r.teamId === 13);

  // RANKED: mean(result 7, editor 10) = 8.5
  assert.equal(tex.dims.result, 7);
  assert.equal(tex.editorRank, 1); assert.equal(tex.editorScore, 10);
  assert.deepEqual(tex.compositeScored, ['result', 'editor']);
  assert.equal(tex.editorialComposite, 8.5);
  assert.deepEqual(tex.inputs.editor, { rank: 1, score: 10 });
  assert.deepEqual(tex.inputs.composite, { dims: ['result', 'editor'], values: { result: 7, editor: 10 }, value: 8.5 });

  // UNRANKED: result alone, 3 - NOT mean(3, 0), which would be 1.5 and would
  // punish a team for an opinion nobody expressed about it.
  assert.equal(duke.dims.result, 3);
  assert.equal(duke.editorRank, null); assert.equal(duke.editorScore, null);
  assert.deepEqual(duke.compositeScored, ['result']);
  assert.equal(duke.editorialComposite, 3);
  assert.notEqual(duke.editorialComposite, 1.5);
  assert.equal(duke.inputs.editor, null);
  assert.deepEqual(duke.inputs.composite.dims, ['result']);
});

test('MOMENTUM IS COMPUTED AND STORED, AND IS NOT IN THE COMPOSITE', () => {
  // The defect the dry run found: a flat mean of result and momentum gave a
  // hot three weeks half the ranking and put a 1418-rated NFL team third.
  const hot = seat(1500, [
    { gameId: 1, opp: 2, result: 'W', margin: 7, eloBefore: 1300, eloAfter: 1400, home: true, season: 2026, phase: 'REG', kickoffAt: '2026-09-06T17:00:00Z' },
    { gameId: 2, opp: 3, result: 'W', margin: 7, eloBefore: 1400, eloAfter: 1500, home: true, season: 2026, phase: 'REG', kickoffAt: '2026-09-13T17:00:00Z' },
  ]);
  const cold = seat(1700, [
    { gameId: 3, opp: 4, result: 'L', margin: 7, eloBefore: 1750, eloAfter: 1700, home: true, season: 2026, phase: 'REG', kickoffAt: '2026-09-06T17:00:00Z' },
  ]);
  const teams = [
    { id: 10, name: 'Texas', shortName: 'Texas', abbreviation: 'TEX', classification: 'fbs' },
    { id: 13, name: 'Duke', shortName: 'Duke', abbreviation: 'DUKE', classification: 'fbs' },
  ];
  const rows = buildEntries({
    table: new Map([[10, hot], [13, cold]]), teams, apByTeam: new Map(), editorByTeam: new Map(),
    cfg: { ...LEAGUE_CONFIG.cfb, editorialWeight: 1, sitesWeight: 0 },
  });
  const [top] = rows;
  // The cold team is rated 200 points higher and is first, despite the other
  // having gained 200 over three games.
  assert.equal(top.teamId, 13);
  // Momentum IS computed and stored, on both rows - it is shown, not blended.
  for (const r of rows) {
    assert.ok(r.dims.momentum != null, 'the momentum dimension is still computed');
    assert.ok(r.delta3 != null, 'and elo_delta3 is still stored');
    assert.equal(r.compositeScored.includes('momentum'), false, 'but it is not in the composite');
  }
  assert.equal(rows.find((r) => r.teamId === 10).delta3, 200);
});

test('THE PRESEASON ANCHOR is a poll rank on the Elo scale, over the same field', () => {
  // rank 1 scores 10 in any field; 1500 + (10 - 5) * 40 = 1700.
  assert.equal(anchorElo(1, 138), 1700);
  assert.equal(anchorElo(1, 32), 1700);
  // It takes the PUBLISHED field like every other conversion: rank 25 of 138
  // is a good team and anchors above the start rating; rank 25 of 25 would be
  // the floor. The difference is the whole ruling.
  assert.ok(anchorElo(25, 138) > START_ELO_MID);
  assert.ok(anchorElo(25, 25) < START_ELO_MID);
  // OFF THE POLL IS NO ANCHOR, never a floor.
  assert.equal(anchorElo(null, 138), null);
  assert.equal(anchorElo(139, 138), null);
  assert.equal(anchorElo(0, 138), null);
});
const START_ELO_MID = 1500;

// ------------------------------------------ the field-size ruling, pinned

test('EVERY CURVE TAKES THE PUBLISHED FIELD SIZE, and the same rank scores identically through both', () => {
  // THE RULING. The AP's rank and the editor's rank are the same kind of
  // statement about the same board, so the same number must come out - the
  // only difference is who wrote it down.
  const teams = Array.from({ length: 138 }, (_, i) => ({
    id: i + 1, name: `T${i + 1}`, shortName: `T${i + 1}`, abbreviation: `T${i + 1}`, classification: 'fbs',
  }));
  assert.equal(publishedFieldSize(teams), 138);
  const N = publishedFieldSize(teams);
  const editor = buildEditorLayer({
    text: Array.from({ length: 25 }, (_, i) => `${i + 1} T${i + 1}`).join('\n'), teams,
  });
  for (const rank of [1, 2, 10, 20, 25]) {
    const viaEditor = editor.byTeam.get(rank).score;
    const viaAp = normalizeRankToScore(rank, N);
    assert.equal(viaEditor, viaAp, `rank ${rank} must score the same through both curves`);
  }
  // AND NEITHER CURVE IS EVER CALLED WITH THE LIST LENGTH. Rank 25 through a
  // field of 25 is 2.01 - the floor - which is the number that put the
  // editor's #20 at 97th of 138. Through the published field it is a good
  // score, and this asserts we are on the right side of that.
  assert.equal(normalizeRankToScore(25, 25), 2.01);
  assert.ok(editor.byTeam.get(25).score > 7, 'the editor\'s #25 is a top-18% team, not a floor one');
  assert.notEqual(editor.byTeam.get(25).score, normalizeRankToScore(25, 25));
  // The publishable field EXCLUDES the FCS pool's teams, because they are not
  // on the board the score is compared on.
  assert.equal(publishedFieldSize([...teams, { id: 999, classification: 'fcs' }]), 138);
  assert.equal(publishedFieldSize([]), 0);
});

test('SOURCE GUARD: no curve is handed a list length', () => {
  const src = readSource('lib/rankings/publishGridironEdition.js')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // Every call passes the derived field, never a literal and never a constant
  // named for one of the lists.
  const calls = [...src.matchAll(/normalizeRankToScore\(([^)]*)\)/g)].map((m) => m[1].trim());
  assert.ok(calls.length >= 3, 'the guard is reading real call sites');
  for (const c of calls) {
    assert.equal(/\b25\b|AP_FIELD_SIZE|EDITOR_FIELD_SIZE/.test(c), false,
      `normalizeRankToScore(${c}) is using a list length, not the published field`);
  }
  assert.equal(/AP_FIELD_SIZE|EDITOR_FIELD_SIZE/.test(src), false, 'the list-length constants are gone');
});

// ------------------------------------------------- the editor's list is a gate

test('THE GATE: the listed 25 fill 1-25 exactly, and the best unlisted team is 26', () => {
  // A 30-team field where the UNLISTED team has the best composite in it by a
  // mile. Without the gate it is rank 1; with it, 26.
  const teams = Array.from({ length: 30 }, (_, i) => ({
    id: i + 1, name: `T${i + 1}`, shortName: `T${i + 1}`, abbreviation: `T${i + 1}`, classification: 'fbs',
  }));
  // team 30 is rated far above everybody; teams 1-25 are the editor's list.
  const table = new Map(teams.map((t) => [t.id, seat(t.id === 30 ? 2000 : 1500 + t.id, [])]));
  const editor = buildEditorLayer({
    text: Array.from({ length: 25 }, (_, i) => `${i + 1} T${i + 1}`).join('\n'), teams,
  });
  const rows = buildEntries({
    table, teams, apByTeam: new Map(), editorByTeam: editor.byTeam,
    cfg: { ...LEAGUE_CONFIG.cfb, editorialWeight: 1, sitesWeight: 0 },
  });
  const byId = new Map(rows.map((r) => [r.teamId, r]));
  // THE UNLISTED LEADER IS 26, NOT 1 - the assertion this ruling exists for.
  assert.equal(byId.get(30).rank, 26);
  assert.equal(byId.get(30).editorRank, null);
  assert.ok(byId.get(30).score > byId.get(25).score, 'and it really does out-score the whole list');
  // THE LISTED 25 FILL 1-25 EXACTLY: twenty-five teams, every rank inside the
  // range, starting at 1, and nobody else in it. Not "every integer used" -
  // ties share, so a level pair leaves the next number unspent, which is the
  // documented behaviour and not a hole in the board.
  const listedRanks = rows.filter((r) => r.editorRank != null).map((r) => r.rank).sort((a, b) => a - b);
  assert.equal(listedRanks.length, 25);
  assert.equal(listedRanks[0], 1);
  assert.ok(listedRanks.at(-1) <= 25, `the list ends at ${listedRanks.at(-1)}, past its own range`);
  // and nobody unlisted is inside that range.
  for (const r of rows.filter((x) => x.editorRank == null)) assert.ok(r.rank >= 26, `${r.teamId} at ${r.rank}`);
  // WITHIN the list the order is the COMPOSITE's, not the editor's - which is
  // where the model gets its say under the gate. Asserted as a property of the
  // band rather than as a named team, because the composite blends the Elo
  // z-score with the editor's own rank and the winner of that is not something
  // a reader should have to take on trust from a fixture.
  const listed = rows.filter((r) => r.editorRank != null);
  for (let i = 1; i < listed.length; i += 1) {
    assert.ok(listed[i - 1].score >= listed[i].score, 'the listed band is ordered by composite');
    assert.ok(listed[i - 1].rank <= listed[i].rank);
  }
  // The editor's order is NOT simply reproduced - if it were, the model would
  // have no say inside the band at all and the composite would be decoration.
  assert.notDeepEqual(listed.map((r) => r.editorRank), listed.map((r) => r.rank));
});

test('THE GATE: ties share inside each band, and a tie in the top band does not promote anybody', () => {
  // THE BANDING RULE ON ITS OWN, with the scores written down. Going through
  // buildEntries would mean constructing Elo ratings whose z-scores AND editor
  // curve scores happen to average to the same number, which tests the fixture
  // rather than the rule.
  const rows = [
    { teamId: 1, score: 9 }, { teamId: 2, score: 9 },     // listed, level
    { teamId: 3, score: 8 }, { teamId: 4, score: 8 },     // unlisted, level
    { teamId: 5, score: 7 },                              // unlisted
  ];
  const ranked = rankBySort(rows, { listed: new Set([1, 2]) });
  const byId = new Map(ranked.map((r) => [r.teamId, r.rank]));
  assert.equal(byId.get(1), 1); assert.equal(byId.get(2), 1);
  // THE SECOND BAND STARTS AT listed.length + 1 AND NOT AT 2. The tie ended
  // the first band early; if the counter simply carried on, an unlisted team
  // would land at rank 2 - inside the list's range, which is the one thing the
  // gate exists to prevent.
  assert.equal(byId.get(3), 3); assert.equal(byId.get(4), 3);
  assert.equal(byId.get(5), 5, 'and the shared rank still consumes its slot inside the band');
  // AN UNLISTED TEAM OUT-SCORING THE WHOLE LIST STILL STARTS AT THE BAND EDGE.
  const inverted = rankBySort(
    [{ teamId: 1, score: 2 }, { teamId: 9, score: 99 }], { listed: new Set([1]) },
  );
  assert.deepEqual(inverted.map((r) => [r.teamId, r.rank]), [[1, 1], [9, 2]]);
});

test('NO LIST IS NO GATE - the NFL board ranks from 1 by composite, as before', () => {
  const rows = [{ teamId: 4, score: 6 }, { teamId: 1, score: 9 }, { teamId: 3, score: 8 }, { teamId: 2, score: 8 }];
  assert.deepEqual(rankBySort(rows).map((r) => [r.teamId, r.rank]), [[1, 1], [2, 2], [3, 2], [4, 4]]);
  assert.deepEqual(rankBySort(rows, { listed: new Set() }).map((r) => r.rank), [1, 2, 2, 4]);
  assert.deepEqual(rankBySort(rows, { listed: null }).map((r) => r.rank), [1, 2, 2, 4]);
});
