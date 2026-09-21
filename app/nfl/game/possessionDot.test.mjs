// app/nfl/game/possessionDot.test.mjs - the volt dot on the game-page score
// strip, RENDERED, for both gridiron pages.
//
// IT LIVES HERE AND COVERS BOTH CODES because the strip is one component
// since the TEAM FOLLOWING relay: app/nfl/game/[slug] and app/cfb/game/[slug]
// render the same components/gridiron/GameTeamRow.js, and the CFB page
// imports the NFL page's stylesheet. One row, one rule, one test - a second
// copy here would be the drift this relay is removing, not preventing.
//
// IT MOUNTS THE COMPOSITION, NOT JUST THE ROW. A row handed hasBall={true}
// drawing a dot proves nothing anyone was worried about. What can be wrong is
// the JOIN: the drive chart's offense, run through the reader, landing on the
// row the reader named. So the test builds real plays, runs the real
// buildDriveChart(), asks the real possessionSide(), and renders the two rows
// in the real league order - the same four steps the page performs.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { install } from '../../../lib/testing/nextResolve.mjs';
import { buildDriveChart } from '../../../lib/gridiron/driveStrip.js';
import { possessionSide } from '../../../lib/gridiron/possession.js';
import { orderFor } from '../../../lib/gridiron/teamOrder.js';

install();

// THE ROW IMPORTS THE FOLLOW STAR, WHICH IMPORTS A SERVER ACTION, WHICH OPENS
// THE DATABASE - at import time, before a single row renders. The star itself
// is not on trial here and never draws in these cases (it is signed-in only),
// so its two actions are stubbed rather than the whole component: everything
// else in the row, the dot included, stays the code the page ships.
const ACTIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), '__follows_stub.mjs');
writeFileSync(ACTIONS, 'export async function followTeam() { return { ok: true }; }\nexport async function unfollowTeam() { return { ok: true }; }\n');
registerHooks({ resolve(spec, ctx, next) {
  if (spec === '@/app/actions/follows') return { url: pathToFileURL(ACTIONS).href, shortCircuit: true };
  return next(spec, ctx);
} });
after(() => { try { unlinkSync(ACTIONS); } catch { /* gone */ } });

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let React; let renderToStaticMarkup; let GameTeamRow;
before(async () => {
  React = (await import('react')).default;
  ({ renderToStaticMarkup } = await import('react-dom/server'));
  GameTeamRow = (await import('../../../components/gridiron/GameTeamRow.js')).default;
});

const HOME = { id: 3202, abbreviation: 'TEN', name: 'Titans', colors: { primary: '#0C2340', secondary: '#4B92DB' } };
const AWAY = { id: 3201, abbreviation: 'NYJ', name: 'Jets', colors: { primary: '#125740', secondary: '#FFFFFF' } };
const TEAM_ABBR = new Map([[HOME.id, HOME.abbreviation], [AWAY.id, AWAY.abbreviation]]);

// A drive in progress, offense named on its snaps - the shape playsFor() hands
// the page.
const playsFor = (offenseTeamId) => [
  { driveId: 7, driveNumber: 7, offenseTeamId, down: 1, distance: 10, yardsToGoal: 62, period: 3, clock: '8:41', text: 'run' },
  { driveId: 7, driveNumber: 7, offenseTeamId, down: 2, distance: 6, yardsToGoal: 58, period: 3, clock: '8:02', text: 'pass' },
];

/**
 * THE PAGE'S OWN FOUR STEPS. Kept in one place so every case below differs by
 * exactly the input it is about.
 */
function strip({ offenseTeamId = HOME.id, leagueSlug = 'nfl', status = 'live', liveState = { period: 3, clock: '8:02' } } = {}) {
  const drives = buildDriveChart(playsFor(offenseTeamId), { homeTeamId: HOME.id, teamAbbr: TEAM_ABBR });
  const currentDrive = drives[0] ?? null;
  const ballSide = possessionSide({
    leagueSlug, status, possession: currentDrive?.offenseAbbr ?? null,
    homeAbbr: HOME.abbreviation, awayAbbr: AWAY.abbreviation, liveState,
  });
  const rows = orderFor(leagueSlug).map((side) => renderToStaticMarkup(
    React.createElement(GameTeamRow, {
      key: side, t: side === 'home' ? HOME : AWAY,
      score: side === 'home' ? 14 : 7, loser: false, show: true,
      hasBall: ballSide === side,
    }),
  ));
  return { html: rows.join(''), ballSide };
}

// The letters a dotted row carries, in render order.
const dotted = (html) => [...html.matchAll(/<span class="abbr">([^<]*)<i class="gi-poss"/g)].map((m) => m[1]);

