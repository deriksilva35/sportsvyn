// components/team/teamMark.test.mjs — TeamMark: circle under 28, Helmet at 28 and up (GAMES TAB v2, item 6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { install } from '../../lib/testing/nextResolve.mjs';
install();
const { renderToStaticMarkup } = await import('react-dom/server');
const React = await import('react');
const TeamMark = (await import('./TeamMark.js')).default;
const Helmet = (await import('./Helmet.js')).default;
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

test('28 -> the existing Helmet, byte for byte', () => {
  const via = html({ primary: '#CC0000', secondary: '#FFFFFF', size: 28, title: 'NC State' });
  const direct = renderToStaticMarkup(React.createElement(Helmet, { primary: '#CC0000', secondary: '#FFFFFF', size: 28, title: 'NC State' }));
  assert.equal(via, direct, 'TeamMark wraps Helmet, it does not redraw it');
  assert.doesNotMatch(via, /data-teammark="circle"/);
  assert.match(via, /#CC0000/); assert.match(via, /#FFFFFF/);
});

test('Helmet.js is untouched by this relay, and TeamMark has only its named users', async () => {
  const src = readFileSync(new URL('./Helmet.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /TeamMark/);
  const { execSync } = await import('node:child_process');
  const users = execSync("grep -rl \"components/team/TeamMark\" --include=*.js app components lib | grep -v test || true", { cwd: new URL('../../', import.meta.url).pathname }).toString().trim().split('\n').filter(Boolean);
  // The allowlist is deliberate, not a snapshot: a NEW user of the mark is a
  // design decision and has to be added here on purpose.
  // components/games/LobbyV2.js was here and is gone: the v3 Games tab drops
  // the Tonight strip, which was the lobby's only use of the mark.
  const ALLOWED = ['components/scores/ScoresV2.js', 'components/team/TeamMark.js',
    // "Teams you follow" on /account (TEAM FOLLOWING relay) - a list of teams
    // wants the same 24px mark the lobby and the Scores tab draw.
    'components/account/FollowedTeams.js',
    // The Today tab's "Your teams" rows (TODAY TAB v2) - the same 24px-class
    // mark, at 20px, beside a followed team's live or next game.
    'components/gridiron/TodayV2.js',
    // The Rankings tab's ranked rows and its All-teams list (RANKINGS TAB v2)
    // - the same mark, at 22px, and the follow ring is drawn on it.
    'components/rankings/RankRow.js',
    'components/rankings/AllTeams.js',
    // The You tab's followed-team rows (YOU TAB v1) - the same 22px mark.
    'components/you/You.js',
    // The MLB game page's team rows (MLB B1 item 6) - the same mark at 26px.
    // Baseball has no helmet, so Helmet.js was never the question here: the
    // gridiron page's row draws a helmet and this one draws the disc.
    'app/mlb/game/[slug]/page.js',
    // The postseason bracket's slots (20px) and the round board's two sides
    // (22px) - MLB B2 items 2 and 3, the same mark again.
    'app/mlb/bracket/page.js',
    'components/pickem/SeriesBoard.js'];
  assert.ok(users.includes('components/scores/ScoresV2.js'), 'the Scores tab uses it (SCORES TAB v2)');
  assert.ok(!users.some((f) => !ALLOWED.includes(f)), `no other user: ${users}`);
});

test('no colors -> an ink-3 disc with the abbreviation and the --line ring (EPL fallback, SCORES TAB v2 Part A 2)', () => {
  const h = html({ primary: null, secondary: null, abbr: 'BRE', size: 24, title: 'Brentford' });
  assert.match(h, /data-teammark="abbr"/); assert.match(h, /aria-label="Brentford"/);
  assert.match(h, /background:var\(--ink-3, #1C1C1C\)/); assert.match(h, /border:1px solid var\(--line, #2A2A2A\)/);
  assert.match(h, />BRE<\/span>/); assert.doesNotMatch(h, /<svg/);
  assert.match(html({ primary: '#111111', secondary: null, abbr: 'X', size: 24 }), /data-teammark="abbr"/, 'one colour is no colours');
  assert.match(html({ primary: null, secondary: null, abbr: 'ARSENAL', size: 24 }), />ARS<\/span>/, 'three letters at most');
});
