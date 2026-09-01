// lib/live/live.test.mjs — the live poller's decisions, all of which live in
// pure modules so they can be checked without a network, a clock or a game.
// Run: node --test lib/live/live.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cadence, sleepUntilNext, LIVE_SEC, IDLE_SEC } from './cadence.js';
import { mapLiveStatus, liveState, BDL_STATE, CFBD_SCOREBOARD } from './vocabulary.js';
import { scoreHeadline, scoreEventKey, toScoreRow } from './scoreEvent.js';
import { overCap, applyCap, utcDay, DEFAULT_CAP, FCS_EVERY_NTH_POLL, fcsThisPoll, saturdayCalls } from './quota.js';
import { scoreChanged } from './write.js';
import { scopeToStatus, fromCfbd } from '../../services/live-poller/poll.mjs';
import { LIVE_LOCK, YIELDED } from './handshake.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (r) => readFileSync(path.join(REPO, r), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const NOW = new Date('2026-09-13T18:00:00Z');

// ---------------------------------------------------------------------------
// 1. VOCABULARY — mapped explicitly, unmapped counted, never coerced
// ---------------------------------------------------------------------------

test('every mapping is explicit, both providers', () => {
  const u = [];
  assert.equal(mapLiveStatus('cfbd', 'in_progress', u), 'live');
  assert.equal(mapLiveStatus('cfbd', 'completed', u), 'final');
  assert.equal(mapLiveStatus('cfbd', 'scheduled', u), 'scheduled');
  assert.equal(mapLiveStatus('bdl', 'in_progress', u), 'live');
  assert.equal(mapLiveStatus('bdl', 'final', u), 'final');
  assert.equal(mapLiveStatus('bdl', 'scheduled', u), 'scheduled');
  assert.deepEqual(u, [], 'nothing above should have been recorded as unknown');
});

test('AN UNKNOWN TOKEN IS COUNTED AND WRITES NOTHING - it is never coerced', () => {
  // The NFL live spellings have never been observed - the first live NFL game
  // is Week 1 - so the map carries only the documented values and anything else
  // must shout. A guessed key would map silently and defeat the one mechanism
  // that can teach us the truth.
  const u = [];
  assert.equal(mapLiveStatus('bdl', 'STATUS_IN_PROGRESS_2', u), null);
  assert.equal(mapLiveStatus('cfbd', 'delayed', u), null);
  assert.equal(mapLiveStatus('bdl', null, u), null);
  assert.equal(mapLiveStatus('bdl', '', u), null);
  assert.equal(mapLiveStatus('espn', 'live', u), null, 'an unknown PROVIDER too');
  assert.deepEqual(u, ['STATUS_IN_PROGRESS_2', 'delayed', '(empty)', '(empty)', '(no table: espn)']);
});

test('the case and whitespace of a known token do not decide the answer', () => {
  assert.equal(mapLiveStatus('cfbd', ' In_Progress ', []), 'live');
});

