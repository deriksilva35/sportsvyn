// components/sim/myLeagues.test.mjs - the imported-league strip has no dead link.
//
// Stage 3 shipped the strip with `<Link href={`/sim/league/${l.id}`}>`, a route
// that does not exist. Stage 3B replaced it with the real start action. This
// pins that: the served surface starts the draft, and nothing on it points at
// a page the app does not have.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const strip = stripComments(src('components/sim/MyLeagues.js'));
const start = stripComments(src('components/sim/LeagueStart.js'));
const actions = stripComments(src('app/actions/sim.js'));
const room = stripComments(src('components/sim/DraftRoom.js'));
const css = src('components/sim/sim.css');

test('MyLeagues has no /sim/league/ link and no route for one exists', () => {
  assert.equal((strip.match(/sim\/league\//g) ?? []).length, 0, 'no link into /sim/league/');
  assert.equal((strip.match(/<Link/g) ?? []).length, 0, 'the card is not a link at all');
  assert.ok(!existsSync(path.join(REPO, 'app/sim/league')), 'no app/sim/league route');
  assert.match(strip, /<LeagueStart configId=\{l\.id\} \/>/);
});

test('LeagueStart calls the server action and lands in the room route', () => {
  assert.match(start, /startLeagueDraft\(configId, \{\}\)/);
  assert.match(start, /router\.push\(`\/sim\/draft\/\$\{res\.draftId\}`\)/);
  assert.match(start, /\/signin\?callbackUrl=\/sim/);
  assert.match(actions, /export async function startLeagueDraft\(configId, opts = \{\}\)/);
  assert.match(actions, /startLeagueDraftFor\(userId, Number\(configId\), opts\)/);
});

test('room: minors render as a muted section under the roster; a nameless entry is position + Devy', () => {
  assert.match(room, /className="rminors-h">Minors · \{/);
  assert.match(room, /m\.name \?\? `\$\{m\.position\} · Devy`/);
  assert.match(room, /m\.alsoKeeper \? <span className="tm"> · kept<\/span> : null/);
});

// ---- Stage 5: the room renders the shelf ----------------------------------
test('board: an unmade keeper cell renders muted with a KEEPER tag, outranks CLOCK, and a committed keeper keeps its marker', () => {
  const fn = room.slice(room.indexOf('function BoardCell'));
  const at = (n) => { const i = fn.indexOf(n); assert.ok(i > -1, `${n} present`); return i; };
  assert.ok(at('if (cell.keeper && !cell.pick)') < at('if (cell.onClock)'), 'keeper branch precedes the clock branch');
  assert.ok(at('if (cell.onClock)') < at('if (!cell.pick)'), 'clock precedes empty');
  assert.match(fn, /className=\{`bc kp \$\{posClass\(kpos\)\}/);
  assert.match(fn, /\{kpos\} · KEEPER/);
  assert.match(fn, /cell\.pick\.isKeeper \? ' · KEPT' : ''/);
  assert.match(css, /\.bg2 \.bc\.kp \{ opacity: \.55;/);
});

test('roster: kept players render pre-commit as kept · R<n>, counted apart from drafted; pending list drops a landed overall', () => {
  assert.match(room, /buildRoster\(userPicks, config\.roster_slots, myPendingKeepers\)/);
  assert.match(room, /\{draftedCount\} drafted \+ \{keptCount\} kept/);
  assert.match(room, /kept · R\{s\.kept\.round\}/);
  assert.match(room, /kept · R\{s\.pick\.round\}/);
  assert.match(room, /\(upcomingKeepers \?\? \[\]\)\.filter\(\(k\) => !made\.has\(k\.overall\)\)/);
  assert.match(room, /keepers: pendingKeepers/);
  // The pick tab is untouched: nothing offers a pending keeper (available is server-filtered).
  assert.equal((room.match(/pendingKeepers/g) ?? []).length, 5, 'declared once, filtered into myPendingKeepers (2), board ctx + deps (2) - nothing else');
});
