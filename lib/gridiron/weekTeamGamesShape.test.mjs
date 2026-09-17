// lib/gridiron/weekTeamGamesShape.test.mjs - the per-team game value the
// Weekly's slot lines are built from, and the period code they print.
//
// WHY THIS FILE EXISTS. weekTeamGames() kept three fields off a slate row that
// carries seven useful ones, so a Weekly slot could say "Q3 7:28" but not who
// the player's team was playing, and a final could not say the score it ended
// on. The mock draws both. Nothing new is queried - readers.js:196 already
// selects home_score, away_score and both abbreviations - so this pins the
// SHAPE, which is the only thing that changed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveLabelOf, livePartsOf } from './liveLabel.js';

// ---------------------------------------------------------------------------
// THE PERIOD CODE, VIA shortOf
// ---------------------------------------------------------------------------

const live = (period, clock, extra = {}) => ({ live_state: { period, clock, ...extra } });

test('an ordinary quarter reads as the scoreboard reads it', () => {
  assert.equal(liveLabelOf('live', live(3, '7:28')), 'Live · Q3 7:28');
  assert.deepEqual(livePartsOf('live', live(3, '7:28')), { period: 'Q3', clock: '7:28' });
});

test('HALFTIME IS "HT", AND CARRIES NO CLOCK - it used to read "Q2 00:00"', () => {
  assert.equal(liveLabelOf('live', live(2, '00:00')), 'Live · HT');
  assert.deepEqual(livePartsOf('live', live(2, '00:00')), { period: 'HT', clock: null });
  // the other spelling the feed uses
  assert.equal(liveLabelOf('live', live(2, '0:00')), 'Live · HT');
  // and a second quarter that is actually being played is still Q2
  assert.equal(liveLabelOf('live', live(2, '0:42')), 'Live · Q2 0:42');
});

test('OVERTIME IS "OT", NOT "Q5" - the raw integer was wrong past four', () => {
  assert.equal(liveLabelOf('live', live(5, '2:11')), 'Live · OT 2:11');
  assert.deepEqual(livePartsOf('live', live(5, '2:11')), { period: 'OT', clock: '2:11' });
  assert.equal(liveLabelOf('live', live(6, '9:00')), 'Live · OT 9:00', 'a second OT is still OT');
});

test('LIVE WITH NO CLOCK: the period stands alone', () => {
  assert.equal(liveLabelOf('live', live(1, null)), 'Live · Q1');
  assert.deepEqual(livePartsOf('live', live(1, null)), { period: 'Q1', clock: null });
  assert.equal(liveLabelOf('live', live(1, '')), 'Live · Q1', 'an empty string is not a clock');
});

test('LIVE WITH NO PERIOD AT ALL falls back to the bare word', () => {
  assert.equal(liveLabelOf('live', { live_state: null }), 'Live');
  assert.equal(liveLabelOf('live', {}), 'Live');
  assert.equal(liveLabelOf('live', null), 'Live');
  assert.deepEqual(livePartsOf('live', null), { period: null, clock: null });
});

test('a game that is not live has no label and no parts', () => {
  for (const st of ['scheduled', 'final', 'postponed', null]) {
    assert.equal(liveLabelOf(st, live(3, '7:28')), null, String(st));
    assert.deepEqual(livePartsOf(st, live(3, '7:28')), { period: null, clock: null });
  }
});

test('the feed\'s own short code wins over the integer', () => {
  // shortOf honours live_state.short when the provider sends one.
  assert.equal(liveLabelOf('live', live(4, '0:00', { short: 'F/OT' })), 'Live · F/OT 0:00');
});

// ---------------------------------------------------------------------------
// THE MAP VALUE, ORIENTED TO THE KEYED TEAM
// ---------------------------------------------------------------------------
// weekTeamGames itself reads the database; the orientation rule it applies is
// what the slot lines depend on, so it is asserted here against the exact
// slate-row shape getWeekSlate returns (lib/gridiron/readers.js:28-64).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

