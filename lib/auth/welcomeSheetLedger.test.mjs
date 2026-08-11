// lib/auth/welcomeSheetLedger.test.mjs - the first-launch sheet, recorded.
//
// WHY IT EXISTS. Between 8 and 10 August, 14 accounts arrived through the app
// and 11 never started a draft. The entry path was traced and no defect found:
// the free tier is open, the pool is current, and one of those users loaded
// /sim five times and toured history, tracker and account without drafting. The
// WelcomeSheet fires for exactly that cohort, it is modal, it is the first thing
// they see - and nothing recorded whether it appeared or how it was got rid of.
// The one screen between a paid install and the draft button was the one screen
// with no evidence.
//
// The behavioural half runs against DEV; this file pins the contract and the
// wiring, including the parts that must never be able to cost a render.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SOURCE, DISMISS_CONTROLS, isDismissControl, OPEN_AFTER_MINUTES,
} from './welcomeSheetLedger.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ledger = stripComments(src('lib/auth/welcomeSheetLedger.js'));
const action = stripComments(src('app/actions/welcomeSheet.js'));
const sheet = stripComments(src('components/sim/WelcomeSheet.js'));
const admin = stripComments(src('app/admin/signups/page.js'));

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

test('a row OPENS on appearance and CLOSES on dismissal', () => {
  assert.match(ledger, /export async function recordSheetShown\(userId\)/);
  assert.match(ledger, /export async function recordSheetDismissed\(id, control\)/);
  assert.match(ledger, /outcome: 'shown'/, 'the open row says shown');
  assert.match(ledger, /outcome: 'dismissed', via/, 'and the close records which control');
});

test('AN UNCLOSED ROW IS THE FINDING, not missing data', () => {
  // The sheet went up and the session ended with it still there. Previously
  // that was indistinguishable from nothing happening at all.
  assert.match(ledger, /export async function welcomeSheetSummary/);
  assert.match(ledger, /neverDismissed/, 'the summary names it plainly');
  assert.match(ledger, /summary->>'outcome' = 'shown'\s*\n?\s*AND started_at < now\(\) - make_interval/,
    'still-open rows older than the threshold are the report');
  assert.equal(OPEN_AFTER_MINUTES, 30, 'generous - somebody may genuinely be reading it');
});

test('WHICH control dismissed it is recorded, not inferred', () => {
  // "Pressed Start drafting" and "tapped the backdrop to make it go away" are
  // different facts about the same dismissal.
  assert.deepEqual(DISMISS_CONTROLS, ['primary', 'backdrop', 'escape', 'purchase']);
  for (const c of DISMISS_CONTROLS) assert.equal(isDismissControl(c), true, c);
  for (const bad of ['', null, undefined, 'other', 42, {}]) {
    assert.equal(isDismissControl(bad), false, JSON.stringify(bad));
  }
  assert.match(ledger, /const via = isDismissControl\(control\) \? control : 'unknown'/,
    'an unrecognised control is recorded as unknown, never silently dropped');
});

test('the close MERGES rather than replacing, so the userId survives', () => {
  // summary || patch, not summary = patch. Replacing would lose the user the
  // row is about, which is the only thing that makes it joinable.
  assert.match(ledger, /summary = summary \|\| \$\{JSON\.stringify\(\{ outcome: 'dismissed', via \}\)\}::jsonb/);
});

test('it rides in sync_runs, the one table you read to ask what happened', () => {
  assert.equal(SOURCE, 'welcome-sheet');
  assert.match(ledger, /INSERT INTO sync_runs/);
  assert.ok(!/CREATE TABLE/.test(ledger), 'no new table - the pollers and the email already live here');
});

// ---------------------------------------------------------------------------
// It cannot cost a signup or a render
// ---------------------------------------------------------------------------

