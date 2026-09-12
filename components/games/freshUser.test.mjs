// components/games/freshUser.test.mjs — FRESH-USER FIXES D1 and D12: the
// sign-in copy, and one deadline per Weekly screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('D1: the sign-in page says when the handle comes, and no longer asks for one up front', () => {
  const t = src('app/signin/page.js');
  assert.match(t, /Your handle - the name beside your score - comes when you make your first pick\./);
  assert.doesNotMatch(t, /Pick a handle - the name beside your score in every game\./);
});

test('D12: the Weekly confirm card renders no lock instant - the header owns the deadline', () => {
  const room = strip(src('components/weekly/WeeklyRoom.js'));
  const card = room.slice(room.indexOf('<ConfirmCard'), room.indexOf('/>', room.indexOf('<ConfirmCard')));
  assert.doesNotMatch(card, /lockIso|locks_at|locksAt|lockPre/, 'the card carries no locks line');
  assert.match(card, /note="Whatever is here at each kickoff is your entry\."/);
  // The header still alternates first kickoff -> locks, untouched.
  const page = strip(src('app/weekly/page.js'));
  assert.match(page, /\{beforeFirst \? 'first kickoff ' : 'locks '\}<StandaloneDate iso=\{beforeFirst \? firstKickoff : contest\.locks_at\} \/>/);
  // Per-slot times stay.
  assert.match(room, /\{isLocked \? 'Locked · ' : 'Locks '\}<StandaloneTime iso=\{p\.kickoff_at\} \/>/);
  // The Pick'em card still hands ConfirmCard its first lock - only the Weekly dropped it.
  assert.match(strip(src('components/pickem/PickemBoard.js')), /lockIso=\{locksAt\}/);
});

test('D3: the Weekly beacon no longer bails without a handle, and a held write paints the slot', () => {
  const room = strip(src('components/weekly/WeeklyRoom.js'));
  assert.doesNotMatch(room, /hasHandleRef/);
  assert.match(room, /navigator\.sendBeacon\?\.\('\/api\/weekly\/save'/);
  assert.match(room, /if \(guard\(\(\) => flush\(pending\.current\), slot\) === HELD\) setSave\('held'\)/);
  assert.match(room, /held: 'Needs a handle'/);
  assert.match(room, /\$\{held \? ' wk-pending' : ''\}/);
  assert.match(room, /onClick=\{\(\) => \(held \? reopenHandle\(\) : openSlot\(s\)\)\}/);
  assert.match(room, /queue\(next, active\)/); assert.match(room, /queue\(next, slot\)/);
  // The server side has no handle rule on the entry - the beacon's write lands.
  assert.doesNotMatch(strip(src('lib/weekly/entries.js')), /handle/i);
  assert.doesNotMatch(strip(src('app/api/weekly/save/route.js')), /handle/i);
  // And the modal's own copy no longer promises to drop the entry.
  const gate = strip(src('components/handle/HandleGate.js'));
  assert.doesNotMatch(gate, /Not now leaves this entry unsaved/);
  assert.match(gate, /Not now keeps your pick on the board, marked until you claim a handle\./);
});
