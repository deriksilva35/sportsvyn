// lib/fantasy/lineTwo.test.mjs — which facts a board row's second line keeps.
//
// Reported from draft 443 (2 Sep 2026), phone, MY TEAM sort at ALL: Kittle and
// Kelce carried "57 REC" / "76 REC" and Pitts, LaPorta, Ferguson and Goedert
// carried nothing. The summaries were all there (six of six, three stats each).
// The split was the team code - SF and KC are two letters, ATL/DET/DAL/PHI are
// three - and line 2 clips by whole tokens at exactly that width. Under the old
// order the MY TEAM gap and slot came LAST, so on a phone the sort never showed
// the two facts it is named for, on any row.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lineTwoTokens, fitLineTwo, seatSortHint } from './lineTwo.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

// Kyle Pitts, the reported three-letter-team row: draft 443 at pick 50, the
// seat's TE slot filled, 2025 line 88 REC · 928 YDS · 5 TD.
const PITTS = {
  pos: 'TE', team: 'ATL', range: null, quick: ['88 REC', '928 YDS', '5 TD'],
  seatRead: { gap: -29.9, slot: 'flex', deferred: false, streamer: false },
};
const KITTLE = { ...PITTS, team: 'SF', quick: ['57 REC', '628 YDS', '7 TD'], seatRead: { ...PITTS.seatRead, gap: -52.5 } };
const kinds = (tokens) => tokens.map((t) => t.kind);
const texts = (tokens) => tokens.map((t) => t.text);

test('under seatSort the two facts ride ahead of the stats; other sorts keep the old order', () => {
  assert.deepEqual(kinds(lineTwoTokens({ ...PITTS, seatSort: true })),
    ['tag', 'gap', 'slot', 'quick', 'quick', 'quick']);
  assert.deepEqual(kinds(lineTwoTokens({ ...PITTS, seatSort: false })),
    ['tag', 'quick', 'quick', 'quick'], 'ADP / PPG / stat sorts: tag then stats, unchanged');
  // No read (player not valued) or no seat pick left (gap null): the tokens
  // that cannot be said are simply absent, the order of the rest holds.
  assert.deepEqual(kinds(lineTwoTokens({ ...PITTS, seatSort: true, seatRead: null })), ['tag', 'quick', 'quick', 'quick']);
  assert.deepEqual(kinds(lineTwoTokens({ ...PITTS, seatSort: true, seatRead: { ...PITTS.seatRead, gap: null } })),
    ['tag', 'slot', 'quick', 'quick', 'quick']);
});

test('the texts are as short as they can honestly be: the signed gap, the slot or "wait", one stat per token', () => {
  // RE-PINNED (copy fix, 2 Sep 2026). These read '-29.9 at 50' and 'TE · flex':
  // 11ch and 9ch, and the phone row had ~9ch after the tag. "at 50" is the
  // seat's next pick, identical on every row - it moved to the sort header;
  // "TE" is the tag's own word. What is left is the fact and only the fact.
  assert.deepEqual(texts(lineTwoTokens({ ...PITTS, seatSort: true })),
    ['TE·ATL', '-29.9', 'flex', '88 REC', '928 YDS', '5 TD']);
  const up = lineTwoTokens({ ...PITTS, seatSort: true, seatRead: { ...PITTS.seatRead, gap: 3.2 } });
  assert.equal(up[1].text, '+3.2', 'a value carries its plus sign');
  // The window rides inside the tag - one anonymous token, never orphaned.
  assert.equal(lineTwoTokens({ ...PITTS, range: '38-61' })[0].text, 'TE·ATL · 38-61');
  assert.equal(lineTwoTokens({ ...PITTS, team: null })[0].text, 'TE', 'no team, no separator');
  // A deferred row says "wait", not the slot it is not being offered for; the
  // muted flag rides along so the room can render it as such. A capped
  // streamer keeps its slot word and is muted.
  const deferred = lineTwoTokens({ ...PITTS, seatSort: true, seatRead: { ...PITTS.seatRead, slot: 'open', deferred: true } });
  assert.equal(deferred[2].text, 'wait');
  assert.equal(deferred[2].muted, true);
  assert.equal(deferred[2].slot, 'open', 'the slot itself still rides for the class');
  const streamer = lineTwoTokens({ ...PITTS, seatSort: true, seatRead: { gap: 17.3, slot: 'bench', deferred: false, streamer: true } });
  assert.equal(streamer[2].text, 'bench');
  assert.equal(streamer[2].muted, true);
  assert.equal(lineTwoTokens({ ...PITTS, seatSort: true })[2].muted, false);
  for (const slot of ['open', 'flex', 'bench', 'full']) {
    assert.equal(lineTwoTokens({ ...PITTS, seatSort: true, seatRead: { ...PITTS.seatRead, slot } })[2].text, slot);
  }
  // The reference pick is said once, in the header.
  assert.equal(seatSortHint(50), 'My Team · gap at pick 50');
  // The tag is never dropped, and a stat token never carries a separator of
  // its own - the room adds "· " when it renders, so the fit law can count it.
  for (const t of lineTwoTokens({ ...PITTS, seatSort: true })) assert.ok(!t.text.startsWith('·'));
});

