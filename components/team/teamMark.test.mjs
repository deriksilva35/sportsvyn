// components/team/teamMark.test.mjs — TeamMark: headgear when the league has it, else the
// two-tone circle, else the abbreviation disc (GAMES TAB v2 item 6; HEADGEAR-WEB).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { install } from '../../lib/testing/nextResolve.mjs';
install();
const { renderToStaticMarkup } = await import('react-dom/server');
const React = await import('react');
const TeamMark = (await import('./TeamMark.js')).default;
const html = (props) => renderToStaticMarkup(React.createElement(TeamMark, props));

test('22 -> a two-tone split circle with both fills and the --line ring', () => {
  const h = html({ primary: '#8B0000', secondary: '#FFFFFF', size: 22, title: 'Richmond' });
  assert.match(h, /data-teammark="circle"/);
  assert.match(h, /width="22" height="22"/);
  assert.match(h, /<circle[^>]*fill="#8B0000"/, 'primary fills the disc');
  assert.match(h, /<rect[^>]*fill="#FFFFFF"/, 'secondary is the bottom band');
  assert.match(h, /<rect[^>]*y="12\.76/, 'the band starts at 58% - the bottom 42%');
  assert.match(h, /stroke="var\(--line, #2A2A2A\)"/, 'ring in --line');
  assert.match(h, /<title>Richmond<\/title>/);
  assert.doesNotMatch(h, /helmet/i, 'no helmet markup under 28');
});

test('headgear: nfl ATL is the Falcons file, same box as the disc, facing right', () => {
  const h = html({ primary: '#A71930', secondary: '#000000', abbr: 'ATL', size: 28, title: 'Atlanta Falcons', leagueSlug: 'nfl', className: 'gg-hm' });
  assert.match(h, /^<img /); assert.match(h, /data-teammark="headgear"/); assert.match(h, /data-facing="right"/);
  assert.match(h, /src="\/headgear\/nfl\/ATL@1x\.webp"/);
  assert.match(h, /srcSet="\/headgear\/nfl\/ATL@1x\.webp 1x, \/headgear\/nfl\/ATL@2x\.webp 2x"/);
  assert.match(h, /width="28" height="28"/); assert.match(h, /alt="Atlanta Falcons"/);
  assert.match(h, /loading="lazy"/); assert.doesNotMatch(h, /rel="preload"/, 'no preload hoisted per mark');
  assert.match(h, /class="teammark teammark--headgear gg-hm"/, 'the caller\'s class rides along');
  assert.doesNotMatch(h, /scaleX/, 'faces right unless told otherwise');
  assert.match(html({ abbr: 'ATL', size: 22, leagueSlug: 'mlb' }), /src="\/headgear\/mlb\/ATL@1x\.webp"/, 'mlb ATL is the Braves file');
});

test('NO LEAGUE, NO HEADGEAR: the same abbreviation without leagueSlug draws the disc', () => {
  const h = html({ primary: '#A71930', secondary: '#000000', abbr: 'ATL', size: 28 });
  assert.match(h, /data-teammark="circle"/); assert.doesNotMatch(h, /headgear|<img/);
  assert.match(html({ primary: null, secondary: null, abbr: 'ATL', size: 24 }), /data-teammark="abbr"/, 'and with no colours, the abbreviation disc');
  assert.match(html({ primary: '#A71930', secondary: '#000000', abbr: 'ATL', size: 28, leagueSlug: 'cfb' }), /data-teammark="circle"/, 'cfb has no cutouts yet');
  assert.match(html({ primary: '#A71930', secondary: '#000000', abbr: 'ZZZ', size: 28, leagueSlug: 'nfl' }), /data-teammark="circle"/, 'a missing file is the disc');
});

test('headgear={false} is the pair saying neither; facing="left" mirrors the cutout only', () => {
  assert.match(html({ primary: '#A71930', secondary: '#000000', abbr: 'ATL', leagueSlug: 'nfl', headgear: false }), /data-teammark="circle"/);
  const l = html({ abbr: 'GB', size: 26, leagueSlug: 'nfl', facing: 'left' });
  assert.match(l, /data-facing="left"/); assert.match(l, /transform:scaleX\(-1\)/);
  const disc = html({ primary: '#203731', secondary: '#FFB612', abbr: 'GB', size: 26, facing: 'left' });
  assert.doesNotMatch(disc, /scaleX/, 'the disc is symmetric and ignores facing');
});

test('the SVG helmet is gone: no TeamMark size turns into it, and no file imports it', async () => {
  const { existsSync } = await import('node:fs');
  assert.equal(existsSync(new URL('./Helmet.js', import.meta.url)), false);
  for (const size of [28, 40, 64]) assert.match(html({ primary: '#CC0000', secondary: '#FFFFFF', size }), /data-teammark="circle"/, `${size}`);
  const { execSync } = await import('node:child_process');
  const importers = execSync("grep -rlE \"components/team/Helmet|from './Helmet'\" --include=*.js --include=*.mjs --exclude=teamMark.test.mjs app components lib || true",
    { cwd: new URL('../../', import.meta.url).pathname }).toString().trim().split('\n').filter(Boolean);
  assert.deepEqual(importers, [], 'nothing imports the helmet');
});

test('TeamMark has only its named users, and every one passes a league', async () => {
  const { execSync } = await import('node:child_process');
  const root = new URL('../../', import.meta.url).pathname;
  const users = execSync("grep -rl \"components/team/TeamMark\" --include=*.js app components lib | grep -v test || true", { cwd: root }).toString().trim().split('\n').filter(Boolean)
    .filter((f) => f !== 'components/team/TeamMark.js'); // its own header comment
  // The allowlist is deliberate, not a snapshot: a NEW user of the mark is a
  // design decision and has to be added here on purpose.
  const ALLOWED = [
    // the Scores tab card (v2) and the v1 Scoreboard card
    'components/scores/ScoresV2.js', 'components/gridiron/Scoreboard.js',
    // the NFL/CFB game header and the NFL box score (the SVG helmet's old seats)
    'components/gridiron/GameTeamRow.js', 'components/gridiron/BoxScore.js',
    // the MLB game header, the postseason bracket and the series board
    'app/mlb/game/[slug]/page.js', 'app/mlb/bracket/page.js', 'components/pickem/SeriesBoard.js',
    // the Pick'em board - the site's one facing pair
    'components/pickem/PickemBoard.js',
    // single-team rows: rankings, All teams, Today's your-teams, /you, /account, the Run
    'components/rankings/RankRow.js', 'components/rankings/AllTeams.js', 'components/gridiron/TodayV2.js',
    'components/you/You.js', 'components/account/FollowedTeams.js', 'components/run/RunRoster.js',
  ];
  assert.deepEqual([...users].sort(), [...ALLOWED].sort());
  // NEVER INFER THE LEAGUE: every <TeamMark .../> on the site says which one.
  for (const f of ALLOWED) {
    const src = readFileSync(root + f, 'utf8');
    const tags = src.match(/<TeamMark\b[^]*?\/>/g) ?? [];
    assert.ok(tags.length > 0, `${f} draws a mark`);
    for (const t of tags) assert.match(t, /leagueSlug=/, `${f}: ${t.slice(0, 80)}`);
  }
});

test('no colors -> an ink-3 disc with the abbreviation and the --line ring (EPL fallback, SCORES TAB v2 Part A 2)', () => {
  const h = html({ primary: null, secondary: null, abbr: 'BRE', size: 24, title: 'Brentford' });
  assert.match(h, /data-teammark="abbr"/); assert.match(h, /aria-label="Brentford"/);
  assert.match(h, /background:var\(--ink-3, #1C1C1C\)/); assert.match(h, /border:1px solid var\(--line, #2A2A2A\)/);
  assert.match(h, />BRE<\/span>/); assert.doesNotMatch(h, /<svg/);
  assert.match(html({ primary: '#111111', secondary: null, abbr: 'X', size: 24 }), /data-teammark="abbr"/, 'one colour is no colours');
  assert.match(html({ primary: null, secondary: null, abbr: 'ARSENAL', size: 24 }), />ARS<\/span>/, 'three letters at most');
});

test('headgearKey: the STORED letters decide, so an FCS side printing "ALA" never wears Alabama\'s helmet', () => {
  assert.match(html({ abbr: 'ALA', size: 24, leagueSlug: 'cfb' }), /src="\/headgear\/cfb\/ALA@1x\.webp"/, 'Alabama: printed = stored');
  const aamu = html({ primary: '#660000', secondary: '#FFFFFF', abbr: 'ALA', headgearKey: null, size: 24, leagueSlug: 'cfb' });
  assert.match(aamu, /data-teammark="circle"/); assert.doesNotMatch(aamu, /headgear/);
  assert.match(html({ abbr: 'TA&M', size: 24, leagueSlug: 'cfb' }), /src="\/headgear\/cfb\/TAM@1x\.webp"/);
});
