// lib/push/gameAlerts.test.mjs — who gets told about a GAME, and how it cannot
// be told twice. Run: node --test lib/push/gameAlerts.test.mjs
//
// A SEPARATE FILE FROM push.test.mjs, WHICH ALREADY EXISTED AND WHICH I
// OVERWROTE. lib/push/ has held an APNs sender, a copy table and a
// claim-then-send notifier since migration 070; writing this file at that path
// destroyed 43 tests for a system I had not found. Restored from git. This one
// covers the GAME-ALERT layer only - prefs, transitions, the game payload -
// and the iOS transport it is NOT re-implementing lives in apns.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePrefs, wants, isCloseGame, clockToSeconds, eventKey, nextRow, DEFAULTS, OFF, COLUMN_OF, SELECT_FIELDS } from './prefs.js';
import { pushPayload, scoreKindLabel } from './payload.js';
import { transitionsFor } from './transitions.js';
import { summaryLine, pushPathFor } from './sheetRules.js';
import { GONE, isAuthFailure } from './senders.js';
import { apnsConfig, pushEnabled } from './apns.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (r) => readFileSync(path.join(REPO, r), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const GAME = { homeAbbr: 'SEA', awayAbbr: 'NE', leagueSlug: 'nfl', slug: 'ne-at-sea' };

// ---------------------------------------------------------------------------
// 1. PREF RESOLUTION — team default, match override
// ---------------------------------------------------------------------------

test('a follower who never opened the sheet gets the shipped defaults', () => {
  const p = resolvePrefs({});
  assert.equal(p.source, 'default');
  assert.equal(p.score, true);
  assert.equal(p.quarter, false, 'quarter is off by default - it is the noisiest row');
  assert.equal(p.final, true, 'the final is a trigger, on by default (R2)');
});

test('a match-scope read with no saved row anywhere renders OFF, not the shipped defaults', () => {
  // RELAY - GAME ALERTS FIX ruling: "the screen may never show a push the
  // system will not attempt." audienceFor()'s match-scoped entry point
  // requires an actual saved row to be a candidate at all, so a caller with
  // scope: 'match' and no saved row must not show master:true.
  const p = resolvePrefs({ scope: 'match' });
  assert.equal(p.source, 'default');
  assert.equal(p.master, false);
  assert.equal(p.score, false);
  assert.equal(p.kickoff, false);
  assert.equal(p.close, false);
});

test('scope: match still yields the team row, unshadowed, when one is saved', () => {
  const p = resolvePrefs({ teamPref: { master: true, score: false }, scope: 'match' });
  assert.equal(p.source, 'team');
  assert.equal(p.score, false);
});

test('dispatch\'s own resolvePrefs() call (no scope arg) is unchanged - a follower with nothing saved still defaults ON', () => {
  const p = resolvePrefs({});
  assert.equal(p.source, 'default');
  assert.equal(p.master, true, 'a real team-follower with no saved row must still default ON');
});

test('a team pref is the default for every game of that team', () => {
  const p = resolvePrefs({ teamPref: { master: true, score: false, quarter: true } });
  assert.equal(p.source, 'team');
  assert.equal(p.score, false);
  assert.equal(p.quarter, true);
});

test('A MATCH ROW OVERRIDES WHOLE, NOT FIELD BY FIELD', () => {
  // The override is the row's PRESENCE. A reader who silenced scores for one
  // game must not have them turned back on by a team default they set in March
  // - which is exactly what a field-by-field merge would do.
  const p = resolvePrefs({
    teamPref: { master: true, score: true, quarter: true, close: true },
    matchPref: { master: true, score: false },
  });
  assert.equal(p.source, 'match');
  assert.equal(p.score, false, 'the match row wins');
  assert.equal(p.quarter, DEFAULTS.quarter, 'and the team row does NOT leak through');
  assert.notEqual(p.quarter, true);
});

test('MASTER GATES, and it is not a sixth toggle', () => {
  // master=false with score=true is a coherent stored state: the reader
  // silenced the game without losing what they had chosen.
  const off = { ...DEFAULTS, master: false, score: true };
  for (const e of ['kickoff', 'score', 'quarter', 'close', 'final']) {
    assert.equal(wants(off, e), false, `${e} must not fire with master off`);
  }
  assert.equal(wants({ ...off, master: true }, 'score'), true, 'and it all comes back');
});

test('FINAL IS A TRIGGER, NOT A SUPPRESSOR (ALERTS SHEET relay, R2) - the wants() matrix', () => {
  // Five flags, five events, one rule each. No flag silences another.
  const EV = ['kickoff', 'score', 'quarter', 'close', 'final'];
  for (const on of EV) {
    const p = { master: true, kickoff: false, score: false, quarter: false, close: false, final: false, [on]: true };
    for (const e of EV) assert.equal(wants(p, e), e === on, `${on} on -> ${e} ${e === on ? 'sends' : 'stays quiet'}`);
  }
  const all = { master: true, kickoff: true, score: true, quarter: true, close: true, final: true };
  for (const e of EV) assert.equal(wants(all, e), true, `${e} with everything on`);
  // The old suppressor: final on, score on used to mean "score stays quiet".
  // It now means both send (R4 - legacy rows send what their flags say).
  assert.equal(wants({ ...DEFAULTS, final: true, score: true }, 'score'), true);
  assert.equal(wants({ ...DEFAULTS, final: true, score: true }, 'final'), true);
  // And the final can be turned OFF like anything else.
  assert.equal(wants({ ...DEFAULTS, final: false }, 'final'), false, 'final off -> no final');
  assert.equal(wants({ ...DEFAULTS, final: false }, 'score'), true, '...and the rest still send');
  // Nothing reads final_only any more: a stale key is ignored, not obeyed.
  assert.equal(wants({ ...DEFAULTS, final_only: true }, 'score'), true, 'a leftover final_only key suppresses nothing');
  assert.equal(wants({ ...OFF, master: true, final_only: true }, 'final'), false, 'and it does not select the final either');
});

