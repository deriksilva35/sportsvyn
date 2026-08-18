// components/sim/liveDraftCard.test.mjs - the resume path.
//
// The lobby never asked whether the user was already in a draft. It ran three
// reads - presets, drafts-used, membership - and rendered the preset deck under
// a "Start a mock draft" kicker regardless. u35 made three real picks, left, and
// had no visible way back for sixteen hours; the room was reachable only from
// the HISTORY tab, listed among finished drafts, and it was holding one of their
// three free credits the whole time.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveRounds } from '../../lib/fantasy/config.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const card = stripComments(src('components/sim/LiveDraftCard.js'));
const lobby = stripComments(src('app/sim/page.js'));
const drafts = stripComments(src('lib/fantasy/drafts.js'));
const css = src('components/sim/sim.css');

test('NO OPEN DRAFT RENDERS NOTHING - the deck just moves up', () => {
  assert.match(card, /if \(!draft\) return null;/);
  const guard = card.indexOf('if (!draft) return null');
  assert.ok(guard > -1 && guard < card.indexOf('<section className="livedraft"'), 'the guard precedes any markup');
});

test('IT SITS ABOVE THE DECK, because a room you are in outranks starting another', () => {
  const at = (n) => { const i = lobby.indexOf(n); assert.ok(i > -1, `${n} must be present`); return i; };
  assert.ok(at('<LiveDraftCard') < at('<StartForm'), 'card before the preset deck');
});

test('the read rides the existing round trip, not a fourth query', () => {
  assert.match(lobby, /const \[presets, used, member, openDraft\] = await Promise\.all\(\[\s*\n?\s*getPresets\(\), getDraftsUsed\(userId\), isMember\(userId\), getOpenSimDraft\(userId\),/);
});

test('the reader is scoped to SIM, IN PROGRESS, and to the owner', () => {
  const fn = drafts.slice(drafts.indexOf('export async function getOpenSimDraft'), drafts.indexOf('export async function getDraftHistory'));
  assert.match(fn, /d\.user_id = \$\{userId\}/, 'never another user\'s draft');
  assert.match(fn, /d\.mode = 'sim'/, "tracker has its own resume path and its own tab");
  assert.match(fn, /d\.status = 'in_progress'/);
  assert.match(fn, /ORDER BY d\.started_at DESC NULLS LAST, d\.id DESC\s*\n?\s*LIMIT 1/,
    'newest only - nothing forbids two open drafts and the most recent is the only defensible guess');
  assert.match(fn, /if \(userId == null\) return null;/);
});

test('IT SAYS WHERE YOU ARE, not just that something exists', () => {
  // "You have an unfinished draft" is a notification. "Round 1, pick 4 of 180"
  // is a place.
  assert.match(card, /const next = \(draft\.pick_count \?\? 0\) \+ 1;/, 'the pick you are ON, not the last one made');
  assert.match(card, /const round = teams \? Math\.floor\(\(next - 1\) \/ teams\) \+ 1 : null;/);
  assert.match(card, /const total = teams && rounds \? teams \* rounds : null;/);
  assert.match(card, /Pick <b>\{next\}<\/b>\{total \? <> of \{total\}<\/> : null\}/,
    'and the total is omitted rather than guessed when the config is missing');
});

test('rounds come from the shared derivation, never a hardcoded 15', () => {
  assert.match(card, /import \{ deriveRounds \} from '@\/lib\/fantasy\/config'/);
  // The same function the engine and the board use.
  assert.equal(deriveRounds({ QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BN: 6 }), 15);
  assert.equal(deriveRounds({ QB: 1, RB: 1, WR: 1, TE: 1, FLEX: 1 }), 5, 'a short draft derives honestly too');
  assert.equal(deriveRounds(null), 0);
});

test('a missing config degrades to a card that still works', () => {
  // config_id is nullable on drafts. The card must not render "Pick 4 of NaN".
  assert.match(card, /const teams = draft\.teams_count \?\? null;/);
  assert.match(card, /const rounds = deriveRounds\(draft\.roster_slots\) \|\| null;/);
  assert.match(card, /\{draft\.config_name \?\? 'Mock draft'\}/);
  assert.match(card, /\{round \? <>Round <b>\{round\}<\/b> · <\/> : null\}/);
});

test('THE OPEN ROOM COSTS NOTHING, and the card says so', () => {
  // This asserted the room told free users it was spending one of their three.
  // There is no longer anything to spend - mocks are free and unlimited - so a
  // note about the cost would be inventing a price.
  //
  // getDraftsUsed still counts in_progress alongside completed, because the
  // account page reports a tally; it just no longer gates anything.
  assert.match(drafts, /WHERE user_id = \$\{userId\} AND status IN \('completed', 'in_progress'\)/);
  assert.match(card, /\{!member \?/, 'the note is still free-user only');
  assert.match(card, /free and unlimited/);
  assert.equal(/three free drafts/i.test(card), false, 'no wall to warn about');
  assert.ok(!/[—–]/.test(card), 'hyphens only');
});

test('RESUME is the only volt-filled control on the lobby', () => {
  assert.match(card, /<Link className="ld-resume" href=\{`\/sim\/draft\/\$\{draft\.id\}`\}>Resume<\/Link>/);
  assert.match(css, /\.ld-resume \{[\s\S]*?background: var\(--volt\); color: var\(--ink\);/);
});
