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

test('D12: the Weekly room states no deadline of its own - the header owns it', () => {
  const room = strip(src('components/weekly/WeeklyRoom.js'));
  // THE RULE IS UNCHANGED; THE SURFACE IT APPLIES TO IS THE FOOTER NOW (v2).
  // The confirm card is gone, so what must not appear is a lock instant
  // anywhere in the room: the deadline belongs to the page header, and the
  // room's own times are per-slot kickoffs and the confirm receipt.
  const footer = room.slice(room.indexOf('wkv-ft'));
  assert.doesNotMatch(footer, /lockIso|locks_at|locksAt|lockPre/, 'the footer carries no locks line');
  assert.match(footer, /Locked in <StandaloneTime iso=\{confirmedAt\} \/>/, 'only the receipt, through an island');
  assert.match(footer, /edit any open slot until its kickoff/);
  // The page header still alternates first kickoff -> locks, untouched.
  const page = strip(src('app/weekly/page.js'));
  assert.match(page, /\{beforeFirst \? 'first kickoff ' : 'locks '\}<StandaloneDate iso=\{beforeFirst \? firstKickoff : contest\.locks_at\} \/>/);
  // PER-SLOT TIMES STAY, and still go through the island rather than a
  // formatted string: an open slot names its player's kickoff.
  assert.match(room, /<StandaloneTime iso=\{p\.kickoff_at\} \/>/);
  assert.match(room, /next lock <StandaloneTime iso=\{nextLockIso\} \/>/, 'and so does the next lock');
  // THE PICK'EM RENDERS NO CARD AT ALL NOW (v2, R4): its confirm is the board's
  // own footer button. D12's rule is about the WEEKLY's card, and it is
  // unchanged; what the Pick'em must still do is name its next lock through an
  // island rather than a formatted string, which it does in the header.
  const board = strip(src('components/pickem/PickemBoard.js'));
  assert.doesNotMatch(board, /<ConfirmCard/);
  assert.match(board, /next lock <b>\{cd\}<\/b>/, 'the next lock is named, from the countdown');
});

test('D3: the Weekly beacon no longer bails without a handle, and a held write paints the slot', () => {
  const room = strip(src('components/weekly/WeeklyRoom.js'));
  assert.doesNotMatch(room, /hasHandleRef/);
  assert.match(room, /navigator\.sendBeacon\?\.\('\/api\/weekly\/save'/);
  assert.match(room, /if \(guard\(\(\) => flush\(pending\.current\), slot\) === HELD\) setSave\('held'\)/);
  assert.match(room, /held: 'Needs a handle'/);
  assert.match(room, /\$\{held \? ' wkv-pending' : ''\}/);
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
