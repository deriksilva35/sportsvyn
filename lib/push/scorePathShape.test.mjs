// lib/push/scorePathShape.test.mjs - the score path carries the team objects
// (Florida A&M at Miami, 10 Sep: five score pushes lost to a score path that
// passed abbreviations only), one builder serves both push paths, and the
// abbreviation resolves through short_name and name before giving up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchForPush } from '../../services/live-poller/poll.mjs';
import { pushPayload } from './payload.js';
import { resolveAbbr } from '../live/teamAbbr.js';
import { dispatch } from './dispatch.js';
import { drainPushCounts } from './warn.js';

const src = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const ROW = { id: 20750, slug: 'cfb-2026-reg-w2-florida-a-m-miami', status: 'live', league_slug: 'cfb',
  home_team_id: 48148, away_team_id: 48284, home_score: 56, away_score: 0,
  home_abbr: 'MIA', home_short_name: 'Miami', home_name: 'Miami',
  away_abbr: null, away_short_name: 'Florida A&M', away_name: 'Florida A&M' };

test('resolveAbbr: abbreviation, else short_name, else a code derived from the name; none only when none exists', () => {
  // the existing contract ({ value, source }) already does what the addendum
  // asks; the score path simply never handed it a short_name or a name.
  assert.deepEqual(resolveAbbr({ abbreviation: 'MIA', short_name: 'Miami' }), { value: 'MIA', source: 'abbreviation' });
  assert.deepEqual(resolveAbbr({ abbreviation: null, short_name: 'Florida A&M', name: 'Florida A&M' }), { value: 'Florida A&M', source: 'short_name' });
  assert.deepEqual(resolveAbbr({ abbreviation: '', short_name: '  ', name: 'Florida A&M' }), { value: 'FAM', source: 'derived' });
  assert.deepEqual(resolveAbbr({}), { value: null, source: 'none' });
});

test('score event, away abbreviation null, short_name "Florida A&M" -> headline "Florida A&M 0, MIA 56", payload non-null', () => {
  drainPushCounts();
  const match = matchForPush(ROW, { home_score: 56, away_score: 0 });
  assert.deepEqual(match.away, { abbreviation: null, short_name: 'Florida A&M', name: 'Florida A&M' });
  const p = pushPayload('score', { ...match, matchId: match.id, homeScore: 56, awayScore: 0, scoreKind: null });
  assert.ok(p, 'a payload, not null');
  assert.equal(p.title, 'Florida A&M 0, MIA 56');
  assert.equal(p.url, '/cfb/game/cfb-2026-reg-w2-florida-a-m-miami');
  assert.equal(drainPushCounts().payloadNull, 0);
});

test('dispatched: one audience row wanting scores -> one push_sends claim, one send', async () => {
  const AUD = { token: 'tok-9', user_id: 1, platform: 'ios', endpoint: null, p256dh: null, auth: null, via_follow: false, via_match: true,
    t_master: null, m_master: true, m_kickoff: true, m_score: true, m_quarter: true, m_close: true, m_final_only: false };
  const calls = [];
  const sql = async (strings, ...vals) => { const q = strings.join('?'); calls.push(q); if (/FROM device_tokens/.test(q) || /d\.token/.test(q)) return [AUD]; if (/INSERT INTO push_sends/.test(q)) return [{ id: 77 }]; return []; };
  const sent = [];
  const out = await dispatch(sql, { match: matchForPush(ROW, { home_score: 56, away_score: 0 }), event: 'score', state: { homeScore: 56, awayScore: 0, scoreKind: null },
    senders: { ios: async (d, p) => { sent.push(p.title); return { ok: true, status: 200 }; } }, log: () => {} });
  assert.equal(out.audience, 1); assert.equal(out.eligible, 1); assert.equal(out.sent, 1);
  assert.equal(calls.filter((q) => /INSERT INTO push_sends/.test(q)).length, 1, 'exactly one claim');
  assert.deepEqual(sent, ['Florida A&M 0, MIA 56']);
});

test('one builder for both push paths, and both call it', () => {
  const poll = src('services/live-poller/poll.mjs');
  assert.equal((poll.match(/matchForPush\(m(, after)?\)/g) ?? []).length, 2, 'the lost-final path and the score path');
  assert.doesNotMatch(poll, /home: \{ short_name: m\.home_short_name/, 'no hand-built team object left');
  assert.doesNotMatch(poll, /homeAbbr: m\.home_abbr, awayAbbr: m\.away_abbr, leagueSlug: m\.league_slug,\s*\};/, 'no abbreviation-only match object left');
  const a = matchForPush(ROW); const b = matchForPush(ROW, { home_score: 57 });
  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), 'same shape with or without the poll delta');
  assert.equal(b.home_score, 57); assert.equal(a.home.abbreviation, 'MIA'); assert.equal(a.away.name, 'Florida A&M');
});