test('THE final TRIGGER RIDES THE final_only COLUMN - reused, not migrated', () => {
  // R2: keep the column, rename the semantics in code. Every row that had
  // final_only=true was a reader who wanted the final; that is what the bit
  // now says, so no data moves and the ten PROD rows keep sending finals.
  assert.equal(COLUMN_OF.final, 'final_only');
  for (const k of ['master', 'kickoff', 'score', 'quarter', 'close']) assert.equal(COLUMN_OF[k], k);
  assert.equal(SELECT_FIELDS, 'master, kickoff, score, quarter, close, final_only AS final');
  // The two SQL edges are the only readers of the column name.
  const disp = strip(src('lib/push/dispatch.js'));
  assert.match(disp, /final: r\.t_final_only/); assert.match(disp, /final: r\.m_final_only/);
  assert.doesNotMatch(disp, /final_only: r\./);
  const route = strip(src('app/api/push/prefs/route.js'));
  assert.match(route, /\$\{v\.final\}\)/, 'the INSERT writes v.final into final_only');
  assert.doesNotMatch(route, /v\.final_only/);
  assert.match(route, /sql\.unsafe\(SELECT_FIELDS\)/);
  // A LEGACY ROW: final_only true, score true - sends the score AND the final (R4).
  const legacy = resolvePrefs({ matchPref: { master: true, kickoff: false, score: true, quarter: false, close: false, final: true } });
  assert.equal(wants(legacy, 'score'), true); assert.equal(wants(legacy, 'final'), true);
  assert.equal(wants(legacy, 'kickoff'), false);
  // And the two PROD rows with every other trigger false: the final, nothing else.
  const finalOnly = resolvePrefs({ matchPref: { master: true, kickoff: false, score: false, quarter: false, close: false, final: true } });
  for (const e of ['kickoff', 'score', 'quarter', 'close']) assert.equal(wants(finalOnly, e), false, e);
  assert.equal(wants(finalOnly, 'final'), true);
});

test('THE FINAL HAS ITS OWN FLAG, independent of quarter', () => {
  // It used to ride `quarter`, so the DEFAULT pref set - quarter:false -
  // silently withheld the result of the game. 20729 on 5 Sep got sixteen
  // score alerts and no final because of exactly this.
  assert.equal(DEFAULTS.quarter, false, 'the default really does have quarter off');
  assert.equal(DEFAULTS.final, true, 'and the final on');
  assert.equal(wants(DEFAULTS, 'final'), true, 'default prefs -> the final SENDS');
  assert.equal(wants({ ...DEFAULTS, quarter: false }, 'final'), true, 'quarter off -> final still sends');
  assert.equal(wants({ ...DEFAULTS, quarter: true }, 'final'), true, 'quarter on -> final sends');
});

test('QUARTER GOVERNS QUARTER ENDS ONLY, now that the final has its own rule', () => {
  assert.equal(wants({ ...DEFAULTS, quarter: false }, 'quarter'), false);
  assert.equal(wants({ ...DEFAULTS, quarter: true }, 'quarter'), true);
});

test('MASTER OFF STILL SILENCES EVERYTHING, the final included', () => {
  // The one thing that must not leak from routing the final on master: an
  // account that muted the game hears nothing at all.
  const off = { ...DEFAULTS, master: false };
  for (const e of ['kickoff', 'score', 'quarter', 'close', 'final']) {
    assert.equal(wants(off, e), false, `${e} must not fire with master off`);
  }
});

// ---------------------------------------------------------------------------
// 2. THE CLOSE-GAME RULE
// ---------------------------------------------------------------------------

test('close = Q4, one score apart, under five minutes - all three', () => {
  const base = { period: 4, clock: '4:59', homeScore: 21, awayScore: 14 };
  assert.equal(isCloseGame(base), true);
  assert.equal(isCloseGame({ ...base, period: 3 }), false, 'Q3 is not Q4');
  assert.equal(isCloseGame({ ...base, clock: '5:01' }), false, 'over five minutes');
  assert.equal(isCloseGame({ ...base, homeScore: 23 }), false, 'nine points is two scores');
  assert.equal(isCloseGame({ ...base, homeScore: 22 }), true, 'eight is one score - TD plus two');
  assert.equal(isCloseGame({ ...base, clock: null }), false);
  assert.equal(isCloseGame({ ...base, homeScore: null }), false);
});

test('the clock parses, and refuses nonsense', () => {
  assert.equal(clockToSeconds('4:59'), 299);
  assert.equal(clockToSeconds('15:00'), 900);
  assert.equal(clockToSeconds('0:03'), 3);
  assert.equal(clockToSeconds('4:99'), null);
  assert.equal(clockToSeconds('Q4'), null);
  assert.equal(clockToSeconds(null), null);
});

