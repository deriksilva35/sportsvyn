// components/gridiron/scorecard.test.mjs - the rebuilt gridiron game card.
//
// WHAT THIS CAN AND CANNOT SEE. The expand is client state, so a server render
// never contains the opened pane and no HTTP check can reach it. The GRID
// ITSELF is therefore pure and tested against real data in
// lib/gridiron/lineScore.test.mjs; what is left for this file is the wiring -
// that the component consumes the grid rather than re-deriving it, and that the
// four things the redesign removed are actually gone rather than merely hidden.
//
// The collapsed card IS verified over HTTP on DEV; the opened DOM is not
// verified anywhere without a browser, and that limit is reported rather than
// papered over.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Pure and dependency-free, so it imports straight in - unlike the component
// that uses it, which is a client module behind the @/ alias.
import { distinctLabel } from '../../lib/gridiron/labels.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const card = stripComments(src('components/gridiron/Scoreboard.js'));
const css = src('components/gridiron/gridiron.css');
const readers = stripComments(src('lib/gridiron/readers.js'));

// ---------------------------------------------------------------------------
// What the redesign REMOVED
// ---------------------------------------------------------------------------

test('THE WATCH UNIT IS GONE, markup and styles both', () => {
  // Watch Score is a soccer composite. There has never been a gridiron one, so
  // this rendered "Watch —" on every card forever, and a permanent em-dash does
  // not read as "not applicable" - it reads as broken.
  assert.ok(!/gi-watch/.test(card), 'no markup');
  assert.ok(!/gi-watch/.test(css), 'and no orphan CSS left behind');
  assert.ok(!/Watch Score and the one-line read/.test(card), 'and no promise of one');
});

test('the dead "Full match page" link is gone, because there is no such page', () => {
  // It pointed at "#". /match/[slug] exists and returns 200 for a gridiron slug,
  // but it is the SOCCER layout - stage, group_code, lineups, events - so
  // wiring the link would have been worse than leaving it dead.
  assert.ok(!/Full match page/.test(card));
  assert.ok(!/href="#"/.test(card));
});

test('the placeholder tab grammar is gone', () => {
  // Key Moments and Play by Play promised two panes backed by tables that do
  // not exist, and said so in the pane itself.
  for (const ghost of ['Key Moments', 'Play by Play', 'gi-placeholder', 'gi-tab', 'why-read', 'why-val']) {
    assert.ok(!card.includes(ghost), `${ghost} must be gone from the card`);
  }
  for (const ghost of ['.gi-tab', '.gi-placeholder', '.why-read', '.why-val']) {
    assert.ok(!css.includes(ghost), `${ghost} must be gone from the stylesheet`);
  }
});

test('the empty rank column and the doubled conference are gone', () => {
  // `.rk` was an always-empty 24px span. `.rec` was a slot named for a record
  // that displayed a conference, so an all-NFC game printed "NFC" twice.
  assert.ok(!/className="rk"/.test(card));
  assert.ok(!/className="rec"/.test(card));
  assert.ok(!/t\.conference/.test(card), 'the conference is not on the row at all');
  assert.ok(!/\.gi-team \.rk|\.gi-team \.rec/.test(css));
});

// ---------------------------------------------------------------------------
// What it renders now
// ---------------------------------------------------------------------------

test('full names, with the abbreviation as a mono prefix', () => {
  assert.match(card, /const name = t\.name \|\| t\.label \|\| 'TBD'/,
    'the NAME is the name - the abbreviation is no longer standing in for it');
  assert.match(card, /<span className="abbr">\{abbr\}<\/span>/);
  assert.match(card, /<span className="nm">\{name\}<\/span>/);
  const rule = css.slice(css.indexOf('.gi-team .abbr {'), css.indexOf('.gi-team .nm'));
  assert.match(rule, /font-family: var\(--font-jetbrains-mono\)/, 'an identifier gets the identifier face');
  assert.match(rule, /color: var\(--muted-dim\)/, 'and stays muted');
  assert.match(rule, /flex: 0 0 34px/, 'fixed width so names align down the card');
});

