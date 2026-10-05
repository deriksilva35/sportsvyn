// Compliance: the non-affiliation line's content, and a guard that no user-facing
// source (app/ or components/) references the NFL stats vendor by name or BDL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NON_AFFILIATION } from './legal.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

test('the non-affiliation line is one line for every sport (thu-42)', () => {
  assert.equal(NON_AFFILIATION, 'Sportsvyn is not affiliated with any league, team or player.');
  assert.ok(!/[—–]/.test(NON_AFFILIATION), 'no em/en dashes');
});

test('no surface still prints the old NFL-only disclaimer, and every footer reads the one constant', () => {
  const files = [...walk(path.join(ROOT, 'app')), ...walk(path.join(ROOT, 'components'))];
  const old = /endorsed by,? or sponsored by|Not affiliated with (or endorsed by )?the (NFL|National Football League)|NOT AFFILIATED WITH/i;
  const hits = files.filter((f) => old.test(readFileSync(f, 'utf8'))).map((f) => path.relative(ROOT, f));
  assert.deepEqual(hits, []);
  // app/team/[slug]/page.js left (mon-16): its inline footer is gone, it renders
  // <SiteFooter /> - pinned in lib/brand/tagline.test.mjs - which is checked here.
  for (const f of ['components/SiteFooter.js', 'components/sim/Attribution.js',
    'app/nfl/game/[slug]/page.js', 'app/cfb/game/[slug]/page.js']) {
    // app/daily/[date]/page.js left (sat-5 Y1): v1's reveal is a 308 now and
    // renders nothing. The repo-wide walk above still covers every surface.
    assert.match(readFileSync(path.join(ROOT, f), 'utf8'), /\{NON_AFFILIATION/, `${f} renders NON_AFFILIATION`);
  }
});

// /games DROPPED ITS IN-PAGE COPY (fri-2): the site footer under it carries
// the one sentence, so the lobby does not say it twice.
test('/games does not repeat the not-affiliated line in the page; its footer carries it', () => {
  const lobby = readFileSync(path.join(ROOT, 'components/games/LobbyV3.js'), 'utf8');
  assert.doesNotMatch(lobby, /NON_AFFILIATION|not affiliated/i);
  assert.match(readFileSync(path.join(ROOT, 'app/games/page.js'), 'utf8'), /<SiteFooter \/>/);
  assert.match(readFileSync(path.join(ROOT, 'components/SiteFooter.js'), 'utf8'), /\{NON_AFFILIATION/);
});

function walk(dir, acc = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (/\.(js|jsx|mjs|css)$/.test(e.name) && !/\.test\.mjs$/.test(e.name)) acc.push(full);
  }
  return acc;
}

test('no user-facing vendor reference (balldontlie / BDL) in app/ or components/', () => {
  const files = [...walk(path.join(ROOT, 'app')), ...walk(path.join(ROOT, 'components'))];
  const rx = /balldontlie|ball[ -]?dont[ -]?lie|\bBDL\b/i;
  const hits = files.filter((f) => rx.test(readFileSync(f, 'utf8'))).map((f) => path.relative(ROOT, f));
  assert.deepEqual(hits, [], 'NFL stats vendor must never be named in user-facing source');
});