test('fitLineTwo is the numcols.css law: whole tokens in order, the first miss ends the line', () => {
  const tokens = lineTwoTokens({ ...PITTS, seatSort: true });
  // Tag alone is 6ch; each further token costs " · " (3) + column-gap (.3) + text.
  assert.deepEqual(kinds(fitLineTwo(tokens, 6)), ['tag']);
  assert.deepEqual(kinds(fitLineTwo(tokens, 6 + 3.3 + 5)), ['tag', 'gap']);
  assert.deepEqual(kinds(fitLineTwo(tokens, 6 + 3.3 + 5 + 3.3 + 4)), ['tag', 'gap', 'slot']);
  assert.deepEqual(kinds(fitLineTwo(tokens, 1000)), kinds(tokens), 'a wide line keeps everything');
  // A later, shorter token never climbs back onto the line past a dropped one.
  const shown = fitLineTwo([{ text: 'aaaa' }, { text: 'bbbbbbbbbbbbbbbb' }, { text: 'c' }], 12);
  assert.deepEqual(shown.map((t) => t.text), ['aaaa']);
});

// THE REPORTED WIDTH. On the phone, "TE·SF · 57 REC" fit and "TE·ATL · 88 REC"
// did not: the line was between 14.3ch and 15.3ch of its own font. That is the
// width every claim below is measured against, and the band above it.
const PHONE = [14.3, 15.2];
// What the rooms emitted before this change: tag, stats, then the read.
const oldOrder = (row) => {
  const t = lineTwoTokens({ ...row, seatSort: true });
  return [t[0], ...t.filter((x) => x.kind === 'quick'), ...t.filter((x) => x.kind === 'gap' || x.kind === 'slot')];
};

test('the report reproduces: at the phone width the old order kept a REC for SF and nothing for ATL', () => {
  for (const w of PHONE) {
    assert.deepEqual(texts(fitLineTwo(oldOrder(KITTLE), w)), ['TE·SF', '57 REC'], `Kittle @${w}`);
    assert.deepEqual(texts(fitLineTwo(oldOrder(PITTS), w)), ['TE·ATL'], `Pitts @${w}`);
    // ...and on neither row did the sort's own facts appear.
    for (const row of [KITTLE, PITTS]) {
      assert.ok(!kinds(fitLineTwo(oldOrder(row), w)).some((k) => k === 'gap' || k === 'slot'),
        'under the old order the MY TEAM read was last, and clipped, on every phone row');
    }
  }
});