test('BDL is read on status_state, not on the prose status field', () => {
  // `status` on a scheduled BDL row is the kickoff rendered as prose - one
  // distinct value per game, so it cannot be a table key. Measured on the real
  // payload 1 Sep 2026: status "9/13 - 1:00 PM EDT", status_state "scheduled".
  const t = strip(src('services/live-poller/poll.mjs'));
  assert.match(t, /mapLiveStatus\('bdl', row\?\.status_state/);
  assert.doesNotMatch(t, /mapLiveStatus\('bdl', row\?\.status,/);
  assert.equal(mapLiveStatus('bdl', '9/13 - 1:00 PM EDT', []), null,
    'and the prose form is not silently accepted either');
});

test('the live chip claims knowledge or says nothing', () => {
  assert.deepEqual(liveState(2, '8:41'), { period: 2, clock: '8:41' });
  assert.equal(liveState(2, null), null, 'a period with no clock is half a fact');
  assert.equal(liveState(null, '8:41'), null);
  assert.equal(liveState(0, '8:41'), null);
});

// ---------------------------------------------------------------------------
// 2. COALESCE NEVER NULLS — the D5 law, read off the statement
// ---------------------------------------------------------------------------

test('D5: AN INCOMING NULL CAN NEVER ERASE A SCORE', () => {
  // Both feeds leave the score null for stretches of a live game, and writing
  // that null over a running score is what blanked the 29 Aug opener's
  // scoreboard for 20 seconds a tick, all slate long.
  const t = strip(src('lib/live/write.js'));
  assert.match(t, /home_score = COALESCE\(\$\{homeScore\}::int, home_score\)/);
  assert.match(t, /away_score = COALESCE\(\$\{awayScore\}::int, away_score\)/);
  assert.match(t, /status = COALESCE\(\$\{status\}::text, status\)/);
  // And no bare assignment of any of the three anywhere in the file.
  assert.doesNotMatch(t, /home_score = \$\{/, 'a bare score assignment would defeat it');
  assert.doesNotMatch(t, /away_score = \$\{/);
});

test('D6: live_state dies with the game, and the merge is written out', () => {
  const t = strip(src('lib/live/write.js'));
  // Nulled whenever the resulting status is not live - not merely on the tick
  // that flips it, which would miss a row that arrived already final.
  assert.match(t, /CASE WHEN COALESCE\(\$\{status\}::text, status\) = 'live'/);
  assert.match(t, /ELSE 'null'::jsonb END/);
  // final_seen_at is NESTED, so its merge is spelled out - `||` is one level
  // deep and a top-level merge would replace the whole detail object.
  assert.match(t, /COALESCE\(metadata->'detail', '\{\}'::jsonb\)/);
  // Set-once: the stored value is re-asserted, so a later writer cannot walk a
  // timestamp backwards.
  assert.match(t, /COALESCE\(metadata->'detail'->>'final_seen_at',/);
});

test('THE POLLER OWNS A SUBSET AND TOUCHES NOTHING ELSE', () => {
  // drives and plays have their own writers on their own cadences; a 30-second
  // loop reaching into them would race every one.
  const t = strip(src('lib/live/write.js'));
  for (const forbidden of ['drives', 'plays', 'line_scores', 'kickoff_at', 'week', 'external_ids']) {
    assert.ok(!t.includes(forbidden), `the poller must not write ${forbidden}`);
  }
});

test('scoreChanged compares against OUR row, not the last poll', () => {
  // A restarted loop has no last poll and must still not re-emit every score on
  // the board.
  assert.equal(scoreChanged({ home_score: 7, away_score: 0 }, { home_score: 14, away_score: 0 }), true);
  assert.equal(scoreChanged({ home_score: 7, away_score: 0 }, { home_score: 7, away_score: 0 }), false);
  assert.equal(scoreChanged({ home_score: null, away_score: null }, { home_score: 0, away_score: 0 }), true);
  assert.equal(scoreChanged({ home_score: 7 }, null), false);
});

// ---------------------------------------------------------------------------
// 3. THE LOCK HANDSHAKE
// ---------------------------------------------------------------------------

test('the tick YIELDS when the droplet holds the lock, and says so', () => {
  const t = strip(src('lib/gridiron/sync.js'));
  assert.match(t, /withAdvisoryLock\(LIVE_LOCK\('cfb'\)/, 'the arm asks for the lock');
  assert.match(t, /held\.locked\s*\?\s*\{ decision: YIELDED/, 'and yields when it cannot get it');
  assert.equal(YIELDED, 'yielded-to-droplet');
  // YIELDING IS NOT FAILING. A tick ledgered as failed every Saturday trains
  // the alert to be ignored, so the decision string is its own value and the
  // arm does not throw.
  assert.doesNotMatch(t, /held\.locked[\s\S]{0,80}throw/);
});

test('and resumes on its own the moment the lock is free', () => {
  // Nothing latches. The arm asks every tick and runs whenever it succeeds, so
  // a droplet that dies mid-slate costs one tick of latency, not the slate.
  const t = strip(src('lib/gridiron/sync.js'));
  assert.doesNotMatch(t, /droplet(Owns|Active|Disabled)/, 'no persisted flag to get stuck on');
  assert.match(t, /held\.locked\s*\?[\s\S]{0,120}:\s*held\.result/, 'otherwise it just runs');
});

test('ONLY THE LIVE-SCORE ARM YIELDS - the rest of the tick is untouched', () => {
  const t = strip(src('lib/gridiron/sync.js'));
  const arm = t.slice(t.indexOf("LIVE_LOCK('cfb')"));
  assert.ok(!/syncCfbBroadcasts/.test(arm), 'broadcasts are outside the lock');
  assert.ok(!/syncCfbLiveLines/.test(arm.slice(0, arm.indexOf('liveLineSummary'))),
    'the live box score keeps its own cadence');
  // plays-live and cfb-player-stats take different locks entirely.
  assert.equal(LIVE_LOCK('cfb'), 'live-scores-cfb');
  assert.equal(LIVE_LOCK('nfl'), 'live-scores-nfl');
});

test('the lock is held for the WINDOW, not per poll', () => {
  // Taking and dropping it every 30 seconds leaves a gap on every cycle that
  // the Vercel tick could land in - the exact collision the lock prevents.
  const t = strip(src('services/live-poller/index.mjs'));
  assert.match(t, /if \(active && !lock\)/, 'acquired when the window opens');
  assert.match(t, /if \(!active && lock\)/, 'released when it closes');
  const pollBlock = t.slice(t.indexOf('if (active && lock'), t.indexOf('heartbeat'));
  assert.ok(!/acquire\(/.test(pollBlock), 'never re-acquired inside the poll');
});

// ---------------------------------------------------------------------------
// 4. THE CADENCE STATE MACHINE
// ---------------------------------------------------------------------------

test('four states, and the clock is an ARGUMENT', () => {
  const c = (g) => cadence(g, NOW);
  assert.equal(c([{ status: 'live' }]).state, 'live');
  assert.equal(c([{ status: 'scheduled', kickoffAt: '2026-09-13T18:05:00Z' }]).state, 'pre-kick');
  assert.equal(c([{ status: 'final', finalSeenAt: '2026-09-13T17:58:00Z' }]).state, 'post');
  assert.equal(c([{ status: 'scheduled', kickoffAt: '2026-09-13T20:25:00Z' }]).state, 'idle');
  assert.equal(c([]).state, 'idle');
  // Not a lookup: the module has no clock of its own.
  assert.doesNotMatch(strip(src('lib/live/cadence.js')), /Date\.now\(\)/);
});

test('the fast states poll at 30s and idle at 5 minutes', () => {
  assert.equal(cadence([{ status: 'live' }], NOW).sleepSec, LIVE_SEC);
  assert.equal(cadence([{ status: 'scheduled', kickoffAt: '2026-09-13T18:05:00Z' }], NOW).sleepSec, LIVE_SEC);
  assert.equal(cadence([], NOW).sleepSec, IDLE_SEC);
});

test('LIVE WINS OVER EVERYTHING - the states are not exclusive', () => {
  // A slate with one live game and twelve finals is live.
  const mixed = [
    { status: 'final', finalSeenAt: '2026-09-13T17:00:00Z' },
    { status: 'live' },
    { status: 'scheduled', kickoffAt: '2026-09-13T20:25:00Z' },
  ];
  const d = cadence(mixed, NOW);
  assert.equal(d.state, 'live');
  assert.equal(d.liveCount, 1);
});

test('the pre-kick window does not CLOSE at kickoff', () => {
  // A game whose start slipped is still the game we are waiting for, and the
  // provider is the only thing that can tell us it began.
  assert.equal(cadence([{ status: 'scheduled', kickoffAt: '2026-09-13T17:30:00Z' }], NOW).state, 'pre-kick');
});

test('an idle loop sleeps toward the next kickoff, but never blindly', () => {
  // The slate is read from our own table, which other writers change. A loop
  // that slept nine hours on one reading would act on a stale fact.
  const d = cadence([{ status: 'scheduled', kickoffAt: '2026-09-14T02:00:00Z' }], NOW);
  assert.equal(sleepUntilNext(d, NOW), 1800, 'clamped to the ceiling');
  const soon = cadence([{ status: 'scheduled', kickoffAt: '2026-09-13T18:20:00Z' }], NOW);
  assert.equal(sleepUntilNext(soon, NOW), 600, 'wakes when the pre-kick window opens');
  assert.equal(sleepUntilNext(cadence([{ status: 'live' }], NOW), NOW), 30, 'a live loop never defers');
});

// ---------------------------------------------------------------------------
// 5. THE SCORE EVENT
// ---------------------------------------------------------------------------

test('the headline reads like a scoreboard, away first', () => {
  assert.equal(scoreHeadline({
    awayAbbr: 'NE', awayScore: 10, homeAbbr: 'SEA', homeScore: 14,
    liveState: { period: 2, clock: '8:41' },
  }), 'NE 10, SEA 14 · Q2 8:41');
});

test('no clock, no qualifier - never half of one', () => {
  // BDL sends no period or clock on this endpoint, measured, so every NFL score
  // event takes this path.
  assert.equal(scoreHeadline({ awayAbbr: 'NE', awayScore: 10, homeAbbr: 'SEA', homeScore: 14 }),
    'NE 10, SEA 14');
  assert.equal(scoreHeadline({ awayAbbr: 'NE', awayScore: 10, homeAbbr: 'SEA', homeScore: 14,
    liveState: { period: 2, clock: null } }), 'NE 10, SEA 14');
  assert.equal(scoreHeadline({ awayAbbr: null, awayScore: 10, homeAbbr: 'SEA', homeScore: 14 }), null);
  // Number(null) is 0, NOT NaN - so a missing score would have rendered
  // "NE 0, SEA 14", a scoreline we invented, emitted to the Wire and deduped on
  // those very numbers so it could never be corrected. Both feeds leave the
  // score null for stretches of a live game, so this is the ordinary case.
  assert.equal(scoreHeadline({ awayAbbr: 'NE', awayScore: null, homeAbbr: 'SEA', homeScore: 14 }), null);
  assert.equal(scoreHeadline({ awayAbbr: 'NE', awayScore: undefined, homeAbbr: 'SEA', homeScore: 14 }), null);
  assert.equal(scoreHeadline({ awayAbbr: 'NE', awayScore: '', homeAbbr: 'SEA', homeScore: 14 }), null);
  // But a real 0-0 IS a scoreline and must render.
  assert.equal(scoreHeadline({ awayAbbr: 'NE', awayScore: 0, homeAbbr: 'SEA', homeScore: 0 }), 'NE 0, SEA 0');
});

test('ONE EVENT PER SCORE STATE - and the clock is NOT in the key', () => {
  // The clock moves every second. Keying on it would emit an event per poll for
  // a score that had not changed, which is the flood the key exists to prevent.
  const a = scoreEventKey(41, 14, 10);
  assert.equal(a, scoreEventKey(41, 14, 10), 'same state, same key');
  assert.notEqual(a, scoreEventKey(41, 21, 10), 'a score changes it');
  assert.notEqual(a, scoreEventKey(42, 14, 10), 'a different game changes it');
  const row = (ls) => toScoreRow({
    id: 41, slug: 'g', league_id: 1, league_slug: 'nfl', home_team_id: 2, away_team_id: 3,
    home_abbr: 'SEA', away_abbr: 'NE', home_score: 14, away_score: 10,
  }, ls);
  assert.equal(row({ period: 2, clock: '8:41' }).dedupe_hash, row({ period: 2, clock: '8:12' }).dedupe_hash,
    'the clock must not split one score into two events');
  assert.equal(row({ period: 2, clock: '8:41' }).lane, 'score');
});

// ---------------------------------------------------------------------------
// 6. THE QUOTA CAP
// ---------------------------------------------------------------------------

test('the cap degrades the cadence; it does not stop the loop', () => {
  // A poller that goes silent at the cap looks identical to one that died, and
  // the slate still needs finals written even at five minutes.
  const live = cadence([{ status: 'live' }], NOW);
  const capped = applyCap(live, DEFAULT_CAP.cfb, 'cfb');
  assert.equal(capped.capped, true);
  assert.equal(capped.sleepSec, 300);
  assert.equal(capped.state, 'live-capped', 'the ledger must be able to tell why');
  // Under the cap, untouched.
  assert.deepEqual(applyCap(live, 10, 'cfb'), live);
});

test('overCap is inclusive, and an unknown league has no cap', () => {
  assert.equal(overCap(1999, 'cfb'), false);
  assert.equal(overCap(2000, 'cfb'), true);
  assert.equal(overCap(9999, 'epl'), false, 'no cap configured, no cap applied');
});

test('THE COUNT IS PERSISTED, because Restart=always makes memory a liar', () => {
  // A crash loop with an in-process tally would spend a month of budget in an
  // afternoon and the cap would never see it.
  const q = strip(src('lib/live/quota.js'));
  assert.match(q, /INSERT INTO sync_runs/, 'the tally is written down');
  assert.match(q, /SUM\(\(summary->>'calls'\)::int\)/, 'and read back by summing');
  const unit = src('services/live-poller/systemd/sportsvyn-live-poller.service');
  assert.match(unit, /Restart=always/);
  assert.match(unit, /RestartSec=/, 'a fast crash loop must not become a fast request loop');
  assert.equal(utcDay(new Date('2026-09-13T23:59:00Z')), '2026-09-13');
});

// ---------------------------------------------------------------------------
// 7. THE LEDGER AND THE HEARTBEAT
// ---------------------------------------------------------------------------

test('ONE LEDGER ROW PER WINDOW, plus a heartbeat every five minutes', () => {
  // An unledgered poller is unauditable: with only window rows, a process that
  // died on a Tuesday and one correctly idle on a Tuesday write the same thing,
  // which is nothing.
  const t = strip(src('services/live-poller/index.mjs'));
  assert.match(t, /HEARTBEAT_MS = 5 \* 60 \* 1000/);
  assert.match(t, /async function heartbeat\(/);
  assert.match(t, /kind, started_at, finished_at, ok, summary[\s\S]{0,200}'heartbeat'/);
  // The window row opens once and closes once - not per poll.
  assert.match(t, /async function openWindow\(/);
  assert.match(t, /async function closeWindow\(/);
  assert.match(t, /ALERT_AFTER_FAILURES = 3/);
  assert.match(t, /failures >= ALERT_AFTER_FAILURES[\s\S]{0,300}maybeAlert/);
});

test('the latency instrument records what it can actually see', () => {
  // Neither provider sends an observation timestamp - measured on both
  // payloads - so quoting one would be an invention, and quoting the poll
  // interval and calling it latency would be worse.
  const t = strip(src('services/live-poller/poll.mjs'));
  assert.match(t, /out\.latencies\.push\(\{ matchId: m\.id, ourMs: Date\.now\(\) - fetchedAt \}\)/);
});

// ---------------------------------------------------------------------------
// 8. A SCHEDULED GAME HAS NO SCORE TO REPORT
// ---------------------------------------------------------------------------

test('CFBD SENDS points: 0 BEFORE KICKOFF, and it is not a score', () => {
  // Caught by the dry run against the real payload, not by reading the docs:
  // every scheduled row came back "0-0", and COALESCE treats 0 as a value - so
  // the poller would have put 0-0 on the scoreboard for unplayed games and
  // emitted a Wire event reading "ECU 0, ALA 0" for a game three days away,
  // deduped on those numbers and therefore uncorrectable.
  const row = { id: 1, status: 'scheduled', period: null, clock: null,
    homeTeam: { points: 0 }, awayTeam: { points: 0 } };
  const raw = fromCfbd(row, []);
  assert.equal(raw.homeScore, 0, 'the provider really does send zero');
  const scoped = scopeToStatus(raw);
  assert.equal(scoped.status, 'scheduled', 'the status still travels');
  assert.equal(scoped.homeScore, null, 'the score does not');
  assert.equal(scoped.awayScore, null);
  assert.equal(scoped.liveState, null);
});

test('a live or final row keeps everything it carries', () => {
  const live = { status: 'live', homeScore: 14, awayScore: 10, liveState: { period: 2, clock: '8:41' } };
  assert.deepEqual(scopeToStatus(live), live);
  const final = { status: 'final', homeScore: 24, awayScore: 17, liveState: null };
  assert.deepEqual(scopeToStatus(final), final);
  // A real 0-0 in a live game is a scoreline and survives.
  assert.equal(scopeToStatus({ status: 'live', homeScore: 0, awayScore: 0 }).homeScore, 0);
});

test('ONLY A LIVE GAME EMITS A SCORE EVENT', () => {
  // A final has its own emitter; a scheduled game has no score to report.
  const t = strip(src('services/live-poller/poll.mjs'));
  assert.match(t, /if \(upd\.status === 'live' && scoreChanged\(m, after\)\)/);
});

// ---------------------------------------------------------------------------
// 9. THE FCS RATIO — ruled, and it is arithmetic
// ---------------------------------------------------------------------------

test('FCS RIDES EVERY FOURTH POLL, and the ratio is what the cap allows', () => {
  // CFBD serves FBS by default; FCS is a SECOND call. Both at 30s is
  // 1,440 + 1,440 = 2,880 against a 2,000 cap - it does not fit, so it does not
  // run at that cadence. Every fourth poll gives FCS a two-minute cadence.
  assert.equal(FCS_EVERY_NTH_POLL, 4);
  const s = saturdayCalls();
  assert.equal(s.fbs, 1440);
  assert.equal(s.fcs, 360);
  assert.equal(s.total, 1800);
  assert.ok(s.total < DEFAULT_CAP.cfb, 'inside the cap, with slack for the heartbeat');
  // And the cadence it does NOT run at, stated so the number is on the record.
  assert.equal(saturdayCalls({ fcsNth: 1 }).total, 2880);
  assert.ok(saturdayCalls({ fcsNth: 1 }).total > DEFAULT_CAP.cfb);
});

test('the fourth-poll selector starts at the first poll of a window', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 8].map((i) => fcsThisPoll(i)), [true, false, false, false, true, true]);
  assert.equal(fcsThisPoll(-1), false);
  assert.equal(fcsThisPoll(1.5), false);
});

test('TIER-A IS STILL ITS OWN RELAY - nothing calls this yet', () => {
  // The ratio is pinned so the relay that lands FCS starts from the number the
  // budget allows rather than re-deriving it. If this assertion ever fails it
  // means FCS went live, and this test should be replaced by one that checks
  // the loop honours the ratio - not deleted.
  const loop = strip(src('services/live-poller/index.mjs'));
  const poll = strip(src('services/live-poller/poll.mjs'));
  assert.ok(!/fcsThisPoll|classification=fcs/.test(loop), 'the loop does not poll FCS yet');
  assert.match(poll, /classification=\$\{classification\}/, 'though the fetcher can already take it');
  assert.match(poll, /classification = null/, 'and defaults to FBS');
});