test('CLOSE FIRES ONCE PER GAME - the key names the game, not the clock', () => {
  // Keying on the clock would send one every thirty seconds for the last five
  // minutes of every one-score game.
  assert.equal(eventKey('close', 41, { period: 4, clock: '4:59' }), 'close:41');
  assert.equal(eventKey('close', 41, { period: 4, clock: '0:12' }), 'close:41');
  // And it only fires on ENTERING the window, not on every poll inside it.
  const inWindow = { status: 'live', home_score: 21, away_score: 14, live_state: { period: 4, clock: '4:30' } };
  const alsoIn = { status: 'live', home_score: 21, away_score: 14, live_state: { period: 4, clock: '4:00' } };
  assert.equal(transitionsFor(inWindow, alsoIn).some((t) => t.event === 'close'), false);
  const before = { status: 'live', home_score: 21, away_score: 14, live_state: { period: 4, clock: '5:30' } };
  assert.equal(transitionsFor(before, inWindow).some((t) => t.event === 'close'), true);
});

// ---------------------------------------------------------------------------
// 3. DEDUPE
// ---------------------------------------------------------------------------

test('THE EVENT KEY NAMES A STATE, so the next poll collides', () => {
  assert.equal(eventKey('score', 41, { homeScore: 14, awayScore: 10 }), 'score:41:14:10');
  assert.equal(eventKey('score', 41, { homeScore: 14, awayScore: 10 }),
    eventKey('score', 41, { homeScore: 14, awayScore: 10 }));
  assert.notEqual(eventKey('score', 41, { homeScore: 21, awayScore: 10 }),
    eventKey('score', 41, { homeScore: 14, awayScore: 10 }));
  assert.equal(eventKey('kickoff', 41), 'kickoff:41');
  assert.equal(eventKey('final', 41), 'final:41');
  assert.equal(eventKey('quarter', 41, { period: 2 }), 'quarter:41:2');
  assert.equal(eventKey('nonsense', 41), null);
});

test('A RESTART CANNOT DOUBLE-SEND - the dedupe is an index, not a memory', () => {
  // systemd restarts this process by design. A dispatcher remembering its
  // sends in memory would re-notify every in-flight game on every crash.
  const m = src('migrations/082_push_alerts.sql');
  assert.match(m, /CREATE UNIQUE INDEX IF NOT EXISTS push_sends_once\s*\n?\s*ON push_sends \(device_token, event_key\)/);
  const d = strip(src('lib/push/dispatch.js'));
  assert.match(d, /ON CONFLICT \(device_token, event_key\) DO NOTHING/);
  // CLAIM BEFORE SEND. A crash between the two loses one notification; the
  // other order sends twice on every crash, and only one of those is
  // recoverable - by the next event thirty seconds later.
  assert.ok(d.indexOf('INSERT INTO push_sends') < d.indexOf('await fn(d, payload)')
    || d.indexOf('INSERT INTO push_sends') < d.indexOf('send[d.platform]'),
    'the row must be claimed before the send');
});

// ---------------------------------------------------------------------------
// 4. TRANSITIONS
// ---------------------------------------------------------------------------

test('kickoff is the status flip, not the clock', () => {
  const t = transitionsFor({ status: 'scheduled' }, { status: 'live', home_score: 0, away_score: 0 });
  assert.deepEqual(t.map((x) => x.event), ['kickoff']);
  assert.equal(transitionsFor({ status: 'live' }, { status: 'live' }).length, 0);
});

test('A KICKOFF DOES NOT ALSO FIRE "NE 0, SEA 0"', () => {
  // On the poll that flips a game live, the stored score goes from null to
  // 0-0 - which IS a change by any honest comparison. Without the
  // already-live requirement the reader got a kickoff alert followed
  // immediately by a scoreline for a game where nobody had scored: two
  // notifications for one moment. A score arriving on the same poll as the
  // kickoff IS the kickoff.
  const t = transitionsFor({ status: 'scheduled', home_score: null, away_score: null },
    { status: 'live', home_score: 0, away_score: 0 });
  assert.deepEqual(t.map((x) => x.event), ['kickoff']);
  // And a real score on the NEXT poll still fires.
  const t2 = transitionsFor({ status: 'live', home_score: 0, away_score: 0 },
    { status: 'live', home_score: 7, away_score: 0 });
  assert.deepEqual(t2.map((x) => x.event), ['score']);
});

test('a score fires only while live, and only when it moved', () => {
  const live = (h, a, ls) => ({ status: 'live', home_score: h, away_score: a, live_state: ls });
  assert.deepEqual(transitionsFor(live(7, 0), live(14, 0)).map((x) => x.event), ['score']);
  assert.deepEqual(transitionsFor(live(7, 0), live(7, 0)).map((x) => x.event), []);
  // A final's points are the final's news, not a score alert.
  const t = transitionsFor(live(21, 17), { status: 'final', home_score: 24, away_score: 17 });
  assert.deepEqual(t.map((x) => x.event), ['final']);
});

test('the quarter fires on the period advancing, not on a clock hitting zero', () => {
  // A poll every thirty seconds will usually miss 0:00 and would then never
  // fire at all.
  const a = { status: 'live', home_score: 7, away_score: 0, live_state: { period: 1, clock: '0:20' } };
  const b = { status: 'live', home_score: 7, away_score: 0, live_state: { period: 2, clock: '15:00' } };
  const t = transitionsFor(a, b);
  assert.deepEqual(t.map((x) => x.event), ['quarter']);
  assert.equal(t[0].state.period, 1, 'it names the quarter that ENDED');
});

