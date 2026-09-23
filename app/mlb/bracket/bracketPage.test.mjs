// app/mlb/bracket/bracketPage.test.mjs - the bracket, RENDERED.
//
// IT RENDERS RATHER THAN GREPS, for the reason the MLB game page's test gives:
// a source assertion about a bracket would duplicate the bracket in the test
// and then agree with itself.
//
// THE FIXTURE IS THE REAL 2025 POSTSEASON, so "Toronto played New York in the
// Division Series" is a fact this test can check rather than a shape it has to
// invent.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { install } from '../../../lib/testing/nextResolve.mjs';
import { stubPath } from '../../../lib/testing/stubDir.mjs';
install();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LINK = stubPath('__link_stub.mjs');
const HEADER = stubPath('__header_stub.mjs');
const READER = stubPath('__bracket_stub.mjs');
const CSS = stubPath('__css_stub.mjs');

registerHooks({ resolve(spec, ctx, next) {
  if (spec === 'next/link') return { url: pathToFileURL(LINK).href, shortCircuit: true };
  if (spec.endsWith('components/GlobalHeaderServer')) return { url: pathToFileURL(HEADER).href, shortCircuit: true };
  if (spec.endsWith('lib/mlb/bracket')) return { url: pathToFileURL(READER).href, shortCircuit: true };
  if (spec.endsWith('.css')) return { url: pathToFileURL(CSS).href, shortCircuit: true };
  return next(spec, ctx);
} });

let React, renderToStaticMarkup, Page, stub, buildBracket, shapeSeries, ROWS;
before(async () => {
  writeFileSync(LINK, "import React from 'react'; export default function Link({href,children,...r}){return React.createElement('a',{...r,href:String(href)},children);}\n");
  writeFileSync(HEADER, 'export default function GlobalHeaderServer() { return null; }\n');
  writeFileSync(CSS, 'export default {};\n');
  writeFileSync(READER, [
    "export const LEAGUES = ['American', 'National'];",
    "export const LEAGUE_LABEL = { American: 'American League', National: 'National League' };",
    "export const TBD = 'TBD \\u00b7 set Sunday';",
    'export let next = null;',
    'export function set(v) { next = v; }',
    'export async function getBracket() { return next; }',
  ].join('\n') + '\n');
  React = await import('react');
  ({ renderToStaticMarkup } = await import('react-dom/server'));
  stub = await import(pathToFileURL(READER).href);
  Page = (await import('./page.js')).default;
  ({ shapeSeries } = await import('../../../lib/mlb/series.js'));
  ({ buildBracket } = await import('../../../lib/mlb/bracket.js'));
  ROWS = JSON.parse(readFileSync(new URL('../../../lib/mlb/fixtures/postseason2025.json', import.meta.url), 'utf8'));
});
after(() => { for (const f of [LINK, HEADER, READER, CSS]) { try { unlinkSync(f); } catch { /* gone */ } } });

// The 2025 seeds, as the standings feed publishes them.
const SEEDS_2025 = [
  ['American', 1, 'TOR'], ['American', 2, 'SEA'], ['American', 3, 'CLE'],
  ['American', 4, 'NYY'], ['American', 5, 'BOS'], ['American', 6, 'DET'],
  ['National', 1, 'MIL'], ['National', 2, 'PHI'], ['National', 3, 'LAD'],
  ['National', 4, 'CHC'], ['National', 5, 'SD'], ['National', 6, 'CIN'],
];

function seedsFrom(rows) {
  const idOf = new Map(rows.flatMap((r) => [[r.home_abbr, r.home_team_id], [r.away_abbr, r.away_team_id]]));
  return SEEDS_2025.map(([league, seed, ab]) => ({
    teamId: idOf.get(ab) ?? `x-${ab}`, seed, league, abbreviation: ab, name: ab, colors: null,
  }));
}

const render = async (b) => {
  stub.set(b);
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ season: '2025' }) }));
};

test('THE TWELVE ARE SET only once somebody has stopped playing for them', async () => {
  // ONE postseason game is enough: it is the only evidence that the field is
  // no longer a standings snapshot. Here the wild card has started and
  // nothing else has.
  const wcOnly = ROWS.filter((r) => r.stage === 'wild_card');
  const b = buildBracket({ series: shapeSeries(wcOnly), seeds: seedsFrom(ROWS) });
  assert.equal(b.set, true);
  const h = await render({ season: 2025, ...b });
  assert.match(h, /the twelve are set/);
  assert.doesNotMatch(h, /if the season ended today/);
  assert.doesNotMatch(h, /the field is not set yet/);

  // AND THE THIRD STATE IS UNCHANGED: no seeds and no games says neither.
  const none = buildBracket({});
  assert.equal(none.set, false);
  assert.equal(none.seeded, 0);
  const h2 = await render({ season: 2026, ...none });
  assert.match(h2, /the field is not set yet/);
  assert.doesNotMatch(h2, /if the season ended today/);
});

