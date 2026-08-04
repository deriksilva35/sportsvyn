// lib/fantasy/movement.test.mjs — the ADP movement read layer.
//
// Pure: no DB, no network. Four things are pinned here because each is silent
// when wrong:
//   1. THE SIGN CONVENTION. Inverting it turns every riser into a faller and
//      nothing throws. It is checked against a real shape from the locked mock.
//   2. EPOCH EXCLUSION. The 2026-07-20 snapshot must never reach the math; if it
//      leaks in, every open/lo/hi/delta is computed off a stale baseline and the
//      numbers still look plausible.
//   3. GATES AT EXACTLY THE THRESHOLD. Off-by-one here either hides a good
//      column or publishes an untrustworthy one.
//   4. BAND BOUNDARIES AT EXACTLY size/2. The boundary is the whole definition.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADP_EPOCH, BAND_MIN_DRAFTS, MIN_D1_HISTORY, MIN_D3_HISTORY, MIN_D7_HISTORY, MIN_DRIFT_HISTORY,
  STREAK, FORMAT_SIZES, FORMATS, sizeForFormat,
  delta, driftFromSeries, movementFromSeries, bandFor, seriesByPlayer, getMovementBoard,
  cardLists,
} from './movement.js';

// Build an ascending series of {date, adp} starting at `start`, one per day.
const series = (adps, start = '2026-07-30') => adps.map((adp, i) => {
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + i);
  return { date: d.toISOString().slice(0, 10), adp };
});

// ---------------------------------------------------------------------------
// 1. THE SIGN CONVENTION
// ---------------------------------------------------------------------------

test('POSITIVE MEANS RISING: a falling ADP number is a positive delta', () => {
  // Brock Bowers in the locked mock: open 26.7 -> adp 18.2, d7 +8.4, drift +11.
  // He is being drafted EARLIER, so the number must be positive.
  assert.equal(delta(26.7, 18.2), 8.5);
  assert.ok(delta(26.7, 18.2) > 0, 'a player drafted earlier must read positive');
});

test('a rising ADP number is a NEGATIVE delta', () => {
  // Malik Nabers in the mock: open 9.2 -> adp 14.8, d7 -5.6. Falling down boards.
  assert.equal(delta(9.2, 14.8), -5.6);
});

test('no movement is exactly zero, and missing input is null not zero', () => {
  assert.equal(delta(10, 10), 0);
  assert.equal(delta(null, 10), null);
  assert.equal(delta(10, null), null);
  assert.equal(delta(undefined, undefined), null);
});

test('the sign convention holds end to end through movementFromSeries', () => {
  // 8 snapshots so every column ungates; ADP falls the whole way = rising.
  const m = movementFromSeries(series([26.7, 25.0, 24.1, 23.0, 21.4, 20.2, 19.1, 18.2]));
  assert.equal(m.adp, 18.2);
  assert.equal(m.open, 26.7);
  assert.ok(m.d1 > 0 && m.d3 > 0 && m.d7 > 0, 'every delta must be positive for a riser');
  assert.equal(m.d7, 8.5);
  assert.ok(m.drift > 0, 'drift must be positive for a riser');
});

// ---------------------------------------------------------------------------
// 2. EPOCH EXCLUSION
// ---------------------------------------------------------------------------

test('the pre-epoch snapshot never reaches the math', () => {
  // The real shape: 2026-07-20 sits 10 days before the cron's first run. If it
  // leaks in, `open` reads 40 instead of 26.7 and every delta is inflated.
  const rows = [
    { ffc_player_id: '1', name: 'X', position: 'WR', team: 'CIN', adp: 40.0, snapshot_date: '2026-07-20', matched_player_id: 9, times_drafted: 100 },
    { ffc_player_id: '1', name: 'X', position: 'WR', team: 'CIN', adp: 26.7, snapshot_date: '2026-07-30', matched_player_id: 9, times_drafted: 110 },
    { ffc_player_id: '1', name: 'X', position: 'WR', team: 'CIN', adp: 18.2, snapshot_date: '2026-07-31', matched_player_id: 9, times_drafted: 120 },
  ];
  const p = seriesByPlayer(rows).get('1');
  assert.equal(p.series.length, 2, 'the 07-20 row must be dropped');
  assert.equal(p.series[0].date, '2026-07-30');
  const m = movementFromSeries(p.series);
  assert.equal(m.open, 26.7, 'open must be the first POST-epoch snapshot');
  assert.equal(m.d1, 8.5);
});

