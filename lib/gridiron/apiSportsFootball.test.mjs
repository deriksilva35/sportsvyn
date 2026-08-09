// lib/gridiron/apiSportsFootball.test.mjs - the API-Sports american-football
// ingest boundary, tested against REAL captured payloads.
//
// WHY A FIXTURE AND NOT HAND-WRITTEN OBJECTS. Every defect this file guards
// against is a defect of BELIEF about the provider's shape - that `status.short`
// is always a string, that a week is a number, that `date.time` is the kickoff.
// A hand-written object encodes the belief and then confirms it, which is worth
// nothing. lib/gridiron/fixtures/apisports-nfl-games.json is captured verbatim
// from /games for 2024 and 2026 and trimmed to one row per branch; the rows are
// what the provider actually sent.
//
// The vocabulary below was established across two COMPLETE seasons (2024: 335
// games, 2026: 328), not sampled - so "these are all the tokens" is a count,
// not an impression.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapStatus, apiSportsPhaseAndWeek, toUtc, skipRule, makeRunSummary } from './ingest.js';
import {
  isDailyCapError, isPlanError, hasErrors, NFL_LEAGUE_ID, NCAA_LEAGUE_ID,
} from '../apiSportsFootball.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(readFileSync(path.join(HERE, 'fixtures/apisports-nfl-games.json'), 'utf8'));
const row = (why) => {
  const hit = FIXTURE.rows.find((r) => r.why.includes(why));
  assert.ok(hit, `fixture is missing the "${why}" row - recapture it, do not delete the test`);
  return hit.game;
};

// ---------------------------------------------------------------------------
// The trap: overtime finals carry a NULL status.short
// ---------------------------------------------------------------------------

test('THE TRAP: an overtime final has no status.short, and still maps to final', () => {
  // 16 of 2024's 335 games look like this. An ingest that switched on `short`
  // would drop every one of them - silently, and only in the games most likely
  // to be worth reading about.
  const g = row('NULL status.short');
  assert.equal(g.game.status.short, null, 'the fixture must still exhibit the trap');
  assert.equal(g.game.status.long, 'Final/OT');

  const rs = makeRunSummary();
  assert.equal(mapStatus('apisports', 'nfl', g.game.status, rs), 'final');
  assert.equal(rs.unknownStatus, 0, 'and it must not be counted as unknown');
});

test('the whole status object is accepted, not just a token', () => {
  const rs = makeRunSummary();
  for (const [status, expected] of [
    [{ short: 'FT', long: 'Finished', timer: null }, 'final'],
    [{ short: null, long: 'Final/OT', timer: null }, 'final'],
    [{ short: 'NS', long: 'Not Started', timer: null }, 'scheduled'],
    [{ short: 'Q3', long: 'Third Quarter', timer: '4:21' }, 'live'],
    [{ short: 'HT', long: 'Halftime', timer: null }, 'live'],
    [{ short: 'OT', long: 'Overtime', timer: '9:12' }, 'live'],
    [{ short: 'PST', long: 'Postponed', timer: null }, 'postponed'],
    [{ short: 'CANC', long: 'Cancelled', timer: null }, 'cancelled'],
  ]) {
    assert.equal(mapStatus('apisports', 'nfl', status, rs), expected, JSON.stringify(status));
  }
  assert.equal(rs.unknownStatus, 0);
});

test('a status with neither short nor long fails LOUD, never silently', () => {
  const rs = makeRunSummary();
  assert.equal(mapStatus('apisports', 'nfl', { short: null, long: null }, rs), null);
  assert.equal(rs.unknownStatus, 1, 'an unmappable status must be counted so the alert fires');
});

test('an unknown token is reported rather than guessed', () => {
  const rs = makeRunSummary();
  assert.equal(mapStatus('apisports', 'nfl', { short: 'ZZZ', long: 'Some New Thing' }, rs), null);
  assert.equal(rs.unknownStatus, 1);
});

test('every status token the two captured seasons contain is mapped', () => {
  // 2024 and 2026 between them produced exactly three distinct status shapes.
  const rs = makeRunSummary();
  for (const s of [
    { short: 'FT', long: 'Finished' },
    { short: 'NS', long: 'Not Started' },
    { short: null, long: 'Final/OT' },
  ]) {
    assert.ok(mapStatus('apisports', 'nfl', s, rs), `${JSON.stringify(s)} must map`);
  }
  assert.equal(rs.unknownStatus, 0);
});

// ---------------------------------------------------------------------------
// Datetimes
// ---------------------------------------------------------------------------

