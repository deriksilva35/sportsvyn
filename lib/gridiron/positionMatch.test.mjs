// lib/gridiron/positionMatch.test.mjs - the four resolution rules, in order.
//
// PURE. Candidates in, a decision out - no database, no nflverse fetch. The
// resolution ORDER is the design, and an order you can only exercise against a
// 17,000-row table is an order nobody checks. Every fixture below is a real
// case the ten-season import actually hit.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  resolveOne, normalizeSuffixAware, normalizeSuffixStripped,
  toOurPosition, profileOf, profileAgrees,
} = await import('./positionMatch.js');

const totals = ({ pass = 0, rush = 0, rec = 0, fga = 0 } = {}) =>
  ({ pass_att: pass, rush_att: rush, rec, fga });

// ---------------------------------------------------------------------------
// Normalization + the suffix rule
// ---------------------------------------------------------------------------

test('suffix-aware normalization KEEPS the suffix; stripped removes one - including V', () => {
  assert.equal(normalizeSuffixAware('Michael Carter II'), 'michael carter ii');
  assert.equal(normalizeSuffixStripped('Michael Carter II'), 'michael carter');
  // V is the one normalizeName() in nameMatch.js does NOT strip, which is how
  // William Fuller V and David Sills V reached the exit gate's miss list.
  assert.equal(normalizeSuffixStripped('William Fuller V'), 'william fuller');
  assert.equal(normalizeSuffixStripped('Jeff Wilson Jr.'), 'jeff wilson');
  assert.equal(normalizeSuffixStripped('Robert Griffin III'), 'robert griffin');
  // Only ONE suffix, and only a real one - "Vick" must not lose its tail.
  assert.equal(normalizeSuffixStripped('Mike Vick'), 'mike vick');
});

test('normalization is diacritic- and punctuation-blind', () => {
  assert.equal(normalizeSuffixAware("De'Von Achane"), 'devon achane');
  assert.equal(normalizeSuffixAware('Amon-Ra St. Brown'), 'amon ra st brown');
});

test('vocabulary: K -> PK, FB -> RB, QB/RB/WR/TE through, rest as-is', () => {
  assert.equal(toOurPosition('K'), 'PK');
  assert.equal(toOurPosition('FB'), 'RB');
  for (const p of ['QB', 'RB', 'WR', 'TE']) assert.equal(toOurPosition(p), p);
  assert.equal(toOurPosition('OLB'), 'OLB', 'the puzzle reads only the five; inventing a mapping would invent a fact');
  assert.equal(toOurPosition(''), null);
});

// ---------------------------------------------------------------------------
// RULE 1 - OVERRIDE
// ---------------------------------------------------------------------------

test('RULE 1 OVERRIDE: a confirmed mapping wins even when the name does not match at all', () => {
  // The real case: BDL calls him Hollywood Brown, nflverse has no such spelling
  // anywhere. No name rule can reach him; only the override can.
  const overrides = new Map([['hollywood brown', { gsis: '00-0035662' }]]);
  const nv = { name: 'Marquise Brown', gsis: '00-0035662', position: 'WR', teams: new Set(['BAL']) };
  const candidates = [{ id: 7, fullName: 'Hollywood Brown', teams: ['BAL'], totals: totals({ rec: 46 }) }];
  const r = resolveOne(nv, candidates, overrides);
  assert.equal(r.ok, true);
  assert.equal(r.rule, 'override');
  assert.equal(r.playerId, 7);
});

test('RULE 1 OVERRIDE: it must be the SAME player - a matching name with a different gsis is ignored', () => {
  const overrides = new Map([['hollywood brown', { gsis: '00-0035662' }]]);
  const nv = { name: 'Antonio Brown', gsis: '00-0000001', position: 'WR', teams: new Set(['BAL']) };
  const candidates = [{ id: 7, fullName: 'Hollywood Brown', teams: ['BAL'], totals: totals({ rec: 46 }) }];
  assert.equal(resolveOne(nv, candidates, overrides).ok, false, 'the override is keyed on gsis, not just the name');
});

// ---------------------------------------------------------------------------
// RULE 2 - UNIQUE, and the suffix-aware-then-fallback ORDER
// ---------------------------------------------------------------------------

