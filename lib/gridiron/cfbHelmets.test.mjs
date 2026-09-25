// lib/gridiron/cfbHelmets.test.mjs - the CFB surfaces read the same colors
// the NFL ones do, all 138 FBS teams render a two-tone mark, and the pairs the
// contrast rule cannot save are named so the list cannot grow silently.
//
// HEADGEAR-WEB: the SVG helmet is gone. Every FBS team now has a cutout
// (lib/teams/cfb-headgear-manifest.json), so TeamMark draws it; the two colours
// still matter for the disc every FBS team falls back to beside an FCS side.
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
  // The header row is shared by both game pages now (TEAM FOLLOWING relay,
  // R3), so the badge/mark/abbr order is asserted where it lives.
  const gameRow = src('components/gridiron/GameTeamRow.js');
  // THE COMMENT SLOT IS ALLOWED ON BOTH SIDES OF THE HELMET, not just the one.
  // This pattern already tolerated a comment between the badge and the helmet;
  // it did not tolerate one between the helmet and the abbreviation, so the
  // POSSESSION DOT ON THE BOARD relay's note about where the dot rides broke an
  // assertion about ORDER by adding prose. The order is what is on trial, and
  // it is asserted exactly as before - a comment cannot satisfy it, because
  // every element is still pinned and still in sequence.
  const comment = String.raw`(?:\s*\{\/\*[^]*?\*\/\})?`;
  assert.match(gameRow, new RegExp(
    String.raw`<RankBadge rank=\{rank\} size="big" \/>${comment}\s*`
    + String.raw`<TeamMark primary=\{t\?\.colors\?\.primary\} secondary=\{t\?\.colors\?\.secondary\}[^>]*?size=\{40\}[^>]*?className="gg-hm"[^>]*?leagueSlug=\{leagueSlug\}[^>]*?\/>${comment}\s*`
    + String.raw`<span className="abbr">`,
  ), 'the mark after the badge, before the abbreviation');
  assert.match(cfbPage, /<GameTeamRow/, 'and the CFB page routes through it');
  // THE TODAY TAB NO LONGER DRAWS A SCOREBOARD (TODAY TAB v2). The rebuilt
  // /cfb is the mock's page - read, Weekly, picks, Daily, your teams, the
  // numbers, the wire - and it has no LeagueScores block, so the helmet's
  // route to that screen is gone with it. The Scoreboard TeamLine still runs
  // /cfb/scores, which is where a reader goes for the slate.
  assert.match(src('app/cfb/page.js'), /TodayShell/, '/cfb is the rebuilt Today tab');
  assert.doesNotMatch(src('components/gridiron/TodayShell.js'), /LeagueScores/, 'and it mounts no scoreboard');
  assert.match(src('app/cfb/scores/page.js'), /ScoresView|Scoreboard/, '/cfb/scores still mounts the Scoreboard');
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
  const { default: TeamMark } = await import('../../components/team/TeamMark.js');
  html = (props) => renderToStaticMarkup(React.createElement(TeamMark, props));
});

async function fbs() {
  const { sql } = await import('../db.js');
  return sql`SELECT t.abbreviation, t.name, t.color_primary c1, t.color_secondary c2
               FROM teams t JOIN leagues l ON l.id = t.league_id
              WHERE l.slug = 'cfb' AND t.metadata->>'classification' = 'fbs' ORDER BY t.name`;
}

test('all 138 FBS teams carry two colors, every one wears its helmet, and every one has its disc to fall back to', async () => {
  const rows = await fbs();
  assert.equal(rows.length, 138);
  for (const t of rows) {
    assert.match(t.c1 ?? '', /^#[0-9A-F]{6}$/, `${t.name} primary`); assert.match(t.c2 ?? '', /^#[0-9A-F]{6}$/, `${t.name} secondary`);
    const h = html({ primary: t.c1, secondary: t.c2, size: 40, abbr: t.abbreviation, leagueSlug: 'cfb' });
    assert.match(h, /data-teammark="headgear"/, `${t.name} (${t.abbreviation}) has a helmet`);
    const d = html({ primary: t.c1, secondary: t.c2, size: 40, abbr: t.abbreviation, leagueSlug: 'cfb', headgear: false });
    assert.match(d, new RegExp(`<circle[^>]*fill="${t.c1}"`), `${t.name} primary`); assert.match(d, new RegExp(`<rect[^>]*fill="${t.c2}"`), `${t.name} secondary`);
  }
});

// THE LIST THE CONTRAST RULE CANNOT SAVE. Under 1.5:1 between primary and
// secondary the lower band vanishes into the disc. Named here, not
// fixed here; a third name in this list is a new fact, not a flake.
const LOW_CONTRAST = ['BYU', 'WSU'];

test('FBS pairs under 1.5:1 are exactly the named ones, and no primary is near-white', async () => {
  const rows = await fbs();
  const low = rows.filter((t) => contrastRatio(t.c1, t.c2) < 1.5).map((t) => t.abbreviation).sort();
  assert.deepEqual(low, LOW_CONTRAST);
  assert.deepEqual(rows.filter((t) => relativeLuminance(t.c1) >= 0.85).map((t) => t.abbreviation), []);
  assert.deepEqual(rows.filter((t) => t.c1.toUpperCase() === t.c2.toUpperCase()).map((t) => t.abbreviation), [], 'no identical pair');
});