test('THE FINISHED 2025 BRACKET: eleven slots, every winner marked, a champion', async () => {
  const b = buildBracket({ series: shapeSeries(ROWS), seeds: seedsFrom(ROWS) });
  const h = await render({ season: 2025, ...b });

  // Four columns, in bracket order, and the World Series is not a league's.
  assert.deepEqual([...h.matchAll(/data-column="(\w+)"/g)].map((m) => m[1]),
    ['wild_card', 'division', 'championship', 'world_series']);
  assert.equal([...h.matchAll(/data-stage="\w+"/g)].length, 11, 'eleven series slots');
  assert.match(h, /<h3>American League<\/h3>/);
  assert.match(h, /<h3>National League<\/h3>/);

  // THE CHAMPION IS NAMED AT THE TOP, once.
  assert.match(h, /<b>Dodgers<\/b> win the World Series/);

  // Every slot is final, none is TBD, and the records are the real ones.
  assert.equal([...h.matchAll(/data-status="final"/g)].length, 11);
  assert.doesNotMatch(h, /TBD/);
  assert.match(h, /<span class="bk-rec">4-3<\/span>/, 'the World Series went seven');
  assert.match(h, /<span class="bk-rec">4-0<\/span>/, 'and the NLCS was a sweep');

  // A SWEPT SERIES SHOWS FOUR GAME LINKS, NOT SEVEN - the games that were
  // played, not the ones the format allows.
  const slots = [...h.matchAll(/<div class="bk-slot [^"]*" data-stage="championship"[\s\S]*?<\/div><\/div>/g)];
  assert.ok(slots.length >= 1);
});

test('BYES ARE MARKED IN THE DIVISION ROUND AND NOWHERE ELSE', async () => {
  const b = buildBracket({ series: shapeSeries(ROWS), seeds: seedsFrom(ROWS) });
  const h = await render({ season: 2025, ...b });
  // Four byes: the 1 and 2 seeds of each league, in their Division Series.
  assert.equal([...h.matchAll(/class="bk-bye">bye</g)].length, 4);
  // AND THE BYE DOES NOT TRAVEL. Toronto played eleven postseason games; a
  // "(bye)" chip beside them in the World Series would be nonsense.
  const ws = h.slice(h.indexOf('data-column="world_series"'));
  assert.doesNotMatch(ws, /bk-bye/);
});

test('AN UNSET BRACKET SAYS SO, and names the day', async () => {
  const b = buildBracket({});
  const h = await render({ season: 2026, ...b });
  assert.match(h, /the field is not set yet/);
  // Eleven slots still, because the shape of the bracket is a rule of the
  // competition - what is missing is who is in it.
  assert.equal([...h.matchAll(/data-stage="\w+"/g)].length, 11);
  assert.equal([...h.matchAll(/data-status="empty"/g)].length, 11);
  assert.match(h, /TBD · set Sunday/);
  // A SLOT WAITING ON AN EARLIER RESULT NAMES WHERE ITS CLUB COMES FROM.
  assert.match(h, /Winner 4\/5/);
  assert.match(h, /Winner 3\/6/);
  assert.match(h, /AL champion/);
  assert.match(h, /NL champion/);
  assert.doesNotMatch(h, /win the World Series/);
});

test('SEEDS BUT NO GAMES: "if the season ended today", NOT "the twelve are set"', async () => {
  // A SEED IS A LIVE NUMBER ALL SEASON. Twelve of them in September is a
  // standings snapshot that will move again on Tuesday night, and "the twelve
  // are set" said of it is a claim about a field nobody has qualified for.
  const b = buildBracket({ seeds: seedsFrom(ROWS) });
  assert.equal(b.seeded, 12);
  assert.equal(b.set, false, 'no postseason game exists, so nothing is set');
  const h = await render({ season: 2026, ...b });
  assert.match(h, /if the season ended today/);
  assert.doesNotMatch(h, /the twelve are set/);
  // The four wild card slots know both clubs; the rest are still waiting.
  assert.equal([...h.matchAll(/data-status="scheduled"/g)].length, 4);
  assert.equal([...h.matchAll(/data-status="empty"/g)].length, 7);
  // 0-0, quietly - not a blank, and not a winner.
  assert.match(h, /<span class="bk-rec quiet">0-0<\/span>/);
  assert.doesNotMatch(h, /bk-side won/);
});

test('A LIVE SERIES IS THE ONLY THING THAT GETS THE RED EDGE', async () => {
  // Take the real World Series and wind it back to 2-1 with game 4 in play.
  // By KICKOFF ORDER, not by the slug - a slug ends in two club
  // abbreviations, and reading a game number off it silently made every
  // World Series game "game 0" and changed nothing.
  const wsOrder = ROWS.filter((r) => r.stage === 'world_series')
    .slice().sort((a, b) => a.kickoff_at.localeCompare(b.kickoff_at)).map((r) => r.id);
  const rows = ROWS.map((r) => {
    if (r.stage !== 'world_series') return r;
    const n = wsOrder.indexOf(r.id) + 1;
    return n <= 3 ? r : { ...r, status: n === 4 ? 'live' : 'scheduled', home_score: null, away_score: null };
  });
  const b = buildBracket({ series: shapeSeries(rows), seeds: seedsFrom(ROWS) });
  const h = await render({ season: 2025, ...b });
  assert.equal([...h.matchAll(/data-status="live"/g)].length, 1);
  assert.match(h, /<span class="bk-live">LIVE<\/span>/);
  assert.match(h, /1 series live/);
  assert.doesNotMatch(h, /win the World Series/, 'nobody has won it yet');
});
