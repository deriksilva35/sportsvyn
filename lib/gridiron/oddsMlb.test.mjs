// lib/gridiron/oddsMlb.test.mjs - the MLB odds leg (thu-28): postseason only,
// h2h + totals, one region, 13:00Z and 21:00Z; the card shows "PHI -135 · O/U 7.5".
// Run: node --test lib/gridiron/oddsMlb.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { legDue } from './oddsLegs.js';
import { phasesFor } from './oddsJoin.js';
import { SPORT_KEYS, SPORT_MARKETS } from '../theOddsApi.js';
import { moneylineText, oddsLine } from './scoresV2Shape.js';
import { oddsFoot } from '../scores/v4.js';
import { SPEND_SOURCE_RE } from './oddsBudget.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (r) => readFileSync(path.join(REPO, r), 'utf8');
const at = (iso) => new Date(iso);

test('THE CLOCK: the MLB leg runs at the top of 13:00Z and 21:00Z and at no other tick', () => {
  const mlb = { sport: 'mlb', hours: [13, 21] };
  assert.equal(legDue(mlb, at('2026-10-02T13:00:30Z')), true);
  assert.equal(legDue(mlb, at('2026-10-02T21:14:59Z')), true);
  assert.equal(legDue(mlb, at('2026-10-02T13:15:00Z')), false, 'the next tick of the same hour is not a second run');
  assert.equal(legDue(mlb, at('2026-10-02T23:45:00Z')), false, 'a tight window elsewhere does not run it');
  assert.equal(legDue({ sport: 'nfl' }, at('2026-10-02T23:45:00Z')), true, 'a leg with no clock keeps the cron rhythm');
});

test('THE BUY: baseball_mlb, h2h + totals only, one region - 2 credits a call', () => {
  assert.equal(SPORT_KEYS.mlb, 'baseball_mlb');
  assert.equal(SPORT_MARKETS.mlb, 'h2h,totals');
  const api = src('lib/theOddsApi.js');
  assert.match(api, /\/odds\?regions=us&markets=\$\{markets\}&oddsFormat=decimal/, 'one region, the markets passed through');
  assert.match(src('lib/gridiron/oddsIngest.js'), /fetchSportOdds\(sportKey, SPORT_MARKETS\[sport\]/);
  assert.equal(SPEND_SOURCE_RE.test('mlb-odds'), true, 'the budget counts it');
});

test('POSTSEASON ONLY: the join reads POST games for MLB, REG + POST for everything else', () => {
  assert.deepEqual(phasesFor('mlb'), ['POST']);
  assert.deepEqual(phasesFor('nfl'), ['REG', 'POST']);
  assert.match(src('lib/gridiron/oddsJoin.js'), /season_phase = ANY\(\$\{phasesFor\(sport\)\}::text\[\]\)/);
});

test('THE CRON: the leg is wired on its clock and opens no tight window for the others', () => {
  const r = src('app/api/cron/gridiron-odds/route.js');
  assert.match(r, /\{ sport: 'mlb', slug: 'mlb', source: 'mlb-odds', futures: false, hours: \[13, 21\] \}/);
  assert.match(r, /const SLUGS = LEAGUES\.filter\(\(l\) => !l\.hours\)/);
  assert.match(r, /for \(const lg of LEAGUES\) \{\n {4}if \(!legDue\(lg, now\)\) continue;/);
});

const g = { home: { abbreviation: 'ATL' }, away: { abbreviation: 'PHI' } };
const ml = { home: { american: 115, implied: 45.5 }, away: { american: -135, implied: 54.5 } };

test('THE CARD: the favourite and its price, then the total', () => {
  assert.equal(moneylineText(g, ml), 'PHI -135');
  assert.equal(moneylineText(g, { home: { american: -110, implied: 50.1 }, away: { american: -110, implied: 49.9 } }), 'ATL -110');
  assert.equal(moneylineText(g, { home: { american: 120, implied: 44 }, away: null }), null, 'one side is no line');
  assert.equal(oddsFoot(g, { moneyline: ml, total: 7.5 }), 'PHI -135 · O/U 7.5');
  assert.equal(oddsFoot(g, { moneyline: ml }), 'PHI -135');
  assert.equal(oddsFoot(g, {}), null, 'no line yet stays the card\'s own words');
  assert.equal(oddsLine(g, null, 7.5, ml), 'PHI -135 · O/U 7.5');
  assert.equal(oddsFoot(g, { spreadHome: -3, total: 44.5 }), 'ATL -3 · 44.5', 'football is unchanged');
});

test('THE READ: scores asks for moneylines only for MLB games still to play', () => {
  const s = src('lib/gridiron/scoresV2.js');
  assert.match(s, /g\.leagueSlug === 'mlb' && g\.status === 'scheduled'/);
  assert.match(s, /getH2hOdds\(mlbOpen\)/);
  assert.match(src('components/scores/ScoreboardV4.js'), /moneyline: x\.moneyline \?\? null/);
});