test('the epoch boundary is inclusive - the epoch day itself counts', () => {
  const rows = [
    { ffc_player_id: '1', name: 'X', position: 'WR', team: 'X', adp: 5, snapshot_date: ADP_EPOCH, matched_player_id: null, times_drafted: null },
  ];
  assert.equal(seriesByPlayer(rows).get('1').series.length, 1);
  // ...and the day before it does not.
  const before = [
    { ffc_player_id: '1', name: 'X', position: 'WR', team: 'X', adp: 5, snapshot_date: '2026-07-29', matched_player_id: null, times_drafted: null },
  ];
  assert.equal(seriesByPlayer(before).size, 0);
});

test('seriesByPlayer sorts ascending and takes descriptive fields from the newest row', () => {
  const rows = [
    { ffc_player_id: '1', name: 'Old Name', position: 'WR', team: 'CIN', adp: 20, snapshot_date: '2026-08-01', matched_player_id: 9, times_drafted: 100 },
    { ffc_player_id: '1', name: 'New Name', position: 'WR', team: 'DAL', adp: 18, snapshot_date: '2026-08-02', matched_player_id: 9, times_drafted: 140 },
    { ffc_player_id: '1', name: 'Mid', position: 'WR', team: 'CIN', adp: 19, snapshot_date: '2026-07-31', matched_player_id: 9, times_drafted: 120 },
  ];
  const p = seriesByPlayer(rows).get('1');
  assert.deepEqual(p.series.map((s) => s.adp), [19, 20, 18], 'ascending by date');
  assert.equal(p.team, 'DAL', 'a traded player should read as his current team');
  assert.equal(p.timesDrafted, 140);
});

// ---------------------------------------------------------------------------
// 3. GATES AT EXACTLY THE THRESHOLD
// ---------------------------------------------------------------------------

test('each column ungates at EXACTLY its threshold, one snapshot earlier is null', () => {
  const flat = (n) => series(Array.from({ length: n }, (_, i) => 20 - i)); // steady riser
  for (const [col, min] of [['d1', MIN_D1_HISTORY], ['d3', MIN_D3_HISTORY], ['d7', MIN_D7_HISTORY], ['drift', MIN_DRIFT_HISTORY]]) {
    const below = movementFromSeries(flat(min - 1));
    const at = movementFromSeries(flat(min));
    assert.equal(below[col], null, `${col} must be null at ${min - 1} snapshots`);
    assert.notEqual(at[col], null, `${col} must be present at exactly ${min} snapshots`);
  }
});

test('a player with one snapshot has an adp and an open, and nothing else', () => {
  const m = movementFromSeries(series([12.4]));
  assert.equal(m.adp, 12.4);
  assert.equal(m.open, 12.4, 'open is a fact about his first appearance, not a delta');
  assert.equal(m.snapshots, 1);
  for (const c of ['d1', 'd3', 'd7', 'drift', 'lo', 'hi']) assert.equal(m[c], null, `${c} must gate`);
});

test('an empty series produces nulls, never zeros', () => {
  // A zero would read on the board as "did not move", which is a claim we cannot
  // make about a player we have never seen.
  const m = movementFromSeries([]);
  for (const c of ['adp', 'open', 'd1', 'd3', 'd7', 'drift', 'lo', 'hi']) assert.equal(m[c], null, `${c} should be null`);
  assert.equal(m.snapshots, 0);
});

test('gates are PER PLAYER, not pool-wide', () => {
  // A newcomer in a deep pool still has only his own history.
  const veteran = movementFromSeries(series([30, 29, 28, 27, 26, 25, 24, 23]));
  const newcomer = movementFromSeries(series([30, 29]));
  assert.notEqual(veteran.drift, null);
  assert.equal(newcomer.drift, null, 'a two-snapshot player must gate even in a deep pool');
  assert.notEqual(newcomer.d1, null, '...but he still has a d1');
});

test('lo/hi come from the series, and are the min/max ADP actually held', () => {
  const m = movementFromSeries(series([20, 14, 26, 18]));
  assert.equal(m.lo, 14);
  assert.equal(m.hi, 26);
  assert.equal(m.adp, 18, 'lo/hi are the range, not the current value');
});