test('kickoff comes from the TIMESTAMP, because date.time lies', async () => {
  // The 2024 Hall of Fame row carries time "00:00" against a timestamp that is
  // correct. Composing `${date}T${time}Z` would have moved that kickoff to
  // midnight and nobody would have noticed until the game rendered a day early.
  const hof = row('Hall of Fame');
  assert.equal(hof.game.date.time, '00:00', 'the fixture must still exhibit the lie');
  const iso = await toUtc(hof.game.date.timestamp, null, 'apisports');
  assert.equal(iso, new Date(hof.game.date.timestamp * 1000).toISOString());
  assert.match(iso, /^2024-08-0\dT\d\d:\d\d:\d\d\.000Z$/);
});

test('a real 2026 preseason kickoff round-trips to the stated wall time', async () => {
  const g = row('Thursday Aug 13');
  const iso = await toUtc(g.game.date.timestamp, null, 'apisports');
  // date.time IS trustworthy on this row; asserting they agree is what pins
  // that the timestamp is seconds, not milliseconds.
  assert.equal(iso.slice(0, 10), g.game.date.date);
  assert.equal(iso.slice(11, 16), g.game.date.time);
});

test('seconds, not milliseconds, and nothing else', async () => {
  // The epoch value comes off the fixture rather than being written out here.
  // A hand-typed constant is a second source of truth for the same fact, and
  // the first draft of this test had one that was simply wrong.
  const ts = row('Thursday Aug 13').game.date.timestamp;
  assert.equal(await toUtc(ts, null, 'apisports'), '2026-08-13T23:00:00.000Z');
  assert.equal(await toUtc(null, null, 'apisports'), null);
  // A millisecond value would silently produce a date in the year 58000 rather
  // than throwing, so the guard is on the TYPE, not the magnitude.
  await assert.rejects(() => toUtc('2026-08-13T23:00:00Z', null, 'apisports'), /expected epoch seconds/);
  await assert.rejects(() => toUtc({}, null, 'apisports'), /expected epoch seconds/);
});

test('the other providers are untouched by the new case', async () => {
  assert.equal(await toUtc('2025-09-05T00:20:00.000Z', null, 'bdl'), '2025-09-05T00:20:00.000Z');
  await assert.rejects(() => toUtc('x', null, 'nonsense'), /unrecognized provider/);
});

// ---------------------------------------------------------------------------
// Stage and week
// ---------------------------------------------------------------------------

test('the three stages map to our three phases', () => {
  assert.equal(apiSportsPhaseAndWeek('Pre Season', 'Week 1').phase, 'PRE');
  assert.equal(apiSportsPhaseAndWeek('Regular Season', 'Week 12').phase, 'REG');
  assert.equal(apiSportsPhaseAndWeek('Post Season', 'Wild Card').phase, 'POST');
});

test('Hall of Fame Weekend is preseason week 0', () => {
  const g = row('Hall of Fame');
  const r = apiSportsPhaseAndWeek(g.game.stage, g.game.week);
  assert.deepEqual({ phase: r.phase, week: r.week }, { phase: 'PRE', week: 0 });
  assert.equal(r.label, 'Hall of Fame Weekend', 'the prose label is preserved for display');
});

test('THE PRO BOWL IS AN ALL-STAR GAME WEARING A POSTSEASON LABEL', () => {
  // API-Sports stages it "Post Season". Mapped naively it becomes a POST game
  // and an exhibition lands in team records. 2024 carried exactly one.
  const r = apiSportsPhaseAndWeek('Post Season', 'Pro Bowl');
  assert.equal(r.phase, 'STAR', 'must NOT be POST');
  // skipRule already knows what to do with STAR, loudly and with a count.
  const rs = makeRunSummary();
  const s = skipRule(r.phase, rs);
  assert.equal(s.skip, true);
  assert.equal(rs.skippedByPhase.STAR, 1, 'skipped rows are counted, never silently dropped');
});

test('postseason weeks follow the NUMBERING ALREADY IN THE DATABASE', () => {
  // PROD's existing NFL POST rows, written by the other feed, use the NFL's own
  // numbering - and week 4 is ABSENT from that data because the Pro Bowl
  // occupies it. Numbering the Super Bowl 4 here would give one game two
  // different week values depending on which provider imported it.
  assert.equal(apiSportsPhaseAndWeek('Post Season', 'Wild Card').week, 1);
  assert.equal(apiSportsPhaseAndWeek('Post Season', 'Divisional Round').week, 2);
  assert.equal(apiSportsPhaseAndWeek('Post Season', 'Conference Championships').week, 3);
  assert.equal(apiSportsPhaseAndWeek('Post Season', 'Pro Bowl').week, 4);
  assert.equal(apiSportsPhaseAndWeek('Post Season', 'Super Bowl').week, 5,
    'the Super Bowl is week 5, matching the rows already in PROD');
});