/** The mapper inside weekTeamGames, applied to one slate game. */
function mapOf(g) {
  const out = new Map();
  for (const t of [g.home, g.away]) {
    const a = t?.abbreviation ?? null;
    if (!a) continue;
    const isHome = t === g.home;
    const other = isHome ? g.away : g.home;
    out.set(a, {
      status: g.status,
      metadata: { live_state: g.liveState ?? null },
      kickoffAt: g.kickoffAt,
      opp: other?.abbreviation ?? null,
      home: isHome,
      score: isHome ? g.homeScore ?? null : g.awayScore ?? null,
      oppScore: isHome ? g.awayScore ?? null : g.homeScore ?? null,
    });
  }
  return out;
}

const FINAL = {
  status: 'final', kickoffAt: '2026-09-18T00:15:00.000Z', liveState: null,
  homeScore: 31, awayScore: 24,
  home: { abbreviation: 'BUF' }, away: { abbreviation: 'DET' },
};

test('BOTH SIDES OF ONE GAME, each reading its own way round', () => {
  const m = mapOf(FINAL);
  assert.deepEqual(m.get('BUF'), {
    status: 'final', metadata: { live_state: null }, kickoffAt: FINAL.kickoffAt,
    opp: 'DET', home: true, score: 31, oppScore: 24,
  });
  assert.deepEqual(m.get('DET'), {
    status: 'final', metadata: { live_state: null }, kickoffAt: FINAL.kickoffAt,
    opp: 'BUF', home: false, score: 24, oppScore: 31,
  });
});

test('THE SLOT LINE THE MOCK DRAWS, from that value alone', () => {
  const m = mapOf(FINAL);
  const line = (tm, g) => `${tm} · Final ${g.score}-${g.oppScore}`;
  assert.equal(line('BUF', m.get('BUF')), 'BUF · Final 31-24');
  assert.equal(line('DET', m.get('DET')), 'DET · Final 24-31');
  // and the open/live forms, which need opp + home and nothing else
  const vs = (g) => (g.home ? 'vs' : 'at');
  assert.equal(`BUF ${vs(m.get('BUF'))} ${m.get('BUF').opp}`, 'BUF vs DET');
  assert.equal(`DET ${vs(m.get('DET'))} ${m.get('DET').opp}`, 'DET at BUF');
});

test('NULL, NEVER 0, BEFORE A GAME IS SCORED', () => {
  const m = mapOf({ ...FINAL, status: 'scheduled', homeScore: null, awayScore: null });
  assert.equal(m.get('BUF').score, null, 'a 0-0 at 1pm Sunday is a wrong number, not a low one');
  assert.equal(m.get('BUF').oppScore, null);
  assert.equal(m.get('BUF').opp, 'DET', 'the opponent is known long before the score');
});

test('an unresolved team is skipped rather than keyed on null', () => {
  const m = mapOf({ ...FINAL, away: { abbreviation: null } });
  assert.equal(m.size, 1);
  assert.equal(m.get('BUF').opp, null, 'and the other side simply has no name to print');
});

test('NO NEW QUERY: every field comes off columns getWeekSlate already selects', () => {
  const readers = src('lib/gridiron/readers.js');
  for (const col of ['m.home_score, m.away_score', 'h.abbreviation AS home_abbr', 'a.abbreviation AS away_abbr']) {
    assert.ok(readers.includes(col), `readers.js already selects ${col}`);
  }
  const todayV2 = src('lib/gridiron/todayV2.js');
  assert.match(todayV2, /const slate = await getWeekSlate\(sport, seasonYear, 'REG', week\)/,
    'and weekTeamGames still makes exactly one read');
  assert.equal((todayV2.match(/await sql`/g) ?? []).length > 0, todayV2.includes('await sql`'),
    'no raw query was added to this function');
});