test('three-letter-team row: under seatSort the gap and slot survive where the old order lost them, and a stat drops instead', () => {
  const now = lineTwoTokens({ ...PITTS, seatSort: true });
  const then = oldOrder(PITTS);
  // Old order needed the full stat line on screen before the read got a pixel:
  // 6 + 9.3 + 10.3 + 7.3 (stats) + 8.3 (gap) + 7.3 (slot) = 48.5ch for both facts.
  // New order needs 6 + 8.3 + 7.3 = 21.6ch. Every width in between is the band
  // where the order alone is the difference.
  let checked = 0;
  for (let w = 21.6; w < 48.5; w += 0.5) {
    const kNow = kinds(fitLineTwo(now, w));
    const kThen = kinds(fitLineTwo(then, w));
    assert.ok(kNow.includes('gap') && kNow.includes('slot'), `@${w}: gap and slot must survive`);
    assert.ok(!(kThen.includes('gap') && kThen.includes('slot')), `@${w}: the old order lost at least one of them`);
    // What drops is a stat: the last token of the full line (5 TD) is the
    // first casualty.
    assert.ok(kNow.length < now.length, `@${w}: something must have dropped`);
    assert.ok(!texts(fitLineTwo(now, w)).includes('5 TD'), `@${w}: the tail stat is what drops`);
    checked++;
  }
  assert.ok(checked > 40, 'the band was actually walked');
});

test('MEASURED at the phone width: the gap fits on a three-letter-team row; the slot needs 21.6ch', () => {
  // The relay asked for "TE·ATL · -29.9 · flex" at 15ch. Counted in the line's
  // own characters with the row's " · " separators and the .3em column-gap:
  //   TE·ATL            6.0
  //   · -29.9        +  8.3   = 14.3   fits the 14.3-15.2 phone band
  //   · flex         +  7.3   = 21.6   does not
  // So at the reported width the row reads "TE·ATL · -29.9" - the gap, which
  // the previous copy could not show on any phone row, and not the slot. The
  // slot would need the row 6.4ch wider than it measured, or a separator
  // shorter than " · ". Stated, not hidden: the band where all three fit
  // starts at 21.6ch.
  const now = lineTwoTokens({ ...PITTS, seatSort: true });
  for (const w of PHONE) {
    assert.deepEqual(texts(fitLineTwo(now, w)), ['TE·ATL', '-29.9'], `@${w}`);
  }
  assert.deepEqual(texts(fitLineTwo(now, 21.5)), ['TE·ATL', '-29.9']);
  assert.deepEqual(texts(fitLineTwo(now, 21.6)), ['TE·ATL', '-29.9', 'flex']);
  // And on the two-letter-team row the same width shows the same two facts.
  assert.deepEqual(texts(fitLineTwo(lineTwoTokens({ ...KITTLE, seatSort: true }), PHONE[0])), ['TE·SF', '-52.5']);
  // The header carries the reference pick both rooms dropped from the rows.
  for (const rel of ['components/sim/DraftRoom.js', 'components/sim/TrackerRoom.js']) {
    const t = src(rel);
    assert.match(t, /\{seatSort && <span className="s-hint">\{seatSortHint\(/, `${rel}: the hint is said once, under MY TEAM`);
    // The row token is the bare number: no room appends " at {pick}" to it.
    // (The tracker's BEST AVAILABLE AT YOUR TURN card still says "AT {myNext}"
    // - two lines, no clip, a different surface; not this relay's.)
    assert.ok(!/t\.text\}\s*at\s*\{/.test(t), `${rel}: the gap token is not suffixed in the room`);
  }
});

test('both rooms take line 2 from lineTwoTokens and no longer hand-order the stats ahead of the read', () => {
  for (const [rel, container] of [['components/sim/DraftRoom.js', 'className="rng"'], ['components/sim/TrackerRoom.js', 'className="tag"']]) {
    const t = src(rel);
    assert.match(t, /import \{ lineTwoTokens, seatSortHint \} from '@\/lib\/fantasy\/lineTwo'/, `${rel}: imports the shared order`);
    const at = t.indexOf(container);
    assert.ok(at !== -1, `${rel}: has the line-2 container`);
    const block = t.slice(at, t.indexOf('className="ncols"', at));
    assert.match(block, /lineTwoTokens\(\{ pos/, `${rel}: line 2 is rendered from the shared token order`);
    assert.ok(!/quick\.map\(/.test(block), `${rel}: no hand-ordered stat map on line 2`);
    // The kinds are all handled: a token with no renderer would vanish silently.
    for (const kind of ['tag', 'gap', 'slot']) assert.ok(block.includes(`t.kind === '${kind}'`), `${rel}: renders ${kind}`);
  }
});
