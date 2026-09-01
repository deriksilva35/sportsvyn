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