// ---------------------------------------------------------------------------
// DRIFT
// ---------------------------------------------------------------------------

test('drift counts the TRAILING run and stops at the first reversal', () => {
  // falls (rising) 4 times, then one move the other way at the end
  assert.equal(driftFromSeries(series([30, 28, 26, 24, 22])), 4);
  assert.equal(driftFromSeries(series([30, 28, 26, 24, 25])), -1);
  // rising ADP = falling down boards = negative drift
  assert.equal(driftFromSeries(series([20, 22, 24, 26])), -3);
});

test('a flat snapshot BREAKS a streak', () => {
  // "A streak breaks the first morning a player moves the other way" - and a
  // morning with no movement is not a morning moving the same direction.
  assert.equal(driftFromSeries(series([30, 28, 26, 26])), 0);
  assert.equal(driftFromSeries(series([30, 30, 28, 26])), 2, 'the flat is earlier, so the trailing run survives');
});

test('drift needs two points and is null below that', () => {
  assert.equal(driftFromSeries([]), null);
  assert.equal(driftFromSeries(series([20])), null);
});

// ---------------------------------------------------------------------------
// 4. BAND BOUNDARIES AT EXACTLY size/2
// ---------------------------------------------------------------------------

test('Steam/Sliding fire at EXACTLY half a round, in every format size', () => {
  for (const [format, size] of Object.entries(FORMAT_SIZES)) {
    const half = size / 2;
    assert.equal(bandFor({ d3: half, drift: null, size, timesDrafted: 500 }).key, 'steam', `${format}: +${half} must be Steam`);
    assert.equal(bandFor({ d3: -half, drift: null, size, timesDrafted: 500 }).key, 'sliding', `${format}: -${half} must be Sliding`);
    // a hair inside the boundary is not
    assert.equal(bandFor({ d3: half - 0.1, drift: null, size, timesDrafted: 500 }).key, 'quiet');
    assert.equal(bandFor({ d3: -half + 0.1, drift: null, size, timesDrafted: 500 }).key, 'quiet');
  }
  // The stated example: "In PPR (12-team), half a round is six picks."
  assert.equal(sizeForFormat('ppr') / 2, 6);
});

test('Climbing/Fading need persistence AND agreement in sign', () => {
  const size = 12;
  assert.equal(bandFor({ d3: 1, drift: STREAK, size, timesDrafted: 500 }).key, 'warming');
  assert.equal(bandFor({ d3: -1, drift: -STREAK, size, timesDrafted: 500 }).key, 'cooling');
  // one short of the streak is Quiet
  assert.equal(bandFor({ d3: 1, drift: STREAK - 1, size, timesDrafted: 500 }).key, 'quiet');
  // a long streak that disagrees with the three-day move is Quiet, not Climbing
  assert.equal(bandFor({ d3: -1, drift: STREAK, size, timesDrafted: 500 }).key, 'quiet');
  assert.equal(bandFor({ d3: 0, drift: STREAK, size, timesDrafted: 500 }).key, 'quiet', 'a flat d3 is not a climb');
});

test('magnitude BEATS persistence when both fire', () => {
  assert.equal(bandFor({ d3: 6, drift: STREAK, size: 12, timesDrafted: 500 }).key, 'steam');
  assert.equal(bandFor({ d3: -6, drift: -STREAK, size: 12, timesDrafted: 500 }).key, 'sliding');
});

test('WITH DRIFT GATED, bands degrade to magnitude-only - never Climbing/Fading', () => {
  // This is the state the board is in right now (5 post-epoch snapshots), so it
  // is the behaviour that actually ships first.
  const size = 12;
  assert.equal(bandFor({ d3: 6, drift: null, size, timesDrafted: 500 }).key, 'steam');
  assert.equal(bandFor({ d3: -6, drift: null, size, timesDrafted: 500 }).key, 'sliding');
  assert.equal(bandFor({ d3: 2, drift: null, size, timesDrafted: 500 }).key, 'quiet');
  assert.equal(bandFor({ d3: -2, drift: null, size, timesDrafted: 500 }).key, 'quiet');
  for (const d3 of [-5.9, -2, 0, 2, 5.9]) {
    const k = bandFor({ d3, drift: null, size }).key;
    assert.ok(!['warming', 'cooling'].includes(k), `drift-gated must never produce ${k}`);
  }
});