test('RULE 2 UNIQUE: exactly one name match resolves', () => {
  const nv = { name: 'Dalvin Cook', gsis: 'g1', position: 'RB', teams: new Set(['MIN']) };
  const r = resolveOne(nv, [{ id: 1, fullName: 'Dalvin Cook', teams: ['MIN'], totals: totals({ rush: 250 }) }]);
  assert.equal(r.ok, true);
  assert.equal(r.rule, 'unique');
  assert.equal(r.via, 'aware', 'the suffix-aware pass should have matched outright');
});

test('SUFFIX ORDER: suffix-aware is tried FIRST, so a suffix is not silently collapsed', () => {
  // Both Carters present. "Michael Carter II" must find the II, not the RB.
  const candidates = [
    { id: 1, fullName: 'Michael Carter', teams: ['NYJ'], totals: totals({ rush: 147, rec: 36 }) },
    { id: 2, fullName: 'Michael Carter II', teams: ['NYJ'], totals: totals() },
  ];
  const r = resolveOne({ name: 'Michael Carter II', gsis: 'g2', position: 'CB', teams: new Set(['NYJ']) }, candidates);
  assert.equal(r.ok, true);
  assert.equal(r.playerId, 2, 'suffix-aware must win before anything strips the II');
  assert.equal(r.via, 'aware');
});

test('SUFFIX FALLBACK: stripped comparison runs ONLY when suffix-aware found nothing', () => {
  // BDL says "Jeff Wilson Jr.", nflverse says "Jeff Wilson". Aware finds
  // nothing, stripped finds one.
  const candidates = [{ id: 3, fullName: 'Jeff Wilson Jr.', teams: ['SF'], totals: totals({ rush: 100 }) }];
  const r = resolveOne({ name: 'Jeff Wilson', gsis: 'g3', position: 'RB', teams: new Set(['SF']) }, candidates);
  assert.equal(r.ok, true);
  assert.equal(r.rule, 'unique');
  assert.equal(r.via, 'stripped', 'the loose pass is the fallback, never the first move');
});

// ---------------------------------------------------------------------------
// RULE 3 - TEAM
// ---------------------------------------------------------------------------

test('RULE 3 TEAM: a collision breaks on the team the STAT ROWS say he played for', () => {
  const candidates = [
    { id: 10, fullName: 'Steve Smith', teams: ['BAL'], totals: totals({ rec: 79 }) },
    { id: 11, fullName: 'Steve Smith', teams: ['NYG'], totals: totals({ rec: 11 }) },
  ];
  const r = resolveOne({ name: 'Steve Smith', gsis: 'g4', position: 'WR', teams: new Set(['BAL']) }, candidates);
  assert.equal(r.ok, true);
  assert.equal(r.rule, 'team');
  assert.equal(r.playerId, 10);
});

test('RULE 3 TEAM: a mid-season trade still matches - stint teams are a SET', () => {
  const candidates = [
    { id: 20, fullName: 'Vernon Davis', teams: ['SF', 'DEN'], totals: totals({ rec: 38 }) },
    { id: 21, fullName: 'Vernon Davis', teams: ['WSH'], totals: totals({ rec: 4 }) },
  ];
  const r = resolveOne({ name: 'Vernon Davis', gsis: 'g5', position: 'TE', teams: new Set(['DEN']) }, candidates);
  assert.equal(r.playerId, 20, 'the second stint of a traded player must still count');
});

// ---------------------------------------------------------------------------
// RULE 4 - PROFILE (the Michael Carter case)
// ---------------------------------------------------------------------------

test('profileOf reads the SHAPE of a stat line, coarsely and on purpose', () => {
  assert.equal(profileOf(totals({ pass: 500, rush: 40 })), 'QB');
  assert.equal(profileOf(totals({ rush: 200, rec: 30 })), 'RB');
  assert.equal(profileOf(totals({ rec: 90 })), 'WR/TE', 'the box score cannot split WR from TE');
  assert.equal(profileOf(totals({ fga: 30 })), 'PK');
  assert.equal(profileOf(totals()), null, 'no offensive shape to read');
});

test('RULE 4 PROFILE: same name, SAME TEAM, same seasons - only the stat shape separates them', () => {
  // Michael Carter (RB) and Michael Carter II (CB) were both Jets in 2021-2022.
  // Team cannot break this. A running back has carries; a corner does not.
  const candidates = [
    { id: 30, fullName: 'Michael Carter', teams: ['NYJ'], totals: totals({ rush: 147, rec: 36 }) },
    { id: 31, fullName: 'Michael Carter', teams: ['NYJ'], totals: totals() },
  ];
  const rb = resolveOne({ name: 'Michael Carter', gsis: 'g6', position: 'RB', teams: new Set(['NYJ']) }, candidates);
  assert.equal(rb.ok, true);
  assert.equal(rb.rule, 'profile');
  assert.equal(rb.playerId, 30, 'the one with carries is the running back');
});

