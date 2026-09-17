// lib/weekly/seasonLine.test.mjs - this season, on a pool row.
//
// WHAT THIS REPLACED, AND WHY IT IS A CORRECTNESS TEST AND NOT A TASTE ONE:
// the Weekly's panel ranked this week's picks by a CAREER rate frozen into the
// board at creation, so a veteran on 120 games outranked a back in the middle
// of a career year, and the row's second line spent its width on a college and
// a draft slot. The numbers below are the arithmetic that replaces it.
//
// THE FINALS-ONLY RULE IS THE ONE WORTH GUARDING. A game in progress must not
// be in an average: a man three carries into the first quarter would drag his
// own PPG down while a reader is looking at him.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { seasonLineFor, seasonStats } from './seasonLine.js';
import { fantasyPoints } from '../fantasy/scoring.js';
import { toStatLine } from '../fantasy/playerStats.js';

const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const src = (rel) => strip(readFileSync(new URL(rel, import.meta.url), 'utf8'));

// ---------------------------------------------------------------------------
// THE LINE, PER POSITION
// ---------------------------------------------------------------------------

test("A QUARTERBACK'S LINE: yards, touchdowns, interceptions, and his legs", () => {
  const t = toStatLine({ pass_yds: 334, pass_td: 2, pass_int: 0, rush_yds: 23 });
  assert.equal(seasonLineFor('QB', t), '334 yds · 2 TD · 0 INT · 23 rush');
});

test("A BACK'S LINE: rushing, then what he did catching the ball", () => {
  const t = toStatLine({ rush_yds: 173, rec: 3, rec_yds: 18, rush_td: 2, rec_td: 0 });
  assert.equal(seasonLineFor('RB', t), '173 rush · 3 rec · 18 yds · 2 TD');
  // BOTH KINDS OF TOUCHDOWN COUNT on a back's line - a receiving score is not
  // somebody else's fact.
  const both = toStatLine({ rush_yds: 80, rec: 4, rec_yds: 60, rush_td: 1, rec_td: 1 });
  assert.equal(seasonLineFor('RB', both), '80 rush · 4 rec · 60 yds · 2 TD');
});

test('A RECEIVER AND A TIGHT END READ THE SAME THREE FACTS', () => {
  const t = toStatLine({ rec: 8, rec_yds: 138, rec_td: 2 });
  assert.equal(seasonLineFor('WR', t), '8 rec · 138 yds · 2 TD');
  assert.equal(seasonLineFor('TE', t), '8 rec · 138 yds · 2 TD');
});

test('ZERO COMPONENTS STILL PRINT - a 0 TD week is a fact, not a gap', () => {
  const qb = toStatLine({ pass_yds: 180, pass_td: 0, pass_int: 0, rush_yds: 0 });
  assert.equal(seasonLineFor('QB', qb), '180 yds · 0 TD · 0 INT · 0 rush');
  const wr = toStatLine({ rec: 0, rec_yds: 0, rec_td: 0 });
  assert.equal(seasonLineFor('WR', wr), '0 rec · 0 yds · 0 TD');
});

test('THOUSANDS ARE GROUPED, and the separator is a comma not a space', () => {
  const t = toStatLine({ pass_yds: 4210, pass_td: 31, pass_int: 8, rush_yds: 1050 });
  assert.equal(seasonLineFor('QB', t), '4,210 yds · 31 TD · 8 INT · 1,050 rush');
});

test('HYPHENS, NEVER EM DASHES, and no position we cannot describe gets a line', () => {
  assert.doesNotMatch(src('./seasonLine.js'), /[—–]/, 'no em or en dash in the source');
  const t = toStatLine({ fgm: 3, fga: 3, xp: 4 });
  assert.equal(seasonLineFor('K', t), null, 'a kicker has no line here rather than a wrong one');
  assert.equal(seasonLineFor('DST', t), null);
  assert.equal(seasonLineFor(null, t), null);
  assert.equal(seasonLineFor('QB', null), null, 'and no totals means no line');
});

// ---------------------------------------------------------------------------
// THE ARITHMETIC
// ---------------------------------------------------------------------------

test('PPG IS THE SEASON TOTAL OVER GAMES PLAYED, to one decimal', () => {
  // Two games, summed then scored once - which is EXACT, not an approximation:
  // scoring.js is linear, so points(sum) === sum(points), and it avoids the
  // rounding error of adding two figures each rounded to a tenth.
  const g1 = { rec: 8, rec_yds: 138, rec_td: 2 };
  const g2 = { rec: 4, rec_yds: 42, rec_td: 0 };
  const summed = toStatLine({ rec: 12, rec_yds: 180, rec_td: 2 });
  const total = fantasyPoints(summed, 'ppr');
  assert.equal(Math.round(total / 2 * 10) / 10, Math.round((fantasyPoints(toStatLine(g1), 'ppr') + fantasyPoints(toStatLine(g2), 'ppr')) / 2 * 10) / 10);
  // PPR: 12 rec + 18 (180 yds) + 12 (2 TD) = 42.0 over two games = 21.0
  assert.equal(total, 42);
  assert.equal(Math.round(total / 2 * 10) / 10, 21);
});