// v1.2 RESTYLE. This test used to read "the winner is white and the loser is
// muted", and BOTH halves of that were retired by ruling: the winning SCORE
// goes volt and nothing else moves. Three signals (white name, white score,
// dimmed opponent) were all saying the one thing the volt score now says
// alone, and together they made a finished card louder than a live one.
//
// WHAT THIS TEST IS ACTUALLY FOR SURVIVES THE RESTYLE UNCHANGED: a winner is
// only ever promoted on a FINAL, and a tie promotes nobody.
test('the winning score goes volt, and only on a final', () => {
  assert.match(css, /\.gi-team\.win \.sc \{ color: var\(--volt\); \}/);
  // The retired treatments must be GONE, not merely overridden further down.
  assert.ok(!/\.gi-team\.win \.nm/.test(css), 'the winner NAME is no longer promoted');
  assert.ok(!/\.gi-team\.lose /.test(css), 'and the loser is no longer dimmed');
  // Only once the game is final - a scheduled 0-0 has no winner to promote.
  assert.match(card, /final && isWinner \? 'win' : ''/);
  assert.match(card, /final && isLoser \? 'lose' : ''/);
});

// A TIE IS POSSIBLE IN THE NFL and nothing guarded it before this relay - the
// old scheme happened to render it correctly, which is not the same as being
// pinned. Now that a single volt score is the whole "who won" signal, a tie
// that lit one side would be a lie about the result rather than a dim shade of
// one, so the derivation is asserted directly.
test('a tied final promotes neither side', () => {
  const fn = card.slice(card.indexOf('function Card('), card.indexOf('THE WHOLE CARD IS THE CONTROL'));
  assert.match(fn, /const homeWin = final && hw > aw, awayWin = final && aw > hw;/,
    'strict > on both sides is what makes 17-17 promote nobody');
  // Neither strict comparison can hold when the scores are equal.
  const [hw, aw, final] = [17, 17, true];
  assert.equal(final && hw > aw, false);
  assert.equal(final && aw > hw, false);
});

// The three things a score can be. Each is a class the row could not derive
// from `score` alone, which is why they are props rather than CSS.
test('a live score is live-red and an absent score is a muted dash', () => {
  assert.match(css, /\.gi-team \.sc\.live \{ color: var\(--live\); \}/);
  assert.match(css, /\.gi-team \.sc\.none \{ color: var\(--muted\); font-weight: 400; \}/);
  assert.match(card, /score == null \? ' none' : ''/, 'null is absent, not zero');
  assert.match(card, /live \? ' live' : ''/);
});

test('the foot keeps the scope and adds the name and the city', () => {
  assert.match(card, /\{g\.leagueSlug\.toUpperCase\(\)\} · \{g\.seasonPhase\} W\{g\.week\}/, 'NFL · PRE W0 stays');
  assert.match(card, /\[distinctLabel\(g\.weekLabel\), g\.venueCity\]\.filter\(Boolean\)\.join\(' · '\)/);
});

test('a mechanical "Week 1" label is suppressed; a real name is not', () => {
  // Showing "Week 1" beside "PRE W1" is the same fact twice. "Hall of Fame
  // Weekend" and "Wild Card" are names a week number cannot carry.
  //
  // The rule moved out of this component when /nfl/game/[slug] needed the same
  // one for its header foot. It is asserted here against the real function
  // rather than against the card's source, because a second copy that drifted
  // would still have matched a regex over this file.
  assert.match(card, /import \{ distinctLabel \} from '@\/lib\/gridiron\/labels'/,
    'one definition, imported - not reimplemented per surface');
  assert.equal(distinctLabel('Week 1'), null);
  assert.equal(distinctLabel('week 12'), null);
  assert.equal(distinctLabel('  Week 3  '), null, 'whitespace does not smuggle it through');
  assert.equal(distinctLabel('Hall of Fame Weekend'), 'Hall of Fame Weekend');
  assert.equal(distinctLabel('Wild Card'), 'Wild Card');
  assert.equal(distinctLabel('Week 1 Special'), 'Week 1 Special', 'only the bare form is suppressed');
  assert.equal(distinctLabel(null), null);
  assert.equal(distinctLabel(''), null);
});

test('the reader surfaces the fields the foot and the pane need', () => {
  for (const field of ['weekLabel: meta.apisports_week_label', 'venue: meta.venue', 'venueCity: meta.venue_city']) {
    assert.ok(readers.includes(field), `rowToGame must expose ${field}`);
  }
});

