// app/nfl/game/headgear.test.mjs - the game-page header's team mark, RENDERED,
// for both gridiron pages (HEADGEAR-WEB).
//
// The header is two STACKED rows (away above home), so both marks face right -
// no mirror here; the Pick'em board is the one facing pair. The rows are a
// pair, so both or neither. NFL and FBS wear helmets; an FCS side has none,
// so an FBS v FCS header is two discs. The header mark is 40 px, both kinds.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { install } from '../../../lib/testing/nextResolve.mjs';
import { orderFor } from '../../../lib/gridiron/teamOrder.js';
import { pairHasHeadgear } from '../../../lib/teams/headgear.js';
import { stubPath } from '../../../lib/testing/stubDir.mjs';

install();

// The row imports the follow star, which imports a server action that opens
// the database at import time. The star never draws here (signed out).
const ACTIONS = stubPath('__follows_stub.mjs');
writeFileSync(ACTIONS, 'export async function followTeam() { return { ok: true }; }\nexport async function unfollowTeam() { return { ok: true }; }\n');
registerHooks({ resolve(spec, ctx, next) {
  if (spec === '@/app/actions/follows') return { url: pathToFileURL(ACTIONS).href, shortCircuit: true };
  return next(spec, ctx);
} });
after(() => { try { unlinkSync(ACTIONS); } catch { /* gone */ } });

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\s*\}/g, '');

let React; let renderToStaticMarkup; let GameTeamRow;
before(async () => {
  React = (await import('react')).default;
  ({ renderToStaticMarkup } = await import('react-dom/server'));
  GameTeamRow = (await import('../../../components/gridiron/GameTeamRow.js')).default;
});

const ATL = { id: 1, abbreviation: 'ATL', name: 'Falcons', colors: { primary: '#A71930', secondary: '#000000' } };
const GB = { id: 2, abbreviation: 'GB', name: 'Packers', colors: { primary: '#203731', secondary: '#FFB612' } };

/** The header as the page composes it: league order, one pair answer, two rows. */
function header(leagueSlug, away, home) {
  const headgear = pairHasHeadgear(leagueSlug, away.abbreviation, home.abbreviation);
  return orderFor(leagueSlug).map((side) => renderToStaticMarkup(React.createElement(GameTeamRow, {
    t: side === 'home' ? home : away, score: 0, loser: false, show: false, leagueSlug, headgear,
  }))).join('');
}

test('ATL @ GB: two helmets, away first, both facing right, at 40 px', () => {
  const h = header('nfl', ATL, GB);
  const imgs = [...h.matchAll(/<img class="teammark teammark--headgear gg-hm" data-teammark="headgear" data-facing="(\w+)" src="([^"]+)"/g)];
  assert.deepEqual(imgs.map((m) => m[2]), ['/headgear/nfl/ATL@1x.webp', '/headgear/nfl/GB@1x.webp']);
  assert.deepEqual(imgs.map((m) => m[1]), ['right', 'right'], 'stacked rows do not mirror');
  assert.doesNotMatch(h, /scaleX/);
  assert.equal((h.match(/<img [^>]*width="40" height="40"/g) ?? []).length, 2, 'both helmets at 40 px');
  // the order inside the row is unchanged: badge slot, mark, abbreviation
  assert.match(h, /data-teammark="headgear"[^>]*\/><span class="abbr">ATL<\/span>/);
});

test('a header with one unknown side draws two discs, never one helmet', () => {
  const h = header('nfl', { ...ATL, abbreviation: 'XYZ' }, GB);
  assert.equal((h.match(/data-teammark="headgear"/g) ?? []).length, 0);
  assert.equal((h.match(/data-teammark="circle"/g) ?? []).length, 2);
});

test('CFB: two FBS sides wear their helmets at 40 px; FBS v FCS is two discs', () => {
  const h = header('cfb', { ...ATL, abbreviation: 'ALA' }, { ...GB, abbreviation: 'UGA' });
  assert.deepEqual([...h.matchAll(/src="(\/headgear\/cfb\/[^"]+)"/g)].map((m) => m[1]), ['/headgear/cfb/ALA@1x.webp', '/headgear/cfb/UGA@1x.webp']);
  assert.equal((h.match(/<img [^>]*width="40" height="40"/g) ?? []).length, 2);
  // An FCS team has NO stored abbreviation - the page prints letters it derives.
  const fcs = header('cfb', { ...ATL, abbreviation: null, name: 'Alabama A&M' }, { ...GB, abbreviation: 'ALA', name: 'Alabama' });
  assert.doesNotMatch(fcs, /headgear/, 'Alabama A&M does not borrow Alabama\'s helmet, and Alabama drops to the disc too');
  assert.equal((fcs.match(/<svg [^>]*width="40" height="40"/g) ?? []).length, 2, 'the disc in the same 40 px box');
});

test('BOTH PAGES hand the row their own league and one pair answer from their own teams', () => {
  for (const p of ['app/nfl/game/[slug]/page.js', 'app/cfb/game/[slug]/page.js']) {
    const s = stripComments(src(p));
    assert.match(s, /const pairHeadgear = pairHasHeadgear\(game\.leagueSlug, game\.away\?\.abbreviation, game\.home\?\.abbreviation\);/, `${p} asks once, for the pair`);
    assert.match(s, /<GameTeamRow[^>]*leagueSlug=\{game\.leagueSlug\} headgear=\{pairHeadgear\}/, `${p} passes both to the row`);
  }
});
