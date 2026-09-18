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

test('D12: ONE deadline per Weekly screen - and the room owns it now', () => {
  const room = strip(src('components/weekly/WeeklyRoom.js'));
  // D12'S RULE IS UNCHANGED AND ITS OWNER MOVED (weekly-hdr relay item 2).
  // The rule was always "one deadline per Weekly screen"; the header used to
  // be the one that stated it. But the Weekly has had no single lock since the
  // rolling lock shipped - each slot locks at its own player's kickoff - so a
  // page-level "first kickoff / locks" stamp was naming a deadline that does
  // not exist, while the room's "next lock" named the one that does. The stamp
  // is gone and the room's line is the deadline.
  const footer = room.slice(room.indexOf('wkv-ft'));
  assert.doesNotMatch(footer, /lockIso|locks_at|locksAt|lockPre/, 'the footer carries no locks line');
  assert.match(footer, /Locked in <StandaloneTime iso=\{confirmedAt\} weekday zone=\{false\} \/>/,
    'only the receipt, through an island, and it names its day');
  assert.match(footer, /edit any open slot until its kickoff/);

  // THE HEADER STATES NO DEADLINE AT ALL. This is the assertion the old one
  // inverted: what used to be required is now forbidden.
  const page = strip(src('app/weekly/page.js'));
  const header = page.slice(page.indexOf('<header className="hdr">'), page.indexOf('<WeeklyRoom'));
  assert.doesNotMatch(header, /StandaloneDate|StandaloneTime|first kickoff|locks_at/,
    'the page header names no deadline - the room does');
  assert.match(header, /The Weekly &middot; Week \{contest\.week\}/, 'the eyebrow stays');
  assert.match(header, /<h1>Week \{contest\.week\}<\/h1>/, 'and the title');

  // EXACTLY ONE LOCK OR KICKOFF STAMP OUTSIDE THE SLOT ROWS. The room's own
  // per-slot kickoffs are inside the rows and do not count; "next lock" is the
  // one, and there is no second.
  const outside = room.slice(0, room.indexOf('wkv-rows')) + footer;
  const stamps = outside.match(/next lock <StandaloneTime|locks <StandaloneTime|first kickoff <Standalone/g) ?? [];
  assert.equal(stamps.length, 1, `one deadline outside the rows, found ${stamps.length}`);

  // PER-SLOT TIMES STAY, still through the island, and now carry their day:
  // a slate that runs Thursday to Monday printed "5:15 PM" on two rows four
  // days apart with nothing to tell them apart.
  assert.match(room, /<StandaloneTime iso=\{p\.kickoff_at\} weekday zone=\{false\} \/>/);
  assert.match(room, /next lock <StandaloneTime iso=\{nextLockIso\} weekday \/>/, 'and so does the next lock');

  // THE ZONE SUFFIX LANDS ONCE. Only the next-lock stamp keeps it; every other
  // Weekly time drops it, because eight rows repeating the reader's own zone is
  // noise and dropping it everywhere would leave the board on no stated clock.
  const zoned = room.match(/<StandaloneTime iso=\{[^}]+\}(?! weekday zone=\{false\})[^/]*\/>/g) ?? [];
  assert.equal(zoned.length, 1, `exactly one zoned time in the room, found ${zoned.length}: ${zoned.join(' | ')}`);
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