test('EVERY ledger function swallows and returns a benign value', () => {
  // This sits between a new account and the draft button. An analytics write
  // must never be able to keep the modal on screen.
  for (const fn of ['recordSheetShown', 'recordSheetDismissed']) {
    const body = ledger.slice(ledger.indexOf(`export async function ${fn}`));
    assert.match(body.slice(0, 900), /catch \(e\) \{/, `${fn} catches`);
  }
  assert.match(ledger, /console\.error\('\[welcome-sheet\] could not open a row'/);
  assert.match(ledger, /console\.error\('\[welcome-sheet\] could not close a row'/);
});

test('THE USER IS RESOLVED SERVER-SIDE, never trusted from the client', () => {
  // A client-supplied user id would let anyone write rows against anyone.
  assert.match(action, /const session = await auth\(\)/);
  assert.match(action, /const userId = session\?\.user\?\.id \?\? null/);
  assert.ok(!/export async function sheetShown\(userId/.test(action),
    'sheetShown must not accept a user id as an argument');
});

test('both actions swallow everything', () => {
  const shown = action.slice(action.indexOf('export async function sheetShown'), action.indexOf('export async function sheetDismissed'));
  assert.match(shown, /catch \{\s*\n\s*return null;/);
  const dismissed = action.slice(action.indexOf('export async function sheetDismissed'));
  assert.match(dismissed, /catch \{\s*\n\s*return false;/);
});

// ---------------------------------------------------------------------------
// The wiring in the sheet itself
// ---------------------------------------------------------------------------

test('the row id lives in a REF, not state', () => {
  // It is never rendered, and setState-in-effect is a lint error in this repo.
  assert.match(sheet, /const rowRef = useRef\(null\)/);
  assert.ok(!/useState\(/.test(sheet), 'the sheet still holds no component state');
});

test('the appearance is recorded without blocking the paint', () => {
  assert.match(sheet, /sheetShown\(\)\.then\(\(id\) => \{ rowRef\.current = id; \}\)\.catch\(\(\) => \{\}\)/,
    'floating on purpose - the sheet must paint whether or not the ledger is up');
  assert.match(sheet, /if \(welcomed\) return;/, 'and only when it actually shows');
});

test('ALL FOUR exit paths report which one they were', () => {
  assert.match(sheet, /onClick=\{\(\) => dismiss\('backdrop'\)\}/);
  assert.match(sheet, /if \(e\.key === 'Escape'\) dismiss\('escape'\)/);
  assert.match(sheet, /className="wsheet-primary" onClick=\{\(\) => dismiss\('primary'\)\}/);
  assert.match(sheet, /className="wsheet-buy" onClick=\{\(\) => dismiss\('purchase'\)\}/);
});

test('the dismissal still happens even if the ledger write does not', () => {
  // The once-per-device key and the close event must not be downstream of a
  // network call. A dismiss that visibly does nothing is worse than one that
  // does not stick.
  const fn = sheet.slice(sheet.indexOf('function dismiss(via)'), sheet.indexOf('if (welcomed) return null;'));
  const keyAt = fn.indexOf('localStorage.setItem');
  const ledgerAt = fn.indexOf('sheetDismissed');
  const eventAt = fn.indexOf('dispatchEvent');
  assert.ok(keyAt > -1 && ledgerAt > keyAt, 'the once-per-device key is written FIRST');
  assert.ok(eventAt > ledgerAt, 'and the close event still fires after');
  assert.match(fn, /sheetDismissed\(id, via\)\.catch\(\(\) => \{\}\)/, 'never awaited, never thrown');
});

// ---------------------------------------------------------------------------
// It is actually read
// ---------------------------------------------------------------------------

test('the counts surface next to the email strip', () => {
  // Counts nobody looks at are the reason this gap lasted four days last time.
  assert.match(admin, /import \{ welcomeSheetSummary \} from '@\/lib\/auth\/welcomeSheetLedger'/);
  assert.match(admin, /await welcomeSheetSummary\(\)\.catch\(\(\) => null\)/,
    'and a ledger read must never take the admin page down');
  assert.match(admin, /\{sheet && <SheetLedger sheet=\{sheet\} \/>\}/);
  // Both strips on one screen: did we say hello, and did the first screen let
  // them past.
  const emailAt = admin.indexOf('<WelcomeLedger');
  const sheetAt = admin.indexOf('<SheetLedger');
  assert.ok(emailAt > -1 && sheetAt > emailAt, 'sheet strip sits beside the email one');
});

test('the report leads with never-dismissed, because that is the question', () => {
  assert.match(admin, /never dismissed/);
  assert.match(admin, /the session ended on this screen/);
  assert.match(admin, /open\.length \? .* : 'all dismissed'/s);
});