test('every stage/week pair the two captured seasons contain resolves', () => {
  // The complete cross-product observed across 2024 + 2026.
  const observed = [
    ['Pre Season', 'Hall of Fame Weekend'],
    ...[1, 2, 3].map((n) => ['Pre Season', `Week ${n}`]),
    ...Array.from({ length: 18 }, (_, i) => ['Regular Season', `Week ${i + 1}`]),
    ['Post Season', 'Wild Card'], ['Post Season', 'Divisional Round'],
    ['Post Season', 'Conference Championships'], ['Post Season', 'Pro Bowl'],
    ['Post Season', 'Super Bowl'],
  ];
  const rs = makeRunSummary();
  for (const [stage, week] of observed) {
    const r = apiSportsPhaseAndWeek(stage, week, rs);
    assert.ok(r.phase, `${stage} :: ${week} produced no phase`);
    assert.ok(Number.isInteger(r.week), `${stage} :: ${week} produced no week number`);
  }
  assert.equal(rs.unknownStatus, 0, 'nothing in the observed vocabulary may be unknown');
  assert.equal(observed.length, 27);
});

test('an unrecognized stage or week is reported, not coerced', () => {
  const rs = makeRunSummary();
  assert.equal(apiSportsPhaseAndWeek('Friendly', 'Week 1', rs).phase, null);
  assert.equal(apiSportsPhaseAndWeek('Post Season', 'Toilet Bowl', rs).week, null);
  assert.equal(apiSportsPhaseAndWeek('Regular Season', 'Championship Sunday', rs).week, null);
  assert.equal(rs.unknownStatus, 3, 'each miss is counted so the alert fires');
});

test('every fixture row resolves end to end', async () => {
  // The whole point: take the rows the provider actually sent and put them
  // through every mapper. A row that cannot be resolved is a row the importer
  // could not have stored.
  const rs = makeRunSummary();
  for (const { why, game: g } of FIXTURE.rows) {
    const status = mapStatus('apisports', 'nfl', g.game.status, rs);
    const pw = apiSportsPhaseAndWeek(g.game.stage, g.game.week, rs);
    const iso = await toUtc(g.game.date.timestamp, null, 'apisports');
    assert.ok(status, `no status for: ${why}`);
    assert.ok(pw.phase, `no phase for: ${why}`);
    assert.ok(Number.isInteger(pw.week), `no week for: ${why}`);
    assert.match(iso, /Z$/, `no kickoff for: ${why}`);
    assert.ok(g.teams?.home?.name && g.teams?.away?.name, `no team names for: ${why}`);
    assert.ok(Number.isInteger(g.game.id), `no provider game id for: ${why}`);
  }
  assert.equal(rs.unknownStatus, 0);
  assert.ok(FIXTURE.rows.length >= 7, 'the fixture must keep covering every branch');
});

// ---------------------------------------------------------------------------
// The client's error classification
// ---------------------------------------------------------------------------

test('the daily cap arrives as HTTP 200 with an error body', () => {
  // Same shape as the soccer product: the 429 retry path never fires for it.
  assert.equal(isDailyCapError({ requests: 'You have reached the request limit for the day, ...' }), true);
  assert.equal(isDailyCapError({ requests: 'something else' }), false);
  assert.equal(isDailyCapError({}), false);
  assert.equal(isDailyCapError(null), false);
});

test('a season the plan does not cover is its own error, not a generic one', () => {
  // Verbatim from the Free tier before the upgrade. The remedy is human and
  // different from a rate limit, and it must never look like an empty season.
  const body = { plan: 'Free plans do not have access to this season, try from 2022 to 2024.' };
  assert.equal(isPlanError(body), true);
  assert.equal(isDailyCapError(body), false, 'a plan error is not a cap error');
  assert.equal(isPlanError({ requests: 'capped' }), false);
  assert.equal(isPlanError({}), false);
});

test('errors arrive as an ARRAY when empty and an OBJECT when not', () => {
  assert.equal(hasErrors([]), false);
  assert.equal(hasErrors({}), false);
  assert.equal(hasErrors(undefined), false);
  assert.equal(hasErrors({ plan: 'x' }), true);
  assert.equal(hasErrors(['x']), true);
});

test('the client parses no dates and touches no database', () => {
  // COMMENTS ARE STRIPPED FIRST. The first draft of this test scanned raw
  // source and failed on its own subject's prose - the client's header explains
  // that it must not call the forbidden constructor, and naming it was enough
  // to trip the scan. A source guard has to assert about CODE.
  const raw = readFileSync(path.join(HERE, '..', 'apiSportsFootball.js'), 'utf8');
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // The datetime boundary is lib/gridiron/ingest.js and nowhere else (CLAUDE.md).
  assert.ok(!/new Date\(/.test(src), 'no date parsing in the client');
  assert.ok(!/AT TIME ZONE/.test(src), 'no timezone SQL in the client');
  assert.ok(!/from '\.\/db|from '\.\.\/db|sql`/.test(src), 'no database access in the client');
  assert.equal(NFL_LEAGUE_ID, 1);
  assert.equal(NCAA_LEAGUE_ID, 2);
});