test('FINAL COMES LAST when one poll sees the score and the whistle', () => {
  const t = transitionsFor(
    { status: 'live', home_score: 21, away_score: 17, live_state: { period: 4, clock: '0:30' } },
    { status: 'final', home_score: 24, away_score: 17 });
  assert.equal(t[t.length - 1].event, 'final');
});

// ---------------------------------------------------------------------------
// 5. PAYLOAD GRAMMAR
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// THE SCORE-KIND PREFIX - every delta, both branches of the 2-point/safety
// ambiguity.
// ---------------------------------------------------------------------------

test('scoreKindLabel names the TEAM whose score moved, not a bare word - "SYR touchdown"', () => {
  assert.equal(scoreKindLabel(6, { teamAbbr: 'SYR' }), 'SYR touchdown');
  assert.equal(scoreKindLabel(7, { teamAbbr: 'SYR' }), 'SYR touchdown');
  assert.equal(scoreKindLabel(8, { teamAbbr: 'SYR' }), 'SYR touchdown');
  assert.equal(scoreKindLabel(3, { teamAbbr: 'ALA' }), 'ALA field goal');
  assert.equal(scoreKindLabel(1, { teamAbbr: 'ALA' }), 'ALA extra point');
});

test('without a teamAbbr (a caller testing the kind alone) it falls back to the bare word', () => {
  assert.equal(scoreKindLabel(6), 'touchdown');
  assert.equal(scoreKindLabel(3), 'field goal');
  assert.equal(scoreKindLabel(1), 'extra point');
});

test('a delta of 2 is a safety unless this team\'s last score was itself a touchdown', () => {
  assert.equal(scoreKindLabel(2, { teamAbbr: 'SYR' }), 'SYR safety');
  assert.equal(scoreKindLabel(2, { teamAbbr: 'SYR', priorWasTouchdown: false }), 'SYR safety');
  assert.equal(scoreKindLabel(2, { teamAbbr: 'SYR', priorWasTouchdown: true }), 'SYR two-point');
});

test('anything else gets no prefix - no name beats a guess', () => {
  for (const d of [0, 4, 5, 9, 10, -3, -7, null, undefined]) {
    assert.equal(scoreKindLabel(d, { teamAbbr: 'SYR' }), null, `delta ${d}`);
  }
});

test('the prefix rides the title only for a real "score" event with a real scoreline', () => {
  const withKind = pushPayload('score', { ...GAME, homeScore: 14, awayScore: 10, scoreKind: 'SEA touchdown' });
  assert.equal(withKind.title, 'SEA touchdown · NE 10, SEA 14');
  // Never on a different event, even if a caller mistakenly passed one.
  const wrongEvent = pushPayload('quarter', { ...GAME, homeScore: 14, awayScore: 10, period: 2, scoreKind: 'SEA touchdown' });
  assert.equal(wrongEvent.title, 'NE 10, SEA 14');
  // Never invented when the scores themselves are missing.
  const noScore = pushPayload('score', { ...GAME, homeScore: null, awayScore: null, scoreKind: 'SEA touchdown' });
  assert.equal(noScore.title, 'NE at SEA');
  // No scoreKind at all - the old, unprefixed title, unchanged.
  const plain = pushPayload('score', { ...GAME, homeScore: 14, awayScore: 10 });
  assert.equal(plain.title, 'NE 10, SEA 14');
});

test('THE SCORE IS THE TITLE, the state is the body', () => {
  const p = pushPayload('score', { ...GAME, homeScore: 14, awayScore: 10, period: 2, clock: '8:41', network: 'NBC' });
  assert.equal(p.title, 'NE 10, SEA 14');
  assert.equal(p.body, 'Q2 8:41 · NBC');
  assert.equal(p.url, '/nfl/game/ne-at-sea');
});

test('one notification per game on the shade, replaced not stacked', () => {
  const a = pushPayload('score', { ...GAME, homeScore: 14, awayScore: 10 });
  const b = pushPayload('score', { ...GAME, homeScore: 21, awayScore: 10 });
  assert.equal(a.tag, b.tag, 'same game, same tag - the newest replaces');
  assert.match(a.tag, /^sv-game-/);
});

test('a missing score never becomes a zero', () => {
  // Number(null) is 0, so the naive check would print "NE 0, SEA 14" - a
  // scoreline we invented, on a lock screen.
  const p = pushPayload('kickoff', { ...GAME, homeScore: null, awayScore: null });
  assert.equal(p.title, 'NE at SEA');
  assert.equal(p.body, 'Kickoff');
  // A real 0-0 still renders.
  assert.equal(pushPayload('score', { ...GAME, homeScore: 0, awayScore: 0 }).title, 'NE 0, SEA 0');
});

test('absent state is dropped whole, never rendered as a placeholder', () => {
  const p = pushPayload('score', { ...GAME, homeScore: 14, awayScore: 10 });
  assert.equal(p.body, null, 'no clock, no network, no body - not "Q · "');
  assert.equal(pushPayload('final', { ...GAME, homeScore: 24, awayScore: 17 }).body, 'Final');
  assert.equal(pushPayload('close', { ...GAME, homeScore: 21, awayScore: 14 }).body,
    'One score, under five minutes');
});

