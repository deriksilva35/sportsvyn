// components/games/confirmCard.test.mjs - relay 3b's three guarantees, each
// of which a later edit could undo while looking entirely reasonable.
//
//   1  ONE confirm card, not two lookalikes
//   2  ONE time zone per screen, across all four game surfaces
//   3  the drafted-and-waiting card is not a dead end
//
// SOURCE-READING, DELIBERATELY. Items 1 and 3 are about which component a
// file reaches for and which links a card offers - facts about the tree, not
// about a render, and a render test would pass just as happily on two
// duplicated cards as on one shared one. Item 2 is the same shape as a grep,
// which is what the relay asked for; making it a test is what stops it being
// a grep somebody has to remember to run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

const WEEKLY_ROOM = 'components/weekly/WeeklyRoom.js';
const PICKEM_BOARD = 'components/pickem/PickemBoard.js';

// NEITHER GAME RENDERS ConfirmCard ANY MORE. The Pick'em's confirm moved into
// its board footer at v2 (R4); the Weekly's moved into its footer at v2 as
// well, for the same reason - under a rolling lock a card floating below a
// half-locked lineup has nothing to sit beside. What did NOT change either
// time is the ACTION and the GATE: confirmWeeklyEntry / confirmPickemEntry and
// confirmVerdict are still the only ones, and the tests below check those
// rather than which component draws the button.
//
// ConfirmCard.js AND confirmCard.css ARE THEREFORE UNRENDERED. They are left
// in the tree, not deleted: removing a shared component is a decision for the
// relay that notices it is unused, not a side effect of a reskin. The clauses
// below that describe the card's internals still hold and still pass, and the
// one guard that matters now is that neither game has rebuilt its markup.

// ------------------------------------------------------ 1: one card, shared

test('THE WEEKLY CONFIRMS THROUGH ITS FOOTER, with the same action and the same gate', () => {
  const code = strip(src(WEEKLY_ROOM));
  assert.doesNotMatch(code, /<ConfirmCard\b/, 'no card in the v2 room');
  assert.doesNotMatch(code, /import ConfirmCard/, 'and it does not import one');
  assert.match(code, /import \{ confirmWeeklyEntry \} from '@\/app\/actions\/confirm'/,
    'the same action as before');
  assert.match(code, /onClick=\{lockItIn\}/, 'and one control that calls it');
  assert.match(code, /wkv-lock/, 'which is the footer button');
  // THE RECEIPT IS STILL A RECEIPT. Confirming writes meta.confirmed_at and
  // nothing else; the settle reads it nowhere.
  assert.match(code, /confirmWeeklyEntry\(contest\.id\)/);
  assert.doesNotMatch(strip(src('lib/weekly/settle.js')), /confirmed_at/,
    'the settle has never read the receipt and still does not');
});

test("PICK'EM CONFIRMS THROUGH ITS FOOTER, with the same action and the same gate", () => {
  const code = strip(src(PICKEM_BOARD));
  assert.doesNotMatch(code, /<ConfirmCard\b/, 'no card on the v2 board');
  assert.match(code, /import \{ confirmPickemEntry \} from '@\/app\/actions\/confirm'/,
    'the same action as before');
  assert.match(code, /onClick=\{lockItIn\}/, 'and one control that calls it');
  assert.match(code, /pkv-lock/, 'which is the footer button');
});

test('NEITHER board still carries its own copy of the card markup', () => {
  // The duplication this replaced: each board built .wk-review/.wk-receipt and
  // its own .wk-lockin button. Those class names may now appear in exactly one
  // file - the shared component - and the CSS that styles them.
  for (const rel of [WEEKLY_ROOM, PICKEM_BOARD]) {
    const code = strip(src(rel));
    for (const cls of ['wk-review', 'wk-receipt', 'wk-lockin']) {
      assert.doesNotMatch(code, new RegExp(cls),
        `${rel} must not rebuild .${cls} - that is the duplication 3b item 1 removed`);
    }
  }
});

test('the card has ONE button, and it is the volt Lock it in', () => {
  const code = strip(src('components/games/ConfirmCard.js'));
  assert.equal((code.match(/<button/g) ?? []).length, 1, 'exactly one button on the card');
  assert.match(code, /className="wk-lockin"/, 'and it is the volt one');
  assert.match(code, /Lock it in/);
  // The receipt is jade and has no button: a receipt is not asking for
  // anything, so it must not offer a second thing to press.
  const receipt = code.slice(code.indexOf('if (done)'), code.indexOf('return (\n    <div className="wk-review"'));
  assert.match(receipt, /wk-receipt/);
  assert.doesNotMatch(receipt, /<button/, 'the locked-in state offers nothing to press');
});

