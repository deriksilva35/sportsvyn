// components/pickem/sportSwitch.test.mjs - the board page's NFL / CFB switch.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { install } from '../../lib/testing/nextResolve.mjs';
install();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const LINK = path.join(__dirname, '__link_stub_switch.mjs');
registerHooks({ resolve(spec, ctx, next) {
  if (spec === 'next/link') return { url: pathToFileURL(LINK).href, shortCircuit: true };
  return next(spec, ctx);
} });

let React, renderToStaticMarkup, SportSwitch;
before(async () => {
  writeFileSync(LINK, "import React from 'react'; export default function Link({ href, children, ...rest }) { return React.createElement('a', { ...rest, href: String(href) }, children); }\n");
  React = await import('react');
  ({ renderToStaticMarkup } = await import('react-dom/server'));
  SportSwitch = (await import('./SportSwitch.js')).default;
});
after(() => { try { unlinkSync(LINK); } catch { /* gone */ } });

const NFL = { sport: 'nfl', pickedOpen: 14, pickable: 14, settled: false };
const CFB = { sport: 'cfb', pickedOpen: 0, pickable: 9, settled: false };
const html = (props) => renderToStaticMarkup(React.createElement(SportSwitch, props));

test('both boards exist: two pills, the current one filled and inert, each with its own state', () => {
  const onNfl = html({ boards: [NFL, CFB], sport: 'nfl' });
  assert.match(onNfl, /<nav class="pk-switch" aria-label="Pick&#x27;em sport">/);
  // current = a span, marked, NOT a link to itself
  assert.match(onNfl, /<span class="pk-sw on" aria-current="page">NFL<small>14 of 14<\/small><\/span>/);
  assert.doesNotMatch(onNfl, /href="\/pickem\/nfl"/, 'the current sport is not a link to itself');
  // the other = a link carrying its own count
  assert.match(onNfl, /<a class="pk-sw" href="\/pickem\/cfb">CFB<small>0 of 9<\/small><\/a>/);
  assert.equal((onNfl.match(/class="pk-sw[ "]/g) ?? []).length, 2, 'two pills, no more');

  // and the mirror image on the CFB board
  const onCfb = html({ boards: [NFL, CFB], sport: 'cfb' });
  assert.match(onCfb, /<a class="pk-sw" href="\/pickem\/nfl">NFL<small>14 of 14<\/small><\/a>/);
  assert.match(onCfb, /<span class="pk-sw on" aria-current="page">CFB<small>0 of 9<\/small><\/span>/);
  assert.doesNotMatch(onCfb, /href="\/pickem\/cfb"/);
});

test('one board, or none: no switch at all', () => {
  assert.equal(html({ boards: [NFL], sport: 'nfl' }), '', 'a control with one option is furniture');
  assert.equal(html({ boards: [], sport: 'nfl' }), '');
  assert.equal(html({ boards: [CFB], sport: 'cfb' }), '');
  // a sport with no current board simply never appears
  assert.doesNotMatch(html({ boards: [NFL, CFB], sport: 'nfl' }), /epl/i);
});

test('a settled board says so instead of a count', () => {
  const h = html({ boards: [{ ...NFL, settled: true }, CFB], sport: 'cfb' });
  assert.match(h, /<a class="pk-sw" href="\/pickem\/nfl">NFL<small>settled<\/small><\/a>/);
});

test('the page feeds it both boards and the board renders it under its own clock', () => {
  const page = readFileSync(path.join(REPO, 'app/pickem/[sport]/page.js'), 'utf8');
  assert.match(page, /PICKEM_SPORTS\.map\(async \(s\) => \{/, 'both sports, not just this one');
  assert.match(page, /pickemCardData\(uid, \{ sport: s, now \}\)/);
  assert.match(page, /<SportSwitch boards=\{boards\} sport=\{sport\} \/>/);
  assert.match(page, /sportSwitch=\{sportSwitch\}/, 'handed to the living board');
  assert.match(page, /\{view\.phase !== 'living' && sportSwitch\}/, 'and still shown on the other phases');
  const board = readFileSync(path.join(REPO, 'components/pickem/PickemBoard.js'), 'utf8');
  const after = board.slice(board.indexOf('<span className="clock">'));
  assert.match(after.slice(0, 400), /\{sportSwitch\}/, 'directly under the board header');
  // the pills are styled, current filled
  const css = readFileSync(path.join(REPO, 'app/pickem/pickem.css'), 'utf8');
  assert.match(css, /\.pk-sw\.on \{ background: var\(--volt\)/);
});