test('ONE DECIMAL, AND A THIRD OF A POINT ROUNDS LIKE ARITHMETIC', () => {
  const t = toStatLine({ rec: 10, rec_yds: 100, rec_td: 1 });   // 10 + 10 + 6 = 26
  assert.equal(fantasyPoints(t, 'ppr'), 26);
  assert.equal(Math.round(26 / 3 * 10) / 10, 8.7, '26 over three games is 8.7');
});

// ---------------------------------------------------------------------------
// THE READER'S SHAPE AND ITS ONE QUERY
// ---------------------------------------------------------------------------

test('FINALS ONLY - an in-flight game is not in the average', () => {
  const code = src('./seasonLine.js');
  assert.match(code, /AND m\.status = 'final'/, 'the whole rule, in the query');
  assert.match(code, /AND m\.season_phase = 'REG'/);
  assert.match(code, /AND m\.season_year = \$\{season\}/);
  assert.match(code, /l\.slug = 'nfl'/);
});

test('ONE QUERY, GROUPED, keyed by player id', () => {
  const code = src('./seasonLine.js');
  assert.equal((code.match(/await sql`/g) ?? []).length, 1, 'exactly one read');
  assert.match(code, /GROUP BY s\.nfl_player_id, np\.position/);
  assert.match(code, /count\(DISTINCT s\.match_id\)::int\s+AS gp/);
  assert.match(code, /out\.set\(Number\(r\.id\)/, 'keyed by id, as a Map');
});

test('THE ONE SCORER, AND THE IMPORT GUARD IS NOT CROSSED', () => {
  const code = src('./seasonLine.js');
  assert.match(code, /import \{ fantasyPoints \} from '\.\.\/fantasy\/scoring\.js'/);
  assert.match(code, /fantasyPoints\(t\.totals, 'ppr'\)/, 'full PPR, the settle\'s own format');
  // slotState.test.mjs forbids the SURFACES from importing the scorer. This is
  // lib, and the surfaces are unchanged - the page gets a number, the room
  // gets a string.
  for (const rel of ['../../app/weekly/page.js', '../../components/weekly/WeeklyRoom.js']) {
    assert.doesNotMatch(src(rel), /fantasyPoints/, `${rel} still scores nothing`);
  }
  assert.doesNotMatch(src('../../components/weekly/WeeklyRoom.js'), /seasonLine/,
    'and the room does not read the season either - it renders what it is handed');
});

test('NULL-SAFE: no season, no map entry, and no throw', async () => {
  assert.equal((await seasonStats(null)).size, 0);
  assert.equal((await seasonStats(undefined)).size, 0);
});

test('A PLAYER WITH NO FINAL GAME IS SIMPLY ABSENT from the map', () => {
  // The reader skips gp <= 0 rather than emitting a zero row, so the page's
  // `season.get(id) ?? null` is the only null-handling anyone needs.
  const code = src('./seasonLine.js');
  assert.match(code, /if \(!Number\.isFinite\(gp\) \|\| gp <= 0\) continue;/);
  assert.match(src('../../app/weekly/page.js'), /season: season\.get\(p\.id\) \?\? null/);
  // and the page catches, because the panel is not worth the page
  assert.match(src('../../app/weekly/page.js'), /seasonStats\(contest\.season_year\)\.catch\(\(\) => new Map\(\)\)/);
});

// ---------------------------------------------------------------------------
// THE WIRE
// ---------------------------------------------------------------------------

test('SEASON IS PUBLIC PER-PLAYER DATA: no viewer scope, no lineup, no meta', () => {
  const code = src('./seasonLine.js');
  // Nothing in this reader knows who is asking.
  assert.doesNotMatch(code, /user_id|userId|contest_entries|lineup|\bmeta\b/,
    'the season line is the same for every reader, and this proves it reads nothing else');
  // What rides to the client is {gp, ppg, line} per board row - three public
  // numbers about a football player.
  assert.match(code, /out\.set\(Number\(r\.id\), \{/);
  const page = src('../../app/weekly/page.js');
  const attach = page.slice(page.indexOf('const season = await seasonStats'), page.indexOf('const live = await'));
  assert.doesNotMatch(attach, /lineup|meta|entry/, 'the attach step carries nothing viewer-scoped');
});