test('no d3 means no band at all - an em-dash, not Quiet', () => {
  // "Quiet" is a claim that the player did not move. Without d3 we cannot say.
  assert.deepEqual(bandFor({ d3: null, drift: 8, size: 12, timesDrafted: 500 }), { key: 'none', label: '—' });
});

// ---------------------------------------------------------------------------
// Format / size coupling
// ---------------------------------------------------------------------------

test('the four FFC format/size pairs are exactly what recon found', () => {
  assert.deepEqual(FORMAT_SIZES, { ppr: 12, 'half-ppr': 10, standard: 8, '2qb': 12 });
  assert.deepEqual(FORMATS, ['ppr', 'half-ppr', 'standard', '2qb']);
  assert.equal(sizeForFormat('nonsense'), null, 'an unknown format has no size to guess');
});

// ---------------------------------------------------------------------------
// 5. THE BAND SAMPLE FLOOR (BAND_MIN_DRAFTS)
// ---------------------------------------------------------------------------

test('the band floor fires at EXACTLY BAND_MIN_DRAFTS', () => {
  const size = 12;
  const big = { d3: 6, drift: null, size };          // would otherwise be Steam
  assert.equal(bandFor({ ...big, timesDrafted: BAND_MIN_DRAFTS }).key, 'steam', 'at the floor it counts');
  assert.equal(bandFor({ ...big, timesDrafted: BAND_MIN_DRAFTS - 1 }).key, 'none', 'one below it does not');
  assert.equal(BAND_MIN_DRAFTS, 50);
});

test('a thin sample gets NO band however big the move', () => {
  // The live case: Kaelon Black posted d3 = +13.0 off eight drafts. That is
  // sampling noise wearing the costume of a market move.
  const size = 12;
  for (const d3 of [13, 6, -6, -13, 0.1]) {
    assert.equal(bandFor({ d3, drift: 9, size, timesDrafted: 8 }).key, 'none', `d3=${d3} must not band on 8 drafts`);
  }
  // ...and a missing draft count is treated as thin, not as healthy.
  assert.equal(bandFor({ d3: 6, drift: null, size, timesDrafted: null }).key, 'none');
  assert.equal(bandFor({ d3: 6, drift: null, size, timesDrafted: undefined }).key, 'none');
});

test('the floor suppresses the BAND ONLY - the numbers themselves are untouched', () => {
  // movementFromSeries knows nothing about draft counts; it reports what it saw.
  const m = movementFromSeries(series([168.1, 165, 162, 160, 158.2]));
  assert.equal(m.adp, 158.2);
  assert.equal(m.open, 168.1);
  assert.notEqual(m.d3, null, 'd3 still computes for a thin-sample player');
  assert.notEqual(m.lo, null);
  assert.equal(bandFor({ d3: m.d3, drift: m.drift, size: 12, timesDrafted: 8 }).key, 'none');
});

// ---------------------------------------------------------------------------
// 6. LATEST-SNAPSHOT RESTRICTION
// ---------------------------------------------------------------------------

const poolRow = (id, name, date, adp, drafted = 500) => ({
  ffc_player_id: id, name, position: 'WR', team: 'CIN', adp,
  snapshot_date: date, matched_player_id: 1, times_drafted: drafted,
});

test('a player absent from the LATEST snapshot is excluded from the board', async () => {
  // A dropped player has no current ADP. Rendering his last-seen value in a
  // column labelled ADP would be inference.
  const rows = [
    poolRow('stayed', 'Stayed', '2026-07-30', 20), poolRow('stayed', 'Stayed', '2026-07-31', 19),
    poolRow('stayed', 'Stayed', '2026-08-01', 18),
    poolRow('dropped', 'Dropped', '2026-07-30', 60), poolRow('dropped', 'Dropped', '2026-07-31', 58),
  ];
  const fakeSql = async () => rows;
  const b = await getMovementBoard('ppr', { sql: fakeSql });
  const names = b.players.map((p) => p.name);
  assert.deepEqual(names, ['Stayed'], 'the dropped player must not appear');
  assert.equal(b.latestSnapshot, '2026-08-01');
});

