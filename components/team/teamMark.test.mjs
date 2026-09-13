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
  const ALLOWED = ['components/games/LobbyV2.js', 'components/scores/ScoresV2.js', 'components/team/TeamMark.js',
    // "Teams you follow" on /account (TEAM FOLLOWING relay) - a list of teams
    // wants the same 24px mark the lobby and the Scores tab draw.
    'components/account/FollowedTeams.js'];
  assert.ok(users.includes('components/games/LobbyV2.js'), 'the lobby uses it');
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