test('the Weekly card carries a roster summary, and the Pickem footer a count', () => {
  const card = strip(src('components/games/ConfirmCard.js'));
  // rows (roster) and line/receiptLine (count) are both real inputs, and the
  // roster renders in BOTH states rather than only before locking.
  assert.match(card, /rows = null/);
  assert.match(card, /receiptLine = null/);
  const summaryDecl = card.indexOf('const summary =');
  assert.ok(summaryDecl > 0, 'one summary, built once');
  assert.ok(card.indexOf('{summary}', summaryDecl) < card.lastIndexOf('{summary}'),
    'and rendered in both the receipt and the review');

  // THE WEEKLY'S FOOTER NAMES WHAT IS MISSING, not a roster summary: the six
  // slots are on screen above it, so restating them under the board was the
  // duplication the v2 footer removed. What it must say is the rule.
  const room = strip(src(WEEKLY_ROOM));
  assert.match(room, /\$\{unfilled\.length\} to fill/, 'the Weekly counts what is still empty');
  assert.match(room, /Six filled or the week does not count/, 'and states the DNF rule');
  assert.doesNotMatch(room, /scores 0/, 'and never the mock\'s wrong version of it');
  // D4 STILL HOLDS, in the footer now: the count is the PICKABLE games, so a
  // kicked row is outside both the numerator and the denominator.
  const board = strip(src(PICKEM_BOARD));
  assert.match(board, /const toGo = pickable - pickedOpen;/, "the Pick'em counts what is still open");
  assert.match(board, /\$\{toGo\} to go/, 'and says so on the control');
  assert.match(board, /\{pickedOpen\} of \{pickable\} picked/, 'one denominator, in the header too');
});

test('the card states the lock time, and through StandaloneDate', () => {
  const card = strip(src('components/games/ConfirmCard.js'));
  assert.match(card, /import StandaloneDate from '@\/components\/StandaloneDate'/);
  assert.match(card, /<StandaloneDate iso=\{lockIso\}/);
  // FRESH-USER FIXES, D12: the Weekly's header owns its deadline and its card
  // says none. The Pick'em no longer renders this card at all (v2, R4); its
  // footer names the next lock through the same island instead of a string.
  assert.doesNotMatch(strip(src(WEEKLY_ROOM)), /lockIso=/, 'the Weekly card renders no lock instant (D12)');
  const board = strip(src(PICKEM_BOARD));
  assert.doesNotMatch(board, /lockIso=/, "the Pick'em passes no lockIso - it renders no card");
  assert.match(board, /<StandaloneTime iso=/, 'and every instant it does render goes through an island');
});

// ------------------------------------------- 2: one time zone per screen

// Every .js under these, minus tests. The four games plus the lobby they are
// reached from - one reader, one session, one set of clocks.
const SURFACES = [
  'app/weekly', 'app/draft', 'app/pickem', 'app/daily', 'app/games',
  'components/weekly', 'components/draft', 'components/pickem',
  'components/daily', 'components/games',
];

function walk(rel) {
  const abs = path.join(REPO, rel);
  let entries;
  try { entries = readdirSync(abs); } catch { return []; }
  return entries.flatMap((e) => {
    const p = path.join(rel, e);
    if (statSync(path.join(REPO, p)).isDirectory()) return walk(p);
    return e.endsWith('.js') ? [p] : [];
  });
}
const SURFACE_FILES = SURFACES.flatMap(walk);

test('the surfaces under test actually exist - a typo here would pass vacuously', () => {
  assert.ok(SURFACE_FILES.length > 20, `expected the game surfaces, found ${SURFACE_FILES.length}`);
  assert.ok(SURFACE_FILES.includes(PICKEM_BOARD));
  assert.ok(SURFACE_FILES.includes('app/weekly/page.js'));
});

test('NO game surface formats a rendered clock in a hardcoded zone', () => {
  // The relay's own grep, pinned. A time formatter is one that asks for an
  // hour; a formatter that asks only for a weekday or a date is a GROUPING
  // KEY, not a clock - which games belong to "Sunday" is a property of the
  // slate, not of where the reader is sitting - so those are allowed and
  // named explicitly below.
  const ALLOWED_GROUPING = new Set([PICKEM_BOARD]);
  const offenders = [];
  for (const rel of SURFACE_FILES) {
    const code = strip(src(rel));
    for (const m of code.matchAll(/new Intl\.DateTimeFormat\([^)]*\)|toLocaleString\('en-US',[^)]*\)|toLocaleTimeString\([^)]*\)/g)) {
      const call = m[0];
      const hasZone = /America\/|timeZone:/.test(call);
      const isClock = /hour/.test(call);
      if (hasZone && isClock) offenders.push(`${rel}: ${call.slice(0, 90)}`);
      if (hasZone && !isClock && !ALLOWED_GROUPING.has(rel)) {
        offenders.push(`${rel}: unexpected zone-pinned formatter: ${call.slice(0, 90)}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `hardcoded-zone clocks on a game surface:\n${offenders.join('\n')}`);
});

test('and none of them prints a zone abbreviation into a string', () => {
  // `${...} ET` was how every one of these used to end. StandaloneDate and
  // StandaloneTime append the zone themselves, from Intl, so a literal one in
  // source means somebody formatted a time by hand again.
  const offenders = [];
  for (const rel of SURFACE_FILES) {
    for (const line of strip(src(rel)).split('\n')) {
      if (/\}\s*(ET|PT|PDT|PST|EDT|EST)['"`]/.test(line)) offenders.push(`${rel}: ${line.trim()}`);
    }
  }
  assert.deepEqual(offenders, [], `hand-built zone label:\n${offenders.join('\n')}`);
});