test('a RE-ADDED player resumes movement from the full spine, not from scratch', async () => {
  // Present, absent, present. His history is still in the spine, so the board
  // shows him again with the record intact rather than treating him as new.
  const rows = [
    poolRow('back', 'Came Back', '2026-07-30', 60),
    poolRow('back', 'Came Back', '2026-07-31', 55),
    // absent 2026-08-01
    poolRow('back', 'Came Back', '2026-08-02', 50),
    poolRow('other', 'Other', '2026-08-02', 10),
  ];
  const b = await getMovementBoard('ppr', { sql: async () => rows });
  const p = b.players.find((x) => x.name === 'Came Back');
  assert.ok(p, 're-added player must be on the board');
  assert.equal(p.snapshots, 3, 'his three observations survive the gap');
  assert.equal(p.open, 60, 'open is still his FIRST post-epoch snapshot, not his return');
  assert.equal(p.d1, 5, 'the delta spans the gap - deltas are snapshot-indexed, not day-indexed');
});

test('the restriction does not disturb the epoch rule', async () => {
  const rows = [
    poolRow('p', 'P', '2026-07-20', 99),   // pre-epoch, must never count
    poolRow('p', 'P', '2026-07-30', 20),
    poolRow('p', 'P', '2026-07-31', 18),
  ];
  const b = await getMovementBoard('ppr', { sql: async () => rows });
  assert.equal(b.players.length, 1);
  assert.equal(b.players[0].open, 20, 'open must be post-epoch');
  assert.equal(b.players[0].snapshots, 2);
  assert.deepEqual(b.snapshotDates, ['2026-07-30', '2026-07-31']);
});

test('bandEligible marks who may be READ as signal', async () => {
  const rows = [
    // healthy sample, four snapshots -> real band
    poolRow('a', 'Healthy', '2026-07-30', 30, 500), poolRow('a', 'Healthy', '2026-07-31', 28, 500),
    poolRow('a', 'Healthy', '2026-08-01', 26, 500), poolRow('a', 'Healthy', '2026-08-02', 20, 500),
    // thin sample, same move
    poolRow('b', 'Thin', '2026-07-30', 30, 8), poolRow('b', 'Thin', '2026-07-31', 28, 8),
    poolRow('b', 'Thin', '2026-08-01', 26, 8), poolRow('b', 'Thin', '2026-08-02', 20, 8),
  ];
  const b = await getMovementBoard('ppr', { sql: async () => rows });
  const healthy = b.players.find((p) => p.name === 'Healthy');
  const thin = b.players.find((p) => p.name === 'Thin');
  assert.equal(healthy.band.key, 'steam');
  assert.equal(healthy.bandEligible, true);
  assert.equal(thin.band.key, 'none');
  assert.equal(thin.bandEligible, false, 'a thin sample must not feed counts, filters or lists');
  // Both still carry their real numbers.
  assert.equal(thin.d3, 10);
  assert.equal(thin.adp, 20);
});

// ---------------------------------------------------------------------------
// THE ENTRY CARD. The rule worth pinning is the one that is invisible when
// broken: Climbing must be ABSENT, not empty, while drift is gated. An empty
// array and a null render identically in a careless component, and the wrong
// one puts a permanently-dead tab on the page.

test('cardLists hides Climbing entirely while drift is gated', async () => {
  // Four snapshots: d3 is open, drift is not (it needs MIN_DRIFT_HISTORY = 8).
  const dates = ['2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02'];
  const rows = [40, 36, 32, 28].map((adp, i) => poolRow('a', 'Riser', dates[i], adp, 500));
  const b = await getMovementBoard('ppr', { sql: async () => rows });
  assert.equal(b.gates.drift, false, 'precondition: drift is gated at four snapshots');
  const lists = cardLists(b);
  assert.equal(lists.climbing, null, 'gated drift must yield null, never []');
  assert.ok(lists.rising.length > 0);
});