test('RULE 4 PROFILE: WR and TE are NOT separated by profile - the box score cannot', () => {
  const candidates = [
    { id: 40, fullName: 'Mike Williams', teams: ['LAC'], totals: totals({ rec: 60 }) },
    { id: 41, fullName: 'Mike Williams', teams: ['LAC'], totals: totals({ rec: 20 }) },
  ];
  const r = resolveOne({ name: 'Mike Williams', gsis: 'g7', position: 'WR', teams: new Set(['LAC']) }, candidates);
  assert.equal(r.ok, false, 'both look like WR/TE, so the rule must refuse rather than pick');
  assert.match(r.reason, /profile did not separate/);
});

test('RULE 4 fallback: birth date separates when the profile cannot', () => {
  const candidates = [
    { id: 50, fullName: 'Chris Thompson', teams: ['WSH'], totals: totals({ rec: 39 }), birthDate: '1990-10-20' },
    { id: 51, fullName: 'Chris Thompson', teams: ['WSH'], totals: totals({ rec: 12 }), birthDate: '1995-01-01' },
  ];
  const r = resolveOne(
    { name: 'Chris Thompson', gsis: 'g8', position: 'WR', teams: new Set(['WSH']), birthDate: '1995-01-01' },
    candidates,
  );
  assert.equal(r.ok, true);
  assert.equal(r.playerId, 51);
});

// ---------------------------------------------------------------------------
// RULE 5 - REFUSE
// ---------------------------------------------------------------------------

test('RULE 5 REFUSE: no name match is refused, not guessed', () => {
  const r = resolveOne({ name: 'Nobody At All', gsis: 'g9', position: 'WR', teams: new Set(['KC']) },
    [{ id: 60, fullName: 'Patrick Mahomes', teams: ['KC'], totals: totals({ pass: 580 }) }]);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no name match');
  assert.equal(r.candidates, 0);
});

test('RULE 5 REFUSE: an unbreakable ambiguity reports HOW MANY it could not separate', () => {
  const candidates = [
    { id: 70, fullName: 'Brandon Williams', teams: ['BAL'], totals: totals() },
    { id: 71, fullName: 'Brandon Williams', teams: ['BAL'], totals: totals() },
  ];
  const r = resolveOne({ name: 'Brandon Williams', gsis: 'ga', position: 'DT', teams: new Set(['BAL']) }, candidates);
  assert.equal(r.ok, false);
  assert.equal(r.candidates, 2);
});

// ---------------------------------------------------------------------------
// THE MULTI-SPELLING JOIN
// ---------------------------------------------------------------------------

test('THE GSIS JOIN: a player nflverse spells two ways is reachable by either', () => {
  // roster_2020.csv says "Nick Westbrook"; players.csv says
  // "Nick Westbrook-Ikhine". 4% of 2020 roster rows differ this way, so the
  // import joins roster -> players BY GSIS and tries every spelling. Each one
  // must resolve on its own.
  const candidates = [{ id: 80, fullName: 'Nick Westbrook-Ikhine', teams: ['TEN'], totals: totals({ rec: 4 }) }];
  const nv = { gsis: 'gb', position: 'WR', teams: new Set(['TEN']) };
  for (const spelling of ['Nick Westbrook-Ikhine', 'Nick Westbrook']) {
    const r = resolveOne({ ...nv, name: spelling }, candidates);
    assert.equal(r.ok, spelling === 'Nick Westbrook-Ikhine', `spelling: ${spelling}`);
  }
  // The current spelling matches; the historical one does not, which is exactly
  // why the caller tries BOTH rather than picking one file to trust.
});

test('profileAgrees maps our vocabulary before comparing', () => {
  assert.equal(profileAgrees('K', totals({ fga: 20 })), true, 'nflverse K vs our PK');
  assert.equal(profileAgrees('FB', totals({ rush: 30 })), true, 'FB folds to RB');
  assert.equal(profileAgrees('TE', totals({ rec: 40 })), true);
  assert.equal(profileAgrees('CB', totals({ rush: 200 })), false);
});
