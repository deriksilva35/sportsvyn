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
import { lineTwoTokens, fitLineTwo } from './lineTwo.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

// Kyle Pitts, the reported three-letter-team row: draft 443 at pick 50, the
// seat's TE slot filled, 2025 line 88 REC · 928 YDS · 5 TD.
const PITTS = {
  pos: 'TE', team: 'ATL', range: null, quick: ['88 REC', '928 YDS', '5 TD'],
  seatRead: { gap: -29.9, slot: 'flex', deferred: false, streamer: false }, nextOverall: 50,
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

test('the texts are the room\'s own: signed gap at the next pick, POS · slot, one stat per token', () => {
  assert.deepEqual(texts(lineTwoTokens({ ...PITTS, seatSort: true })),
    ['TE·ATL', '-29.9 at 50', 'TE · flex', '88 REC', '928 YDS', '5 TD']);
  const up = lineTwoTokens({ ...PITTS, seatSort: true, seatRead: { ...PITTS.seatRead, gap: 3.2 } });
  assert.equal(up[1].text, '+3.2 at 50', 'a value carries its plus sign');
  // The window rides inside the tag - one anonymous token, never orphaned.
  assert.equal(lineTwoTokens({ ...PITTS, range: '38-61' })[0].text, 'TE·ATL · 38-61');
  assert.equal(lineTwoTokens({ ...PITTS, team: null })[0].text, 'TE', 'no team, no separator');
  // Muted rides with the slot token so the room can render deferral honestly.
  const deferred = lineTwoTokens({ ...PITTS, seatSort: true, seatRead: { ...PITTS.seatRead, deferred: true } });
  assert.equal(deferred[2].muted, true);
  assert.equal(lineTwoTokens({ ...PITTS, seatSort: true })[2].muted, false);
  // The tag is never dropped, and a stat token never carries a separator of
  // its own - the room adds "· " when it renders, so the fit law can count it.
  for (const t of lineTwoTokens({ ...PITTS, seatSort: true })) assert.ok(!t.text.startsWith('·'));
});

test('fitLineTwo is the numcols.css law: whole tokens in order, the first miss ends the line', () => {
  const tokens = lineTwoTokens({ ...PITTS, seatSort: true });
  // Tag alone is 6ch; each further token costs " · " (3) + column-gap (.3) + text.
  assert.deepEqual(kinds(fitLineTwo(tokens, 6)), ['tag']);
  assert.deepEqual(kinds(fitLineTwo(tokens, 6 + 3.3 + 11)), ['tag', 'gap']);
  assert.deepEqual(kinds(fitLineTwo(tokens, 6 + 3.3 + 11 + 3.3 + 9)), ['tag', 'gap', 'slot']);
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
  // 6 + 9.3 + 10.3 + 7.3 (stats) + 14.3 (gap) + 12.3 (slot) = 59.5ch for both facts.
  // New order needs 6 + 14.3 + 12.3 = 32.6ch. Every width in between is the
  // band where the reorder is the whole difference.
  let checked = 0;
  for (let w = 32.6; w < 59.5; w += 0.5) {
    const kNow = kinds(fitLineTwo(now, w));
    const kThen = kinds(fitLineTwo(then, w));
    assert.ok(kNow.includes('gap') && kNow.includes('slot'), `@${w}: gap and slot must survive`);
    assert.ok(!(kThen.includes('gap') && kThen.includes('slot')), `@${w}: the old order lost at least one of them`);
    // What drops is a stat: everything shown after the read is a quick token,
    // and the last token of the full line (5 TD) is the first casualty.
    assert.ok(kNow.length < now.length, `@${w}: something must have dropped`);
    assert.ok(!texts(fitLineTwo(now, w)).includes('5 TD'), `@${w}: the tail stat is what drops`);
    checked++;
  }
  assert.ok(checked > 40, 'the band was actually walked');
});

test('RECORDED, NOT FIXED HERE: at the reported phone width the read still does not fit, in either order', () => {
  // The gap token alone ("-29.9 at 50", 11ch, and in a larger monospace face
  // than the line) is wider than what the phone row had left after "TE·ATL".
  // Reordering cannot make a token fit; only shorter tokens can. "at 50" is the
  // same on all 376 rows (it is the seat's next pick, a property of the sort,
  // not of the row) and "TE · flex" repeats the tag's position. That copy is
  // the next lever, and it is not this change's to pull - this test records
  // the fact so the next one has something to re-pin.
  for (const w of PHONE) {
    assert.deepEqual(texts(fitLineTwo(lineTwoTokens({ ...PITTS, seatSort: true }), w)), ['TE·ATL'], `@${w}`);
    assert.deepEqual(texts(fitLineTwo(lineTwoTokens({ ...KITTLE, seatSort: true }), w)), ['TE·SF'], `@${w}`);
  }
});

test('both rooms take line 2 from lineTwoTokens and no longer hand-order the stats ahead of the read', () => {
  for (const [rel, container] of [['components/sim/DraftRoom.js', 'className="rng"'], ['components/sim/TrackerRoom.js', 'className="tag"']]) {
    const t = src(rel);
    assert.match(t, /import \{ lineTwoTokens \} from '@\/lib\/fantasy\/lineTwo'/, `${rel}: imports the shared order`);
    const at = t.indexOf(container);
    assert.ok(at !== -1, `${rel}: has the line-2 container`);
    const block = t.slice(at, t.indexOf('className="ncols"', at));
    assert.match(block, /lineTwoTokens\(\{ pos/, `${rel}: line 2 is rendered from the shared token order`);
    assert.ok(!/quick\.map\(/.test(block), `${rel}: no hand-ordered stat map on line 2`);
    // The kinds are all handled: a token with no renderer would vanish silently.
    for (const kind of ['tag', 'gap', 'slot']) assert.ok(block.includes(`t.kind === '${kind}'`), `${rel}: renders ${kind}`);
  }
});