test('cardLists applies the board sample floor - a thin mover never leads the card', async () => {
  const rows = [
    poolRow('a', 'Healthy', '2026-07-30', 30, BAND_MIN_DRAFTS), poolRow('a', 'Healthy', '2026-07-31', 29, BAND_MIN_DRAFTS),
    poolRow('a', 'Healthy', '2026-08-01', 28, BAND_MIN_DRAFTS), poolRow('a', 'Healthy', '2026-08-02', 23, BAND_MIN_DRAFTS),
    // A BIGGER move on a thin sample. It must not appear at all.
    poolRow('b', 'Thin', '2026-07-30', 60, BAND_MIN_DRAFTS - 1), poolRow('b', 'Thin', '2026-07-31', 55, BAND_MIN_DRAFTS - 1),
    poolRow('b', 'Thin', '2026-08-01', 50, BAND_MIN_DRAFTS - 1), poolRow('b', 'Thin', '2026-08-02', 30, BAND_MIN_DRAFTS - 1),
  ];
  const b = await getMovementBoard('ppr', { sql: async () => rows });
  const lists = cardLists(b);
  assert.deepEqual(lists.rising.map((p) => p.name), ['Healthy']);
  assert.equal(lists.falling.length, 0);
});

test('cardLists splits by direction and orders by magnitude', async () => {
  const rows = [];
  const mk = (id, name, adps) => adps.forEach((adp, i) =>
    rows.push(poolRow(id, name, ['2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02'][i], adp, 500)));
  mk('a', 'BigRiser', [40, 38, 36, 25]);   // d3 = +15
  mk('b', 'SmallRiser', [40, 39, 38, 33]); // d3 = +7
  mk('c', 'BigFaller', [20, 22, 24, 38]);  // d3 = -18
  const lists = cardLists(await getMovementBoard('ppr', { sql: async () => rows }));
  assert.deepEqual(lists.rising.map((p) => p.name), ['BigRiser', 'SmallRiser']);
  assert.deepEqual(lists.falling.map((p) => p.name), ['BigFaller']);
  assert.ok(lists.rising[0].d3 > lists.rising[1].d3, 'rising is ordered by magnitude');
});

test('cardLists caps each list at n', async () => {
  const rows = [];
  for (let k = 0; k < 9; k += 1) {
    const adps = [60, 58, 56, 60 - 4 - k];
    adps.forEach((adp, i) => rows.push(
      poolRow(`p${k}`, `P${k}`, ['2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02'][i], adp, 500)));
  }
  const lists = cardLists(await getMovementBoard('ppr', { sql: async () => rows }), 5);
  assert.equal(lists.rising.length, 5);
});

// ---------------------------------------------------------------------------
// CARRIED FORWARD from lib/sim/fantasyBoard.test.mjs, deleted when the ungated
// ADP-movers reader was removed. The bug it guarded is not specific to that
// reader: sim_player_pool holds one row per player PER (scoring_format,
// teams_count), so any read that fails to pin BOTH axes gets one row per format
// for the same player and silently diffs one format's ADP against another's.
// The tell is a QB with an impossible ~110-pick "move" - a 2QB ADP measured
// against a standard ADP. Real numbers below are Sam Darnold (ffc id 2884) on
// 2026-07-30, kept because they are what the failure actually looked like.

test('the board query pins BOTH pool axes, not just the format', async () => {
  let text = '';
  const spy = async (strings) => { text = strings.join('?'); return []; };
  await getMovementBoard('ppr', { sql: spy });
  assert.match(text, /scoring_format\s*=/, 'must scope the scoring format');
  assert.match(text, /teams_count\s*=/, 'must scope the league size too');
});

test('cross-format rows for one player are a detectable corruption, not a quiet average', async () => {
  // What an unscoped read would hand the series builder: four ADPs for the same
  // player on the SAME snapshot date, one per format pair.
  const darnold = (adp) => ({
    ffc_player_id: '2884', name: 'Sam Darnold', position: 'QB', team: 'SEA',
    adp, snapshot_date: '2026-07-30', matched_player_id: 9, times_drafted: 500,
  });
  const s = seriesByPlayer([darnold(50.9), darnold(153.6), darnold(149.3), darnold(160.6)]);
  const entry = s.get('2884');
  // One date collapses to ONE point - the builder keys on date, so the extra
  // format rows do not average in. The player ends with a single-snapshot
  // history, which every gate then correctly refuses to read.
  assert.equal(entry.series.length, 1, 'a date is one point, whatever leaked in');
  const m = movementFromSeries(entry.series);
  assert.equal(m.d1, null, 'and one point can never produce a delta');
  assert.equal(m.d3, null);
  assert.equal(m.drift, null);
});
