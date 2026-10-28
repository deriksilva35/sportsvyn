// app/cfb/game/heroName.test.mjs - the CFB header prints the short school name
// when the full one would truncate at 390px (relay thu-2). Real team names and
// abbreviations from PROD (teams.short_name equals teams.name on every CFB row,
// which is why the short form is derived: lib/gridiron/heroName.js).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { install } from '../../../lib/testing/nextResolve.mjs';
import { stubPath } from '../../../lib/testing/stubDir.mjs';
import { heroName, shortSchoolName, HERO_NAME_MAX } from '../../../lib/gridiron/heroName.js';

install();
const ACTIONS = stubPath('__follows_stub.mjs');
writeFileSync(ACTIONS, 'export async function followTeam() { return { ok: true }; }\nexport async function unfollowTeam() { return { ok: true }; }\n');
registerHooks({ resolve(spec, ctx, next) {
  if (spec === '@/app/actions/follows') return { url: pathToFileURL(ACTIONS).href, shortCircuit: true };
  return next(spec, ctx);
} });
after(() => { try { unlinkSync(ACTIONS); } catch { /* gone */ } });

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

let React; let renderToStaticMarkup; let GameTeamRow;
before(async () => {
  React = (await import('react')).default;
  ({ renderToStaticMarkup } = await import('react-dom/server'));
  GameTeamRow = (await import('../../../components/gridiron/GameTeamRow.js')).default;
});

const WKU = { id: 1, name: 'Western Kentucky', abbreviation: 'WKU', colors: { primary: '#C60C30', secondary: '#FFFFFF' } };
const OSU = { id: 2, name: 'Ohio State', abbreviation: 'OSU', colors: { primary: '#BB0000', secondary: '#666666' } };

const row = (t) => renderToStaticMarkup(React.createElement(GameTeamRow, { t, label: heroName(t), score: 7, show: true }));

test('the header uses the short name for a long team, with the full name kept in title', () => {
  const html = row(WKU);
  assert.match(html, /<span class="tname" title="Western Kentucky">W\. Kentucky<\/span>/);
  assert.doesNotMatch(html, /class="tname"[^>]*>Western Kentucky</);
});

test('a short name is printed as is, with no title', () => {
  assert.match(row(OSU), /<span class="tname">Ohio State<\/span>/);
});

test('real names: the abbreviation rules, then the stored abbreviation, never past the limit by choice', () => {
  const cases = [
    [{ name: 'Western Kentucky', abbreviation: 'WKU' }, 'W. Kentucky'],
    [{ name: 'Eastern Illinois', abbreviation: 'EIU' }, 'E. Illinois'],
    [{ name: 'Michigan State', abbreviation: 'MSU' }, 'Michigan St.'],
    [{ name: 'Mississippi State', abbreviation: 'MSST' }, 'MSST'],
    [{ name: 'Florida Atlantic', abbreviation: 'FAU' }, 'FAU'],
    [{ name: 'Notre Dame', abbreviation: 'ND' }, 'Notre Dame'],
    [{ name: 'Northwestern State', abbreviation: null }, 'Northwestern St.'],
  ];
  for (const [team, want] of cases) assert.equal(heroName(team), want, team.name);
  // Northwestern is a school, not a compass word.
  assert.equal(shortSchoolName('Northwestern'), 'Northwestern');
  assert.equal(shortSchoolName('Southeast Missouri State'), 'SE Missouri St.');
  assert.ok(HERO_NAME_MAX <= 14);
});

test('a missing team renders TBD and no title', () => {
  assert.match(renderToStaticMarkup(React.createElement(GameTeamRow, { t: null, label: heroName(null), score: 0, show: false })),
    /<span class="tname">TBD<\/span>/);
});

test('the CFB page passes the hero label, the arcade card gets the short name, the NFL page is untouched', () => {
  assert.match(src('app/cfb/game/[slug]/page.js'), /label=\{heroName\(t\)\}/);
  assert.match(src('lib/gridiron/gamePageArcadeView.js'), /shortName: cfb \? heroName\(game\.home\)/);
  assert.doesNotMatch(src('app/nfl/game/[slug]/page.js'), /heroName/);
});
