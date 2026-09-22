// components/games/mlbRows.test.mjs - the MLB group on the Games page:
// where it sits, what its two rows say, and that a preview says so ON THE ROW.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { install } from '../../lib/testing/nextResolve.mjs';
install();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LINK = path.join(__dirname, '__mlbrows_link.mjs');
registerHooks({ resolve(spec, ctx, next) {
  if (spec === 'next/link') return { url: pathToFileURL(LINK).href, shortCircuit: true };
  return next(spec, ctx);
} });

let React, renderToStaticMarkup, LobbyV3, octoberRowV3, runRowV3;
before(async () => {
  writeFileSync(LINK, "import React from 'react'; export default function Link({href,children,...r}){return React.createElement('a',{...r,href:String(href)},children);}\n");
  React = await import('react');
  ({ renderToStaticMarkup } = await import('react-dom/server'));
  LobbyV3 = (await import('./LobbyV3.js')).default;
  ({ octoberRowV3, runRowV3 } = await import('../../lib/games/lobbyV3.js'));
});
after(() => { try { unlinkSync(LINK); } catch { /* gone */ } });

const NOW = new Date('2026-09-22T21:30:00Z');
const octContest = (o = {}) => ({
  id: 17, locks_at: '2026-09-23T02:10:00Z', board: new Array(16).fill({}),
  meta: { games: 16, preview: true, season_label: 'PREVIEW · regular season' }, ...o,
});
const runContest = (o = {}) => ({
  id: 23, puzzle_date: '2026-09-24',
  meta: { preview: true, label: 'Wild Card · preview', firstPitch: '2026-09-24T16:35:00Z' }, ...o,
});

// ---------------------------------------------------------------- the rows

test('THE OCTOBER ROW carries its state and its door', () => {
  const open = octoberRowV3(octContest(), NOW);
  assert.equal(open.key, 'october');
  assert.equal(open.name, 'October · five a day');
  assert.equal(open.href, '/october');
  assert.equal(open.line, "Today's card is open · 16 games");
  assert.equal(open.tone, 'live');
  // A PREVIEW SAYS SO ON THE ROW - a reader deciding whether to tap should
  // not have to tap to find out.
  assert.equal(open.right, 'PREVIEW');

  // Once the last first pitch has passed the card is locked and says so.
  const locked = octoberRowV3(octContest(), new Date('2026-09-23T03:00:00Z'));
  assert.equal(locked.line, "16 games · today's card is locked");
  assert.equal(locked.tone, 'done');

  // THE REAL THING NAMES ITS LOCK TIME instead of shouting PREVIEW.
  const real = octoberRowV3(octContest({ meta: { games: 4 } }), NOW);
  assert.equal(real.right, null);
  // PACIFIC, AND SAID OUT LOUD. This row names the SAME first pitch the October
  // card names, and the card is PT (lib/gridiron/kickoff.js HOUSE_TZ) - a row in
  // one zone and a card in the other is two answers to one question on two
  // screens a tap apart. The old comment here claimed Eastern was "the one zone
  // this site states locks in", which was never true of the app deck.
  assert.match(real.rightLabel, /^\d{1,2}:\d{2} (AM|PM) PT$/, 'the house zone, named');
});

test('THE RUN ROW names the clock it locks on', () => {
  const open = runRowV3(runContest(), NOW);
  assert.equal(open.key, 'run');
  assert.equal(open.name, 'The Run · nine a round');
  assert.equal(open.href, '/run');
  assert.equal(open.line, 'Locks 9:35 AM PT · Thu');
  assert.equal(open.right, 'PREVIEW');
  assert.equal(open.tone, 'live');

  // A round that has locked names the round it is, not a clock that is past.
  const locked = runRowV3(runContest(), new Date('2026-09-24T18:00:00Z'));
  assert.equal(locked.line, 'Wild Card · preview · locked');
  assert.equal(locked.tone, 'done');
});

test('A ROW WITH NOTHING BEHIND IT IS STILL A ROW, and says so', () => {
  // Hiding it would make the group appear and disappear between visits for
  // reasons nobody can see; the dead "MLB 2027" chip is the other failure
  // mode, and a row that states its own emptiness avoids both.
  for (const r of [octoberRowV3(null, NOW), runRowV3(null, NOW)]) {
    assert.equal(r.line, 'Opens with the bracket');
    assert.equal(r.tone, 'muted');
    assert.ok(r.href, 'and it still has a door');
  }
});

// --------------------------------------------------------------- the group

const view = (mlb) => ({
  handle: 'dsilva35', chip: 'week',
  week: {
    now: null, week: 4, practice: [],
    rows: [
      { key: 'daily', mark: 'D', name: 'The Daily', href: '/daily', line: 'x' },
      { key: 'weekly', mark: 'W', name: 'The Weekly', href: '/weekly', line: 'x' },
      { key: 'pickem', mark: 'P', name: "Pick'em", href: '/pickem', line: 'x' },
      { key: 'draft', mark: 'R', name: 'The Draft', href: '/draft', line: 'x' },
    ],
    mlb,
  },
  boards: [], graded: [],
});
const html = (mlb) => renderToStaticMarkup(React.createElement(LobbyV3, {
  v: view(mlb), signedIn: true, signinHref: (h) => `/signin?next=${h}`,
}));

test('THE GROUP SITS UNDER THE FOUR, not among them', () => {
  const h = html([octoberRowV3(octContest(), NOW), runRowV3(runContest(), NOW)]);
  const order = [...h.matchAll(/data-row="(\w+)"/g)].map((m) => m[1]);
  // The four football rows first, in their own order, THEN the two MLB ones.
  assert.deepEqual(order, ['daily', 'weekly', 'pickem', 'draft', 'october', 'run']);
  // Its own labelled heading, so the reader is not asked to infer that two
  // rows below the NFL week belong to a different sport on a different clock.
  assert.match(h, /data-group="mlb"><h3>MLB<\/h3>/);
  // AND THE HEADING SAYS WHAT THE ROWS SAY - PREVIEW over two PREVIEW rows.
  assert.match(h, /data-group="mlb">[\s\S]*?<span>PREVIEW<\/span>/);
  assert.equal([...h.matchAll(/October · five a day/g)].length, 1);
  assert.match(h, /The Run · nine a round/);
});

test('THE GROUP READS POSTSEASON once the rows are not previews', () => {
  const h = html([
    octoberRowV3(octContest({ meta: { games: 4 } }), NOW),
    runRowV3(runContest({ meta: { label: 'Wild Card', firstPitch: '2026-09-29T17:05:00Z' } }), NOW),
  ]);
  assert.match(h, /data-group="mlb">[\s\S]*?<span>POSTSEASON<\/span>/);
  assert.doesNotMatch(h, /PREVIEW/);
});

test('NO MLB GROUP AT ALL when there are no rows to put in it', () => {
  const h = html([]);
  assert.doesNotMatch(h, /data-group="mlb"/);
  assert.deepEqual([...h.matchAll(/data-row="(\w+)"/g)].map((m) => m[1]),
    ['daily', 'weekly', 'pickem', 'draft']);
});
