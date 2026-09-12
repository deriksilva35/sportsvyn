// app/games/lobbyV2.test.mjs — the Games tab v2 page (GAMES TAB v2, item 9):
// every section in order, Mock and Tracker exactly once, --blue only on the
// Daily card, no em dashes, the panes still reachable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const page = strip(src('app/games/page.js'));
const comp = strip(src('components/games/LobbyV2.js'));
const lobby = comp.slice(comp.indexOf('export default function LobbyV2('));

test('the page renders every section, in the mock\'s order', () => {
  // HEADLINE FIT + DRAFT ROOM ON TOP relay: the Draft room moved above the
  // Daily card, directly under the intro. Nothing else changed place.
  const order = ['className="lv-ah"', 'className="lv-intro"', '<h2>Draft room</h2>', 'className="lv-note"',
    'data-section="draft-room"', 'className="lv-games"', 'card={daily} hero', 'card={weekly}',
    'className="lv-minis"', 'row={pickem}', 'row={draft}',
    'tonightTitle({ games: v.tonight', 'data-section="tonight"', 'data-section="read"', 'className="lv-more"'];
  let at = 0;
  for (const marker of order) {
    const i = lobby.indexOf(marker, at);
    assert.ok(i > -1, `missing ${marker}`); assert.ok(i >= at, `${marker} is out of order`); at = i;
  }
  // The intro line and its H1, verbatim.
  assert.match(lobby, /<h1>Every day is <i>game day\.<\/i><\/h1>/);
  assert.match(lobby, /\{intro\.open\}/); assert.match(lobby, /First of \{numberWord\(intro\.lock\.count\)\} \{intro\.lock\.league\} game/);
  assert.match(lobby, /\{intro\.live\} live now\./); assert.match(lobby, /still to pick\./);
  assert.match(page, /const viewerTz = pane === 'games' \? await readViewerTz\(\) : null;/);
});

test('Mock and Tracker live in the Draft room and nowhere else on the page - one link each', () => {
  assert.equal((lobby.match(/href="\/sim"/g) ?? []).length, 1);
  assert.equal((lobby.match(/href="\/sim\/tracker"/g) ?? []).length, 1);
  const room = lobby.slice(lobby.indexOf('data-section="draft-room"'), lobby.indexOf('className="lv-games"'));
  assert.match(room, /href="\/sim"/); assert.match(room, /href="\/sim\/tracker"/);
  assert.match(room, /<strong>Mock<\/strong><small>vs the market<\/small>/);
  assert.match(room, /<strong>Tracker<\/strong><small>log your draft<\/small>/);
  // two half-width tiles, 24px disc each
  assert.equal((room.match(/className="lv-tile"/g) ?? []).length, 2);
  assert.match(lobby, /<div className="lv-duo" data-section="draft-room">/);
  // the old Practice module is gone from the page
  assert.doesNotMatch(page + comp, /v\.practice|Set up a board/);
});