test('the Pickem kickoff cell and the Daily close line go through the islands', () => {
  const pk = strip(src(PICKEM_BOARD));
  assert.match(pk, /<StandaloneTime iso=\{g\.kickoff_at\}/, 'kickoff is the viewer’s own clock');
  const daily = strip(src('components/daily/season/SeasonBoard.js'));
  assert.match(daily, /<StandaloneTime iso=\{closesAt\}/);
  // It used to print the SAME instant twice, ET and local side by side.
  assert.doesNotMatch(daily, /your time\)/, 'one zone, not a parenthetical second one');
});

// ------------------------------------------------- 3: not a dead end

test('the drafted-and-waiting card offers a way back to Games', () => {
  const code = strip(src('app/draft/page.js'));
  const card = code.slice(code.indexOf("state === 'waiting'"), code.indexOf("RULES: the seat-select"));
  assert.match(card, /See the full draft board/, 'the deep link is still there');
  assert.match(card, /href="\/games"/, 'and now something points back out');
  assert.match(card, /btn--volt/, 'as the volt call to act');
  assert.ok(card.indexOf('See the full draft board') < card.indexOf('href="/games"'),
    'the way out sits BELOW the draft board link, per the item');
});

test('the ranked completion page has the same exit, in the same words', () => {
  // /sim/draft/[id] and /draft are two different endings for one game; they
  // should not disagree about how you leave.
  const code = strip(src('components/draft/RankedComplete.js'));
  assert.match(code, /href="\/games"/);
  assert.match(code, /btn--volt/);
  assert.match(code, /Back to games/);
});

// ------------------------------------------ 3c: the card is actually styled

test('the card ships its OWN stylesheet, and the component imports it', () => {
  // THE 3c DEFECT. These rules used to live in app/daily/daily.css. /weekly
  // imports that file, /pickem never had a reason to - so the moment both
  // games rendered the same component, one of them was one forgotten import
  // away from an unstyled card. A route cannot forget an import the
  // component makes itself.
  const card = src('components/games/ConfirmCard.js');
  assert.match(card, /import '\.\/confirmCard\.css'/,
    'ConfirmCard.js must import its own stylesheet');
  const css = src('components/games/confirmCard.css');
  for (const cls of ['.wk-review', '.wk-receipt', '.wk-lockin', '.wk-receipt-list']) {
    assert.ok(css.includes(cls), `${cls} is defined in the component's own stylesheet`);
  }
  // ...and is NOT still defined in the Daily's, which would be two sources
  // of truth for one card.
  const daily = src('app/daily/daily.css');
  for (const cls of ['.wk-review', '.wk-receipt', '.wk-lockin']) {
    assert.ok(!daily.includes(cls), `${cls} must no longer be defined in daily.css`);
  }
});

test('EITHER game rendering the card renders the wrapper class AND the button', () => {
  // Item 3's guard, stated as the two things that must both survive: the
  // module wrapper that makes it a card at all, and the element that makes
  // it pressable. Checked on the shared component, since that is now the
  // only place either can come from - and checked on both call sites, since
  // a game that stopped calling it would render neither.
  const card = strip(src('components/games/ConfirmCard.js'));

  const review = card.slice(card.indexOf('return (\n    <div className="wk-review"'));
  assert.match(review, /className="wk-review"/, 'the unconfirmed state has its module wrapper');
  assert.match(review, /<button[^>]*className="wk-lockin"/, 'and its button');

  const receipt = card.slice(card.indexOf('if (done)'), card.indexOf('return (\n    <div className="wk-review"'));
  assert.match(receipt, /className="wk-receipt"/, 'the confirmed state has its module wrapper');

  // AND NO CALL SITE AT ALL NOW. Both games confirm through their own footers
  // (checked above), so this component is unrendered - FILED, not deleted.
  // The guard that survives is that neither game rebuilt what it replaced.
  for (const rel of [WEEKLY_ROOM, PICKEM_BOARD]) {
    assert.doesNotMatch(strip(src(rel)), /<ConfirmCard\b/, `${rel} renders no card`);
  }
});

test('the card carries NO horizontal margin - the parent owns the page inset', () => {
  // What actually broke on the Pick'em: `margin: 14px 12px 0`, written for
  // .daily-main (a padded block), applied inside .pk-main (a flex column
  // with no padding) where every neighbour is flush. The card was the one
  // element on the board that did not line up. A shared component must not
  // encode one route's padding.
  const css = src('components/games/confirmCard.css');
  const rule = css.slice(css.indexOf('.wk-review, .wk-receipt {'));
  const margin = /margin:\s*([^;]+);/.exec(rule)?.[1] ?? '';
  const parts = margin.trim().split(/\s+/);
  assert.ok(parts.length >= 3, `expected a 3-value margin, got "${margin}"`);
  assert.equal(parts[1], '0', `horizontal margin must be 0, got "${margin}"`);
  assert.notEqual(parts[2], '0', 'and a bottom margin, since .pk-main has no bottom padding');
});
