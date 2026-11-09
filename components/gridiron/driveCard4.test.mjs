// components/gridiron/driveCard4.test.mjs - drive-4: the ball under the lines at the goal line, and the
// line score's fixed-width columns (markup + CSS level, as scoresLandscape.test.mjs reads its CSS).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { install } from '../../lib/testing/nextResolve.mjs';
install();

let React, renderToStaticMarkup, DriveCard, ExpandLine, driveCardFor;
before(async () => {
  React = await import('react');
  ({ renderToStaticMarkup } = await import('react-dom/server'));
  DriveCard = (await import('./DriveCard.js')).default;
  ({ ExpandLine } = await import('../scores/ExpandCard.js'));
  ({ driveCardFor } = await import('../../lib/gridiron/driveCard.js'));
});

const NOW = new Date('2026-11-08T21:00:00Z');
const game = { home: { id: 1, abbreviation: 'NO', colors: { primary: '#D3BC8D' } }, away: { id: 2, abbreviation: 'CLE', colors: { primary: '#FF3C00' } } };
const snap = (o) => ({ period: 4, clock: '0:58', down: 1, distance: 1, yardsToGoal: 1, yardsGained: 0, offenseTeamId: 1, playType: 'rush', text: 'x', scoring: false, driveId: 'r9', createdAt: NOW.toISOString(), ...o });
const html = (plays) => renderToStaticMarkup(React.createElement(DriveCard, { dc: driveCardFor({ plays, game, now: NOW }) }));
const at = (h, tag) => h.indexOf(tag);
const attr = (h, tag, name) => Number(new RegExp(`${tag}[^>]*? ${name}="([\\d.]+)"`).exec(h)?.[1]);

test('goal line: the LOS (and the first-down line) are drawn OVER the ball, so the dot cannot hide them', () => {
  const h = html([snap()]);
  assert.ok(at(h, 'data-ball') > 0 && at(h, 'data-los') > at(h, 'data-ball'), 'LOS after the ball in paint order');
  const mid = html([snap({ yardsToGoal: 30, distance: 10, offenseTeamId: 2 })]);
  assert.ok(at(mid, 'data-firstdown') > at(mid, 'data-ball') && at(mid, 'data-los') > at(mid, 'data-firstdown'), 'ball, first-down line, LOS');
});

test('goal line: the dot stays inside the field of play, one radius in from the goal line, on both ends', () => {
  const home = html([snap({ offenseTeamId: 1, yardsToGoal: 1 })]);       // home attacks right: LOS at 324.98
  assert.equal(attr(home, '<line data-los', 'x1'), 324.98, 'the LOS itself is where the play is');
  assert.equal(attr(home, '<circle data-ball', 'cx'), 321, 'the dot is kept inside the right goal line');
  const away = html([snap({ offenseTeamId: 2, yardsToGoal: 1 })]);        // away attacks left: LOS at 29
  assert.equal(attr(away, '<circle data-ball', 'cx'), 33);
  const mid = html([snap({ offenseTeamId: 2, yardsToGoal: 50, distance: 10 })]);
  assert.equal(attr(mid, '<circle data-ball', 'cx'), attr(mid, '<line data-los', 'x1'), 'mid-field the dot is centred on the LOS, unchanged');
});

test('scoring moment: the ball still rests just inside the goal line, not clamped away from it', () => {
  const td = snap({ playType: 'rushing-touchdown', scoring: true, homeScore: 6, awayScore: 0, yardsToGoal: 1, yardsGained: 1 });
  const h = html([td]);
  assert.equal(attr(h, '<circle data-ball', 'cx'), 321);
});

// ---------------------------------------------------------------- the line score

const line = { columns: ['1', '2', '3', '4'], total: 'T', extra: ['OT'], rows: [
  { side: 'away', abbr: 'ORE', cells: ['7', '3', '12', '0'], total: '22', extra: ['0'] },
  { side: 'home', abbr: 'OSU', cells: ['14', '7', '10', '7'], total: '38', extra: ['0'] },
] };

test('line score markup: one header cell per body cell, the code column first, T after the quarters and before OT', () => {
  const h = renderToStaticMarkup(React.createElement(ExpandLine, { line }));
  const head = [...h.matchAll(/<th scope="col"([^>]*)>([^<]*)<\/th>/g)].map((m) => m[2]);
  assert.deepEqual(head, ['', '1', '2', '3', '4', 'T', 'OT']);
  for (const side of ['away', 'home']) {
    const tr = new RegExp(`<tr data-side="${side}">(.*?)</tr>`).exec(h)[1];
    assert.equal((tr.match(/<td/g) ?? []).length, 6, 'Q1-Q4, T, OT');
    assert.match(tr, /^<th scope="row">/);
  }
});

test('line score CSS: fixed table layout, one width for every period column (Q and OT), T a step wider', () => {
  const css = readFileSync(new URL('../../app/scores/scoresV4.css', import.meta.url), 'utf8');
  const rule = (sel) => [...css.matchAll(new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]).join(' ');
  const A = ':where(:root[data-theme="arcade"])';
  assert.match(rule(`${A} .sv4-ls`), /table-layout:\s*fixed/);
  const period = rule(`${A} .sv4-ls thead th:not(:first-child)`);
  const total = rule(`${A} .sv4-ls thead th.t`);
  assert.match(period, /width:\s*3em/, 'every period header, OT included, is the same width');
  assert.match(total, /width:\s*3\.5em/);
  assert.ok(parseFloat(/width:\s*([\d.]+)em/.exec(total)[1]) > parseFloat(/width:\s*([\d.]+)em/.exec(period)[1]), 'T is wider than a period');
  // The earlier rule must not undo it: no width on the body cells that would disagree with the header.
  assert.doesNotMatch(css.split('\n').filter((l) => /\.sv4-ls\s+td/.test(l)).join('\n'), /(^|[;{\s])width:/);
});