// ---------------------------------------------------------------------------
// The expand
// ---------------------------------------------------------------------------

test('THE WHOLE CARD IS THE CONTROL, not a 12px caret', () => {
  assert.match(card, /role="button"/);
  assert.match(card, /tabIndex=\{0\}/, 'reachable by keyboard');
  assert.match(card, /aria-expanded=\{open\}/, 'and it announces its state');
  assert.match(card, /onKeyDown=\{onKey\}/);
  assert.match(card, /e\.key === 'Enter' \|\| e\.key === ' '/, 'both activation keys');
  // The caret is now decoration on a control, not the control itself.
  assert.match(card, /<span className="gi-chev" aria-hidden="true">/);
  assert.ok(!/<button className="gi-chev"/.test(card));
  assert.match(css, /\.gi-card-body:focus-visible \{ outline: 2px solid var\(--volt\)/,
    'a keyboard user must be able to see what is focused');
});

test('the expand shows the line score when there is one, facts when there is not', () => {
  assert.match(card, /const hasLine = Array\.isArray\(g\.lineScores\?\.home\)/);
  assert.match(card, /\{hasLine \? <LineScore g=\{g\} \/> : <PreGamePane g=\{g\} \/>\}/);
});

test('the component CONSUMES the pure grid rather than re-deriving it', () => {
  // The derivation is the part that can be wrong (nulls, OT, totals) and the
  // part a server render cannot reach, so it lives in a tested pure module.
  assert.match(card, /import \{ lineScoreGrid[^}]*\} from '@\/lib\/gridiron\/lineScore'/);
  assert.match(card, /const grid = lineScoreGrid\(g\)/);
  // The absence glyph comes from the same module, so the card and the grid
  // cannot disagree about what "we do not have this" looks like.
  assert.match(card, /\{score \?\? ABSENT\}/);
  assert.ok(!/lineScores\.home\[4\]/.test(card.slice(card.indexOf('function LineScore'))),
    'no OT logic re-implemented in the component');
});

test('the grid is a real table, not divs pretending', () => {
  assert.match(card, /<table className="gi-ls">/);
  assert.match(card, /<thead>/); assert.match(card, /<tbody>/);
  assert.match(card, /scope="col"/); assert.match(card, /scope="row"/);
  const rule = css.slice(css.indexOf('.gi-ls {'), css.indexOf('.sr {'));
  assert.match(rule, /font-family: var\(--font-jetbrains-mono\)/, 'mono, per the Surface Rule');
  assert.match(rule, /font-variant-numeric: tabular-nums/, 'so the columns actually line up');
});

test('the pre-game pane keeps the odds strip where a market exists', () => {
  // /scores does attach odds (getH2hOdds, batched). Dropping the strip while
  // rebuilding the pane would have been a silent regression - it is a working
  // feature, and preseason simply never has one by ruling 3.
  assert.match(card, /isPreGame\(g\.status\) && g\.odds \? <OddsStrip odds=\{g\.odds\} \/> : null/);
});

// ---------------------------------------------------------------------------
// Surface Rule
// ---------------------------------------------------------------------------

test('volt is rule material, never body text, on the new surfaces', () => {
  for (const sel of ['.gi-ls', '.gi-facts', '.gi-line-alt', '.gi-team .abbr']) {
    const i = css.indexOf(`${sel} {`);
    assert.ok(i > -1, `${sel} must exist`);
    const rule = css.slice(i, css.indexOf('}', i));
    assert.ok(!/color: var\(--volt\)/.test(rule), `${sel} must not use volt as text colour`);
  }
  // Volt survives exactly where it is structural: the focus ring and the open
  // caret, both of which mark state rather than carrying content.
  assert.match(css, /\.gi-card\.expanded \.gi-chev \{ transform: rotate\(180deg\); color: var\(--volt\); \}/);
});

test('hyphens only in the card copy', () => {
  const emDash = card.match(/[—–](?![>])/g) ?? [];
  // The en dash used for an absent value is imported from lineScore.js as
  // ABSENT and is a data glyph, not copy - it must not appear inline here.
  assert.deepEqual(emDash, [], 'no em or en dashes in the component source');
});