test('NO "INSTANT" ANYWHERE, and hyphens only', () => {
  // Instant is a promise nobody can keep about a thirty-second poll on a feed
  // with its own lag.
  for (const f of ['lib/push/payload.js', 'components/alerts/AlertBell.js',
                   'components/alerts/subscribe.js', 'components/alerts/alerts.css']) {
    const t = strip(src(f));
    assert.doesNotMatch(t, /instant/i, `${f} must not say instant`);
    assert.doesNotMatch(t, /[–—]/, `${f} must use hyphens only`);
  }
});

// ---------------------------------------------------------------------------
// 6. SENDERS AND REVOCATION
// ---------------------------------------------------------------------------

test('404 AND 410 BOTH MEAN GONE', () => {
  // Web push returns 410 for expired and 404 for never-existed; treating only
  // 410 as gone leaves dead rows collecting a send attempt per event forever.
  assert.equal(GONE.has(410), true);
  assert.equal(GONE.has(404), true);
  assert.equal(GONE.has(500), false);
  assert.equal(GONE.has(429), false, 'rate limiting is not death');
});

test('ONE DEVICE TABLE, ONE REVOCATION PATH', () => {
  // RULED after the recon miss: device_tokens (070) grows three nullable
  // columns rather than a second table appearing beside it. Two device tables
  // means two revocation paths, two fan-outs, and a device that appears twice
  // the day somebody runs the same browser and the app.
  const d = strip(src('lib/push/dispatch.js'));
  assert.match(d, /JOIN device_tokens d/);
  assert.doesNotMatch(d, /push_devices/, 'the second table is gone');
  // Revoked, not deleted - 070's decision, unchanged. A dead endpoint is not a
  // withdrawn consent, and revoked_at is the only evidence of which it was.
  assert.match(d, /UPDATE device_tokens SET revoked_at = now\(\)/);
  assert.doesNotMatch(d, /DELETE FROM device_tokens/);
  const m = src('migrations/082_push_alerts.sql');
  assert.doesNotMatch(m, /CREATE TABLE[^;]*push_devices/);
  assert.match(m, /ALTER TABLE device_tokens ADD COLUMN IF NOT EXISTS endpoint/);
  // The CHECK is what keeps "nullable" from meaning "optional" - enforced by
  // the database, not by whichever writer happens to be careful.
  assert.match(m, /device_tokens_platform_shape/);
  assert.match(m, /platform = 'web' AND endpoint IS NOT NULL AND p256dh IS NOT NULL AND auth IS NOT NULL/);
});