test('HOME HAS IT: the dot draws on the home row of the score strip, and only there', () => {
  const { html, ballSide } = strip({ offenseTeamId: HOME.id });
  assert.equal(ballSide, 'home');
  assert.deepEqual(dotted(html), ['TEN']);
  assert.equal((html.match(/gi-poss/g) ?? []).length, 1, 'one dot on the strip');
  // AFTER the abbreviation, inside its span - not floating between children of
  // a flex row whose child count has broken this layout before.
  assert.match(html, /<span class="abbr">TEN<i class="gi-poss" role="img" aria-label="TEN has the ball"><\/i><\/span>/);
  // The rest of the row is untouched.
  assert.match(html, /<span class="tname">Titans<\/span>/);
  assert.match(html, /<span class="score">14<\/span>/);
});

test('AWAY HAS IT: the same strip, the other row - the dot follows the team, not the position', () => {
  const { html, ballSide } = strip({ offenseTeamId: AWAY.id });
  assert.equal(ballSide, 'away');
  assert.deepEqual(dotted(html), ['NYJ']);
  assert.equal((html.match(/gi-poss/g) ?? []).length, 1);
  assert.match(html, /aria-label="NYJ has the ball"/);
});

test('NULL: halftime, between quarters, a finished game and an unknown offense all draw nothing', () => {
  for (const [label, opts] of [
    ['halftime', { liveState: { period: 2, clock: '0:00' } }],
    ['between quarters', { liveState: { period: 1, clock: '0:00' } }],
    ['final', { status: 'final' }],
    ['pre-kick', { status: 'scheduled' }],
    ['no offense on the feed', { offenseTeamId: null }],
  ]) {
    const { html, ballSide } = strip(opts);
    assert.equal(ballSide, null, `${label} has nobody in possession`);
    assert.deepEqual(dotted(html), [], `no dot at ${label}`);
    // The rows themselves still render in full - the strip is not gated on it.
    assert.match(html, /<span class="abbr">TEN<\/span>/, `the row survives ${label}`);
  }
});

test('NON-FOOTBALL: a league with no possession gets no dot even holding a matching abbreviation', () => {
  const { html, ballSide } = strip({ leagueSlug: 'epl' });
  assert.equal(ballSide, null);
  assert.deepEqual(dotted(html), []);
  // orderFor('epl') is home-first, so this also pins that the reader answers
  // null on its own terms rather than by the row order happening to differ.
  assert.ok(html.indexOf('Titans') < html.indexOf('Jets'), 'soccer still renders home first');
});

// ------------------------------------------------ the pages actually ask it

test('BOTH GAME PAGES ASK THE ONE READER, and neither carries a second answer', () => {
  for (const f of ['app/nfl/game/[slug]/page.js', 'app/cfb/game/[slug]/page.js']) {
    const page = stripComments(src(f));
    assert.match(page, /import \{ possessionSide \} from '@\/lib\/gridiron\/possession'/, `${f} must import the reader`);
    assert.match(page, /const ballSide = possessionSide\(\{/, `${f} must call it`);
    assert.match(page, /hasBall=\{ballSide === side\}/, `${f} must hand the answer to the row`);
    // THE SIMULATED CUT IS READ THE WAY THE STRIP READS IT. A ?asOf= replay
    // withholds the clock so the page is not judged against the clock as it
    // stands now; the dot must be given the same withheld clock, or a replay
    // of a game that is at halftime RIGHT NOW would lose its dot.
    assert.match(page, /liveState: sim\.simulated \? null : game\.liveState/, `${f} must pass the cut's clock, not today's`);
    assert.match(page, /status: sim\.simulated \? 'live' : game\.status/, `${f} must treat a replayed cut as live`);
    // No page may decide possession for itself.
    assert.equal(/offenseIsHome \? /.test(page.slice(page.indexOf('const ballSide'))), false,
      `${f} must not re-derive the side after asking`);
  }
});

test('THE SENTENCE IS GONE FROM THE STRIP, and the spot is not', () => {
  const gamecast = stripComments(src('components/gridiron/Gamecast.js'));
  assert.equal(/\$\{offenseAbbr\} ball/.test(gamecast), false, '"<TEAM> ball" no longer closes the situation line');
  assert.match(gamecast, /<div className="ds-at">at <b>\{spot\}<\/b><\/div>/, 'the spot stays, on its own');
  // down-distance-spot: both halves still come from the same two helpers.
  assert.match(gamecast, /const dd = downDistanceLabel\(/);
  assert.match(gamecast, /const spot = spotLabel\(/);
  // The board's own line lost the same words and kept the same parts.
  const boardSrc = stripComments(src('components/scores/ScoresV2.js'));
  assert.equal(/className="ball"/.test(boardSrc), false, 'the board\'s "<TEAM> ball" span is gone');
  assert.match(boardSrc, /<span className="dd">\{x\.drive\.label\}\{x\.drive\.spot \? <small>\{x\.drive\.spot\}<\/small> : null\}<\/span>/);
  assert.equal(/\.ball \{/.test(src('app/scores/scoresV2.css')), false, 'and so is its rule');
});