test('--blue is the Daily card\'s surface and nothing else\'s (token v1.4)', () => {
  const css = src('app/games/lobbyV2.css');
  const uses = css.match(/var\(--blue\)/g) ?? [];
  assert.equal(uses.length, 2, 'background + border of .lv-game.hero, once');
  assert.match(css, /\.lv-game\.hero \{ background: var\(--blue\); border-color: var\(--blue\);/);
  assert.match(src('app/globals.css'), /--blue: #245BFF;\s+\/\* v1\.4 · Daily surface only \*\//);
  // no other stylesheet or component reaches for it
  const walk = (rel) => readdirSync(path.join(REPO, rel)).flatMap((e) => {
    const p = path.join(rel, e); if (e === 'node_modules' || e === '.next' || e.startsWith('.')) return [];
    return statSync(path.join(REPO, p)).isDirectory() ? walk(p) : /\.(css|js|mjs)$/.test(e) ? [p] : [];
  });
  const others = ['app', 'components', 'lib'].flatMap(walk)
    .filter((f) => !['app/games/lobbyV2.css', 'app/globals.css'].includes(f) && !f.endsWith('.test.mjs'))
    .filter((f) => /--blue\b/.test(src(f)));
  assert.deepEqual(others, [], `--blue leaked into ${others}`);
  assert.doesNotMatch(page + comp, /--blue|#245BFF/);
});

test('no em dashes on the page or its shapes; the three panes and the stranger block still exist', () => {
  for (const f of ['app/games/page.js', 'components/games/LobbyV2.js', 'lib/games/lobbyV2Shape.js', 'lib/games/lobbyV2.js', 'app/games/lobbyV2.css']) {
    assert.ok(!/—/.test(src(f)), `${f} carries an em dash`);
  }
  assert.match(lobby, /href="\/games\?pane=leaderboards"/); assert.match(lobby, /href="\/games\?pane=answer"/); assert.match(lobby, /href="\/games\?pane=history"/);
  assert.match(lobby, /\{!signedIn && \(\s*<div className="lob-stranger">/);
  assert.match(lobby, /className="lv-signin" href=\{signinHref\('\/games'\)\}>Sign in</);
  assert.match(comp, /signedIn \? card\.cta : 'Sign in to play'/, 'signed-out CTAs read Sign in and go to /signin');
  assert.match(comp, /const href = signedIn \? card\.href : signinHref\(card\.href\);/);
  // no zeros strip, no pane nav on the games pane
  assert.doesNotMatch(lobby, /className="strip"/); assert.doesNotMatch(lobby, /<PaneTabs/);
  // R3/R4: the Tonight foot leads with the broadcaster; Read the game is football-only and omitted when empty
  assert.match(comp, /\[g\.network, spread\]\.filter\(Boolean\)\.join\(' · '\)/);
  const reader = strip(src('lib/games/lobbyV2.js'));
  assert.match(reader, /FROM match_broadcasters b\s+WHERE b\.match_id = m\.id AND b\.country_code = 'US'/);
  assert.match(reader, /JOIN leagues l ON l\.id = a\.league_id\s+WHERE a\.status = 'published' AND a\.type <> 'preview' AND l\.slug IN \('nfl', 'cfb'\)/);
  assert.match(lobby, /\{v\.read && \(/, 'no article -> no section');
  // R6: the Practice module is gone from the lobby reader too
  assert.doesNotMatch(strip(src('lib/games/read.js')), /practice: \{ chips/);
  // the Tonight card carries no win-probability bar and TeamMark at 24
  assert.doesNotMatch(lobby, /className="bar"/); assert.match(comp, /<TeamMark primary=\{t\.colors\.primary\} secondary=\{t\.colors\.secondary\} size=\{24\}/);
});

test('the page wires the v2 reader to the pane and keeps the other three panes on gamesLobby()', () => {
  assert.match(page, /const v2 = pane === 'games' \? await lobbyV2\(userId\)\.catch\(\(\) => null\) : null;/);
  assert.match(page, /<LobbyV2 v=\{v2\} signedIn=\{userId != null\} isShell=\{isShell\} leagues=\{leagues\} viewerTz=\{viewerTz\} \/>/);
  assert.match(page, /pane === 'leaderboards' && <BoardsPane/); assert.match(page, /pane === 'answer' && <AnswerPane/); assert.match(page, /pane === 'history' && <HistoryPane/);
});

test('HEADLINE FIT: the h1 is one line, clamped to the viewport, and nothing can wrap it back', () => {
  const css = src('app/games/lobbyV2.css');
  const rule = css.slice(css.indexOf('.lv-intro h1 {'), css.indexOf('}', css.indexOf('.lv-intro h1 {')));
  assert.match(rule, /white-space: nowrap/, 'the guarantee');
  assert.match(rule, /font-size: clamp\(22px, 7\.6vw, 30px\)/, 'scales with the viewport');
  assert.match(rule, /font-weight: 800/); assert.match(rule, /text-transform: uppercase/);
  // no later rule may put the wrap back or pin a fixed size
  const after = css.slice(css.indexOf('.lv-intro h1 {') + 1);
  assert.doesNotMatch(after, /\.lv-intro h1[^{]*\{[^}]*white-space:\s*(normal|pre-wrap)/);
  assert.doesNotMatch(after, /\.lv-intro h1[^{]*\{[^}]*font-size:\s*\d+px/);
  // the volt italic on "game day." is untouched
  assert.match(css, /\.lv-intro h1 i \{ font-style: italic; color: var\(--volt\); \}/);
  assert.match(lobby, /<h1>Every day is <i>game day\.<\/i><\/h1>/);
});

test('DRAFT ROOM ON TOP: the caption sits above the tiles, the old sub-line is gone, and the section leads the page', () => {
  // caption above tiles
  assert.ok(lobby.indexOf('className="lv-note"') < lobby.indexOf('data-section="draft-room"'), 'caption first');
  assert.match(lobby, /<p className="lv-note"><b>Mock season is over, not the mock\.<\/b> Every Draft room uses the same clock and board, so a mock is a practice run\.<\/p>/);
  // the old sub-line and the old stacked tools are gone
  assert.doesNotMatch(lobby, /Practice for the Draft/);
  assert.doesNotMatch(lobby, /lv-tools|lv-tool\b|Draft tracker|Mock draft/);
  assert.doesNotMatch(src('app/games/lobbyV2.css'), /\.lv-tools|\.lv-tool\b/);
  // the section header carries no sub-line of its own
  assert.match(lobby, /<div className="lv-sh"><h2>Draft room<\/h2><\/div>/);
  // and it leads: above the Daily card
  assert.ok(lobby.indexOf('<h2>Draft room</h2>') < lobby.indexOf('card={daily} hero'));
});