test('a web row travels 070\'s paths: the endpoint is written to token too', () => {
  // token is the primary key every existing revoke, revive and fan-out query
  // joins on. Writing the endpoint into both is what lets a web row use them
  // instead of needing a parallel set.
  const r = strip(src('app/api/push/subscribe/route.js'));
  assert.match(r, /INSERT INTO device_tokens \(token, user_id, platform, endpoint, p256dh, auth, user_agent\)/);
  assert.match(r, /VALUES \(\$\{endpoint\}, \$\{userId\}, 'web', \$\{endpoint\}/);
  // Revive-in-place, exactly as /api/push/register does it.
  assert.match(r, /ON CONFLICT \(token\) DO UPDATE/);
  assert.match(r, /revoked_at = NULL/);
});

test('auth failure is a configuration problem and alerts', () => {
  assert.equal(isAuthFailure({ ok: false, status: 403 }), true);
  assert.equal(isAuthFailure({ ok: false, status: 401 }), true);
  assert.equal(isAuthFailure({ ok: false, status: 0, error: 'VAPID keys missing in env' }), true);
  assert.equal(isAuthFailure({ ok: false, status: 500 }), false, 'a server error is not auth');
  assert.equal(isAuthFailure({ ok: true, status: 201 }), false);
});

test('THE iOS TRANSPORT IS NOT RE-IMPLEMENTED - apns.js already had it', () => {
  // The relay asked for an APNs sender built from the .p8 with token auth. It
  // has existed since migration 070: apns.js does the ES256 JWT with its own
  // cache, an http2 client with a timeout guard, gone-detection and a
  // PUSH_ENABLED gate, and notify.js already claims before it sends. Shipping
  // a second one would have meant two things to configure, two gates to arm
  // and two places for a dead token to be revoked.
  const t = strip(src('lib/push/senders.js'));
  assert.match(t, /await import\('\.\/apns\.js'\)/, 'the ios sender adapts the existing module');
  assert.doesNotMatch(t, /alg: 'ES256'/, 'and does not mint its own token');
  assert.doesNotMatch(t, /http2/, 'nor open its own connection');
  // The existing gate still governs: no PUSH_ENABLED, no ios send.
  assert.equal(pushEnabled({}), false);
  assert.equal(apnsConfig({}).enabled, false);
});

// ---------------------------------------------------------------------------
// 7. THE UI
// ---------------------------------------------------------------------------

test('THE SHEET SHIPS NO MARKUP UNTIL IT OPENS', () => {
  // A scoreboard draws sixteen pills; it must not ship sixteen settings panels
  // to do it.
  const t = strip(src('components/alerts/AlertBell.js'));
  assert.match(t, /\{open \? \(/, 'the sheet is behind the open gate');
  const trigger = t.slice(0, t.indexOf('{open ? ('));
  assert.ok(!/role="dialog"/.test(trigger), 'nothing dialog-shaped before the gate');
  assert.ok(!/al-sheet/.test(trigger));
});

test('THE PROMPT ONLY EVER FOLLOWS A TAP', () => {
  // A browser prompt the reader did not ask for is the fastest way to a
  // permanent denial, and denied is not recoverable from the page.
  const bell = strip(src('components/alerts/AlertBell.js'));
  const sub = strip(src('components/alerts/subscribe.js'));
  assert.match(sub, /Notification\.requestPermission\(\)/);
  // It lives in subscribeThisBrowser, which the bell calls ONLY from save().
  assert.doesNotMatch(bell, /requestPermission/);
  // The bell now calls enableAlerts, which picks the transport; the claim is
  // unchanged - the prompt happens inside save(), which only a tap reaches.
  assert.match(bell, /const save = async \(next, rowKey\) => \{[\s\S]{0,900}await enableAlerts\(\)/);
  // And never from an effect.
  const effects = bell.match(/useEffect\([\s\S]*?\}, \[[^\]]*\]\);/g) ?? [];
  for (const e of effects) assert.ok(!/enableAlerts|subscribeThisBrowser/.test(e), 'never on mount or open');
});

test('the bell claims knowledge: it lights from prefs, not from hope', () => {
  const t = strip(src('components/alerts/AlertBell.js'));
  assert.match(t, /const anyOn = Boolean\(prefs && p\.master/);
  assert.match(t, /className=\{`al-pill\$\{anyOn \? ' on' : ''\}/);
  // ON is stated three ways, because a colour alone is not a state every
  // reader can read.
  const css = src('components/alerts/alerts.css');
  assert.match(css, /\.al-pill\.on \{ color: var\(--volt\); border-color: var\(--volt\); \}/);
  assert.match(t, /anyOn \? <span aria-hidden="true">● <\/span> : null/);
});

test('the pill is a 99px outline capsule, right-aligned in the foot', () => {
  const css = src('components/alerts/alerts.css');
  const pill = css.slice(css.indexOf('.al-pill {'), css.indexOf('.al-pill:hover'));
  assert.match(pill, /border-radius: 99px/);
  assert.match(pill, /background: transparent/, 'outline, not filled');
  assert.match(pill, /margin-left: auto/, 'right-aligned in the card foot');
  assert.match(pill, /font-family: var\(--font-saira-cond\)/);
  assert.match(pill, /font-size: 10px; font-weight: 600; letter-spacing: 0\.10em/);
  assert.match(pill, /text-transform: uppercase/);
});

test('the toggle is 44x26 and the master dims rather than hides', () => {
  const css = src('components/alerts/alerts.css');
  const tg = css.slice(css.indexOf('.al-tg {'), css.indexOf('.al-tg:disabled'));
  assert.match(tg, /width: 44px; height: 26px/);
  assert.match(css, /\.al-dim \{ opacity: 0\.4; \}/);
  // Dimmed rows keep their state, so the reader can see what comes back.
  const bell = strip(src('components/alerts/AlertBell.js'));
  assert.match(bell, /al-rows\$\{p\.master \? '' : ' al-dim'\}/);
  assert.doesNotMatch(bell, /p\.master \? \([\s\S]{0,40}ROWS\.map/, 'the rows are dimmed, not unmounted');
});

test('signed out, the sheet offers a sign-in instead of the rows', () => {
  const t = strip(src('components/alerts/AlertBell.js'));
  assert.match(t, /\{!signedIn \? \(/);
  assert.match(t, /Sign in to get alerts/);
  const out = t.slice(t.indexOf('{!signedIn ? ('), t.indexOf(') : ('));
  assert.ok(!/ROWS\.map/.test(out), 'no toggles for a reader who cannot own them');
});

test('the bell does not open the card underneath it', () => {
  // The whole card is the expand control; a reader reaching for Alerts must
  // not also open the line score.
  assert.match(strip(src('components/alerts/AlertBell.js')), /onClick=\{\(e\) => \{ e\.stopPropagation\(\); setOpen\(true\); \}\}/);
});

test('NO BELL ON THE SOCCER CARD, and the reason is on the record', () => {
  // The alert vocabulary is gridiron - quarters, a close rule in Q4 and eight
  // points. A sheet offering "End of each quarter" on a football match would
  // be worse than no bell.
  const t = src('components/gridiron/Scoreboard.js');
  const soccer = t.slice(t.indexOf('function SoccerCard'), t.indexOf('function Section'));
  assert.ok(!/AlertBell/.test(soccer));
  assert.match(t, /NO BELL ON THE SOCCER CARD THIS RELAY/);
});

// ---------------------------------------------------------------------------
// 8. THE SERVICE WORKER
// ---------------------------------------------------------------------------

test('the service worker handles push and clicks, and caches nothing', () => {
  // A service worker that caches can serve a stale scoreboard, which is worse
  // than a slow one.
  const t = strip(src('public/sw.js'));
  assert.match(t, /addEventListener\('push'/);
  assert.match(t, /addEventListener\('notificationclick'/);
  assert.doesNotMatch(t, /caches\.|cache\.match|CacheStorage/, 'no caching');
  // Focus an open tab rather than opening a second one.
  assert.match(t, /clients\.matchAll/);
});

test('THE BELL IS ON BOTH SURFACES, AND ON BOTH CODES\' GAME PAGES', () => {
  // Item 4b: the card foot and the game page header. One control for one idea -
  // a reader who set alerts from the scoreboard opens the same sheet on the
  // game page and sees the state they left.
  assert.match(strip(src('components/gridiron/Scoreboard.js')),
    /<AlertBell match=\{alertMatch\(g\)\} signedIn=\{signedIn\} \/>/);
  for (const f of ['app/nfl/game/[slug]/page.js', 'app/cfb/game/[slug]/page.js']) {
    const t = strip(src(f));
    assert.match(t, /import AlertBell from '@\/components\/alerts\/AlertBell'/, f);
    assert.match(t, /<AlertBell compact=\{false\} signedIn=\{viewerId != null\}/, f);
    // The page stays open to everyone; the viewer is resolved for the sheet,
    // not for a gate.
    assert.match(t, /const viewerId = \(await auth\(\)\.catch/, f);
    assert.doesNotMatch(t, /requireSignInInShell/, `${f} must not gain a gate`);
  }
});

// ---------------------------------------------------------------------------
// 9. THE SHEET IN THE SHELL — one sheet, two transports
// ---------------------------------------------------------------------------

test('THE PATH IS CHOSEN FROM THE ENVIRONMENT, not attempted in turn', () => {
  assert.equal(pushPathFor({ cookie: 'sv_shell=sim-app' }), 'native');
  assert.equal(pushPathFor({ cookie: '', capacitor: true }), 'native',
    'a webview without the cookie is still a webview');
  assert.equal(pushPathFor({ cookie: 'theme=dark' }), 'web');
  assert.equal(pushPathFor({}), 'web');
  // The cookie is read through the SAME predicate the tab bar and the chrome
  // use. A second answer to "am I in the container" is how the two drift.
  assert.match(strip(src('lib/push/sheetRules.js')),
    /import \{ isShellClient \} from '\.\.\/shell\/appTabs\.js'/);
});

test('THE SHELL NEVER TOUCHES WEB PUSH, AND THE BROWSER NEVER TOUCHES THE PLUGIN', () => {
  const t = strip(src('components/alerts/enable.js'));
  // Web returns before the native import is even reached.
  const i = t.indexOf("if (path === 'web') return");
  const j = t.indexOf("await import('@/lib/push/client')");
  assert.ok(i > -1 && j > -1 && i < j, 'the web path returns before the plugin is imported');
  // And the native path never calls the browser subscriber.
  const nativeHalf = t.slice(i + 40);
  assert.ok(!/subscribeThisBrowser/.test(nativeHalf), 'the native path must not reach for web push');
  // The bell calls ONE function; it does not branch on the environment itself.
  const bell = strip(src('components/alerts/AlertBell.js'));
  assert.match(bell, /await enableAlerts\(\)/);
  assert.doesNotMatch(bell, /subscribeThisBrowser|pushPlugin|Capacitor/,
    'the sheet asks enableAlerts and does not know which transport answered');
});

test('THE WEB REFUSAL MESSAGE CAN NEVER RENDER IN THE SHELL', () => {
  // "On iPhone, add Sportsvyn to your Home Screen first" is true advice for
  // Safari and nonsense inside an app the reader already installed - it would
  // read as the app telling them to install the app. Choosing the path first
  // is what makes it unreachable; a try-web-then-fall-back would have shown it
  // every single time.
  const sub = strip(src('components/alerts/subscribe.js'));
  assert.match(sub, /Home Screen/, 'the message exists for the browser');
  const enable = strip(src('components/alerts/enable.js'));
  const nativeHalf = enable.slice(enable.indexOf("if (path === 'web') return"));
  assert.doesNotMatch(nativeHalf, /Home Screen/);
  // What the shell says instead, in plain words, for the two things that can
  // actually be wrong there.
  assert.match(enable, /Updating Draftvyn will fix it/);
  assert.match(enable, /iPhone Settings > Notifications > Draftvyn/);
  assert.doesNotMatch(enable, /unsupported|not supported/i, 'never "unsupported" - it reads as broken');
});

test('a denied native permission is reported, not silently retried', () => {
  // iOS makes a second request from 'denied' a silent no-op, so the only
  // honest thing to say is where the switch actually is.
  const t = strip(src('components/alerts/enable.js'));
  assert.match(t, /if \(result === 'denied'\)/);
  assert.match(t, /Notifications are off for Draftvyn/);
});

// ---------------------------------------------------------------------------
// 10. FINAL ONLY, AND SAVE STATE
// ---------------------------------------------------------------------------

test('R1: A FRESH MASTER TAP WRITES THE DEFAULTS ROW; master off keeps the triggers', () => {
  // nextRow() is the route's rule AND the sheet's optimistic row, one function.
  const fresh = nextRow(null, { ...OFF, master: true });
  assert.deepEqual(fresh, { master: true, kickoff: true, score: true, quarter: false, close: true, final: true });
  assert.deepEqual(fresh, { ...DEFAULTS }, 'master ON with no saved row -> the DEFAULTS row, not the OFF flags on screen');
  // master ON with a saved row -> the body, whole.
  const saved = { master: false, kickoff: false, score: true, quarter: true, close: false, final: false };
  assert.deepEqual(nextRow(saved, { ...saved, master: true }), { ...saved, master: true });
  // master OFF with a saved row -> master false, the triggers untouched even if the body lies.
  assert.deepEqual(nextRow({ ...saved, master: true }, { ...OFF }), saved);
  // master OFF with no saved row -> master false with the body's triggers (a team row showing through).
  assert.deepEqual(nextRow(null, { master: false, kickoff: true, score: false, quarter: false, close: true, final: true }),
    { master: false, kickoff: true, score: false, quarter: false, close: true, final: true });
  // A null field takes its default; a stray key is not written.
  assert.deepEqual(nextRow({ ...DEFAULTS }, { master: true, final_only: false }), { ...DEFAULTS });
  // The route fetches the row for THIS scope and hands it to nextRow.
  const route = strip(src('app/api/push/prefs/route.js'));
  assert.match(route, /WHERE user_id = \$\{userId\} AND scope = \$\{scope\} AND scope_id = \$\{Number\(scopeId\)\}`;\s*const v = nextRow\(existing \?\? null, body\);/);
  // And the sheet: the saved match row is the one whose source is 'match'.
  const t = strip(src('components/alerts/AlertBell.js'));
  assert.match(t, /const row = nextRow\(prefs\?\.source === 'match' \? prefs : null, next\);/);
  assert.match(t, /scopeId: match\.id, \.\.\.row \}\)/, 'the PUT sends the planned row');
  assert.match(t, /const setRow = \(key, value\) => save\(\{ \.\.\.p, \[key\]: value \}, key\);/);
});

test('R3: THE FIRST LINE SAYS WHAT THE ROW WILL DO', () => {
  assert.equal(summaryLine(DEFAULTS), 'Kickoff, score changes, close games and the final');
  assert.equal(summaryLine({ ...DEFAULTS, close: false }), 'Kickoff, score changes and the final');
  assert.equal(summaryLine({ ...OFF, master: true, final: true }), 'Final only');
  assert.equal(summaryLine({ ...DEFAULTS, master: false }), 'Off');
  assert.equal(summaryLine(OFF), 'Off');
  assert.equal(summaryLine({ ...OFF, master: true }), 'Nothing selected');
  assert.equal(summaryLine({ ...OFF, master: true, score: true }), 'Score changes only');
  assert.equal(summaryLine({ ...DEFAULTS, quarter: true }), 'Kickoff, score changes, quarter ends, close games and the final');
  assert.equal(summaryLine({ ...OFF, master: true, score: true, final: true }), 'Score changes and the final');
  assert.equal(summaryLine(null), 'Off');
  // In the JSX it is the first line of the signed-in body, from the read prefs only.
  const t = strip(src('components/alerts/AlertBell.js'));
  const body = t.slice(t.indexOf('al-signin'), t.indexOf('al-row al-row--master'));
  assert.match(body, /<\/div>\s*\) : \(\s*<>\s*(\{\}\s*)?<p className="al-summary" aria-live="polite">\{prefs \? summaryLine\(p\) : '\\u00a0'\}<\/p>/);
});

test('R2 ON THE SHEET: five trigger rows, Final last, no silencer anywhere', () => {
  const t = strip(src('components/alerts/AlertBell.js'));
  const keys = [...t.matchAll(/\{ key: '([a-z_]+)', title: '([^']+)'/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(keys, [['kickoff', 'Kickoff'], ['score', 'Score changes'], ['quarter', 'Quarter ends'], ['close', 'Close game'], ['final', 'Final']]);
  assert.doesNotMatch(t, /final_only|silenced|Silenced|applyRowToggle|SILENCED_BY/);
  assert.doesNotMatch(src('lib/push/sheetRules.js'), /SILENCED_BY_FINAL_ONLY|silencedByFinalOnly|applyRowToggle/);
  assert.doesNotMatch(src('components/alerts/alerts.css'), /al-silenced/);
  // Master off DISABLES the five and dims them; it does not unmount them.
  assert.match(t, /disabled=\{busy \|\| !p\.master\}/);
  assert.match(t, /al-rows\$\{p\.master \? '' : ' al-dim'\}/);
  // The pill lights on any of the five, the final included.
  assert.match(t, /\(p\.kickoff \|\| p\.score \|\| p\.quarter \|\| p\.close \|\| p\.final\)/);
});

test('rows save on change; "Saved" fades; Done only closes', () => {
  const t = strip(src('components/alerts/AlertBell.js'));
  assert.match(t, /setSaved\(true\)/);
  assert.match(t, /\{saved \? <span className="al-saved"/);
  // Done, not Save: every row is already written, and calling it Save would
  // imply the taps before it had not counted.
  assert.match(t, /className="al-done" onClick=\{close\}>Done</);
  assert.doesNotMatch(t, />Save</);
  const css = src('components/alerts/alerts.css');
  assert.match(css, /font-family: var\(--font-jetbrains-mono\)[\s\S]{0,120}color: var\(--muted\)[\s\S]{0,80}animation: al-fade/);
  // Motion is decoration; a reader who asked for less still gets the word.
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]{0,80}\.al-saved \{ animation: none; opacity: 1; \}/);
});

test('AN ERROR BELONGS TO THE ROW THAT FAILED', () => {
  // One red line under the sheet cannot say which toggle did not take, so the
  // reader turns the wrong one back off.
  const t = strip(src('components/alerts/AlertBell.js'));
  assert.match(t, /rowError\?\.key === r\.key/);
  assert.doesNotMatch(t, /className="al-err"/, 'the generic line is gone');
  // Plain words, not a code.
  assert.match(t, /That did not save\. Check your connection and try again\./);
});
