// lib/gridiron/cfbHelmets.test.mjs - the CFB surfaces read the same colors
// the NFL ones do, all 138 FBS teams render a helmet, and the pairs the
// contrast rule cannot save are named so the list cannot grow silently.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contrastRatio, relativeLuminance } from '../brand/contrast.js';
import { install } from '../testing/nextResolve.mjs';

const src = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

test('every CFB surface reads colors through the shared readers, which select both columns', () => {
  const readers = src('lib/gridiron/readers.js');
  assert.equal((readers.match(/h\.color_primary AS home_c1, h\.color_secondary AS home_c2/g) ?? []).length, 2, 'both slate selects');
  assert.equal((readers.match(/colors: teamColors\(r\.(home|away)_c1, r\.(home|away)_c2\)/g) ?? []).length, 2);
  const detail = src('lib/gridiron/gameDetail.js');
  assert.match(detail, /h\.color_primary AS home_c1, h\.color_secondary AS home_c2/);
  assert.match(detail, /l\.slug IN \('nfl', 'cfb'\)/, 'getGamePage serves both leagues');
  const cfbPage = src('app/cfb/game/[slug]/page.js');
  assert.match(cfbPage, /import \{ getGamePage \} from '@\/lib\/gridiron\/gameDetail'/, 'the CFB game page reads the shared detail');
  assert.match(cfbPage, /<RankBadge rank=\{rank\} size="big" \/>\s*\{\/\*[^]*?\*\/\}\s*<Helmet primary=\{t\?\.colors\?\.primary\} secondary=\{t\?\.colors\?\.secondary\} facing="right" size=\{28\} className="gg-hm" \/>\s*<span className="abbr">/, 'helmet after the badge, before the abbreviation');
  const cfbToday = src('app/cfb/page.js'); assert.match(cfbToday, /TodayPage/, '/cfb is the shared TodayPage -> LeagueScores -> Scoreboard TeamLine');
  const pickem = src('app/pickem/[sport]/page.js'); assert.match(pickem, /PickemBoard/, '/pickem/cfb is the shared board');
  const entry = src('lib/pickem/entry.js'); assert.match(entry, /teamColorMap\(teamIds\)/);
  const fnStart = entry.indexOf('export async function teamColorMap'); const fn = entry.slice(fnStart, entry.indexOf('\n}\n', fnStart));
  assert.doesNotMatch(fn, /league|sport/, 'the color map is by team id, league-blind');
});

let html;
before(async () => {
  install();
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { default: Helmet } = await import('../../components/team/Helmet.js');
  html = (props) => renderToStaticMarkup(React.createElement(Helmet, props));
});

async function fbs() {
  const { sql } = await import('../db.js');
  return sql`SELECT t.abbreviation, t.name, t.color_primary c1, t.color_secondary c2
               FROM teams t JOIN leagues l ON l.id = t.league_id
              WHERE l.slug = 'cfb' AND t.metadata->>'classification' = 'fbs' ORDER BY t.name`;
}

test('all 138 FBS teams carry two colors and every one renders a helmet', async () => {
  const rows = await fbs();
  assert.equal(rows.length, 138);
  for (const t of rows) {
    assert.match(t.c1 ?? '', /^#[0-9A-F]{6}$/, `${t.name} primary`); assert.match(t.c2 ?? '', /^#[0-9A-F]{6}$/, `${t.name} secondary`);
    const h = html({ primary: t.c1, secondary: t.c2, size: 24 });
    assert.match(h, new RegExp(`fill="${t.c1}"`), `${t.name} shell`); assert.match(h, new RegExp(`stroke="${t.c2}"`), `${t.name} mask`);
  }
});

// THE LIST THE CONTRAST RULE CANNOT SAVE. Under 1.5:1 between primary and
// secondary the stripe and the mask vanish into the shell. Named here, not
// fixed here; a third name in this list is a new fact, not a flake.
const LOW_CONTRAST = ['BYU', 'WSU'];

test('FBS pairs under 1.5:1 are exactly the named ones, and no primary is near-white', async () => {
  const rows = await fbs();
  const low = rows.filter((t) => contrastRatio(t.c1, t.c2) < 1.5).map((t) => t.abbreviation).sort();
  assert.deepEqual(low, LOW_CONTRAST);
  assert.deepEqual(rows.filter((t) => relativeLuminance(t.c1) >= 0.85).map((t) => t.abbreviation), []);
  assert.deepEqual(rows.filter((t) => t.c1.toUpperCase() === t.c2.toUpperCase()).map((t) => t.abbreviation), [], 'no identical pair');
});
