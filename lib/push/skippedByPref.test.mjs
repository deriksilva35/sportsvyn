// lib/push/skippedByPref.test.mjs - an audience that wants nothing is a
// counted, journaled outcome, not silence (SF at LAR, 10 Sep: one final_only
// subscriber, a field goal, nothing in the ledger).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dispatch } from './dispatch.js';
import { drainPushCounts, peekPushCounts } from './warn.js';

const src = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

// one iOS device whose match pref is master + everything on, final_only on
const AUDIENCE_ROW = {
  token: 'tok-1', user_id: 1, platform: 'ios', endpoint: null, p256dh: null, auth: null, via_follow: false, via_match: true,
  t_master: null, m_master: true, m_kickoff: true, m_score: true, m_quarter: true, m_close: true, m_final_only: true,
};
function fakeSql(rows) {
  const calls = [];
  const sql = async (strings, ...vals) => { const q = strings.join('?'); calls.push(q); if (/FROM device_tokens/.test(q) || /d\.token/.test(q)) return rows; return []; };
  sql.calls = calls; return sql;
}
const MATCH = { id: 21540, slug: 'nfl-2026-reg-w1-sf-lar', homeAbbr: 'LAR', awayAbbr: 'SF', leagueSlug: 'nfl', home_score: 0, away_score: 3, status: 'live' };

test('audience 1 with final_only on a score: eligible 0, sent 0, skippedByPref 1, the summary line emitted', async () => {
  drainPushCounts();
  const sql = fakeSql([AUDIENCE_ROW]); const lines = []; const sent = [];
  const out = await dispatch(sql, {
    match: MATCH, event: 'score', state: { homeScore: 0, awayScore: 3, scoreKind: 'SF field goal' },
    senders: { ios: async (d, p) => { sent.push([d.token, p]); return { ok: true, status: 200 }; }, web: async () => ({ ok: true, status: 201 }) },
    log: (l) => lines.push(l),
  });
  assert.equal(out.audience, 1); assert.equal(out.eligible, 0); assert.equal(out.sent, 0); assert.deepEqual(sent, []);
  assert.equal(peekPushCounts().skippedByPref, 1, 'counted for the heartbeat');
  assert.equal(lines.length, 1); assert.match(lines[0], /^\[push\] score match=21540 audience=1 eligible=0 sent=0 skipped=0/);
  assert.ok(!sql.calls.some((q) => /INSERT INTO push_sends/.test(q)), 'no claim row for nobody');
  // the same row with final_only off is eligible and sent - the counter stays put
  const sql2 = fakeSql([{ ...AUDIENCE_ROW, m_final_only: false }]); const lines2 = []; const sent2 = [];
  const out2 = await dispatch(sql2, { match: MATCH, event: 'score', state: { homeScore: 0, awayScore: 3, scoreKind: 'SF field goal' },
    senders: { ios: async (d, p) => { sent2.push(p.title); return { ok: true, status: 200 }; } }, log: (l) => lines2.push(l) });
  assert.equal(out2.eligible, 1); assert.equal(peekPushCounts().skippedByPref, 1);
  assert.equal(out2.sent + out2.skipped, 1, 'claimed (fake sql returns no claim row -> skipped) or sent');
  assert.match(lines2[0], /audience=1 eligible=1/);
  const drained = drainPushCounts(); assert.equal(drained.skippedByPref, 1); assert.equal(peekPushCounts().skippedByPref, 0, 'drained into the beat');
});

test('the poller hands its logger to dispatch, and the heartbeat carries skippedByPref', () => {
  const poll = src('services/live-poller/poll.mjs'); const index = src('services/live-poller/index.mjs'); const warn = src('lib/push/warn.js');
  assert.match(poll, /push = true, log = \(\) => \{\},\s*\}\) \{/, 'pollOnce takes log');
  assert.match(poll, /dispatch\(sql, \{ match, event: t\.event, state: \{ \.\.\.t\.state, scoreKind \}, log \}\)/);
  assert.match(index, /normalise: lg\.normalise, now, log,/, 'index passes its logger');
  assert.match(warn, /skippedByPref: 0/, 'a drained counter, so it rides drainPushCounts() into the heartbeat');
  assert.match(index, /\.\.\.drainPushCounts\(\)/);
});
