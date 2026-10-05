// app/api/widget/v1/route.test.mjs - the widget routes against DEV (sun-22).
//
//   auth     no token / malformed / unknown / expired -> 200 signed_out;
//            age not passed -> 200 age_required; valid -> 200 ok with data
//   shape    every answer validates against lib/widget/schema.js FEED / PICKER
//   headers  private, max-age=60 (feed) / 300 (picker), Vary, never public
//   limit    the 21st request a minute on one token is a 429 with Retry-After
//
// SENTINELS, ALL DEV, ALL TORN DOWN AND THE TEARDOWN ASSERTED: two users
// (@example.invalid), their sessions, two CFB teams and one FINAL CFB match
// under `sentinel-widget-` slugs (week 99, outside any real schedule), one
// settled pick'em contest under the non-league sport 'sentinel-widget' (so no
// real board reader can pick it up), one entry and one follow. A final, not a
// live game, so no "live now" reader in a parallel test file can see it.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { install } from '../../../../lib/testing/nextResolve.mjs';
install();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..', '..', '..');
(function loadEnv(p) {
  let t; try { t = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of t.split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const k = s.slice(0, eq).trim(); let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.resolve(REPO, '.env.local'));

const { sql } = await import('../../../../lib/db.js');
const { validate, FEED, PICKER } = await import('../../../../lib/widget/schema.js');
const { clearWidgetMemo } = await import('../../../../lib/widget/reads.js');
const { clearRateLimit, tokenFrom, RATE_MAX } = await import('../../../../lib/widget/session.js');
const { isAgeExempt, ageRedirectTarget } = await import('../../../../lib/auth/ageGate.js');

const NS = `sentinel-widget-${Date.now()}`;
const S = {};
let GET, teamsGET;

const req = (token, qs = '') => new Request(`http://localhost/api/widget/v1${qs}`, {
  headers: token == null ? {} : { authorization: `Bearer ${token}` },
});
const call = async (token, qs) => {
  const res = await GET(req(token, qs));
  return { res, body: await res.json() };
};

before(async () => {
  const [lg] = await sql`SELECT id FROM leagues WHERE slug = 'cfb'`;
  const [ok] = await sql`INSERT INTO users (email, date_of_birth) VALUES (${`${NS}-ok@example.invalid`}, '1990-01-01') RETURNING id`;
  const [pending] = await sql`INSERT INTO users (email) VALUES (${`${NS}-age@example.invalid`}) RETURNING id`;
  S.ok = ok.id; S.pending = pending.id;
  S.tok = randomUUID(); S.tokAge = randomUUID(); S.tokExpired = randomUUID();
  await sql`
    INSERT INTO sessions ("sessionToken", "userId", expires) VALUES
      (${S.tok}, ${S.ok}, now() + interval '1 day'),
      (${S.tokAge}, ${S.pending}, now() + interval '1 day'),
      (${S.tokExpired}, ${S.ok}, now() - interval '1 hour')`;
  const [h] = await sql`INSERT INTO teams (league_id, slug, name, short_name, abbreviation, color_primary, color_secondary)
    VALUES (${lg.id}, ${`${NS}-home`}, 'Sentinel Home', 'S Home', 'SWH', '#112233', '#445566') RETURNING id`;
  const [a] = await sql`INSERT INTO teams (league_id, slug, name, short_name, abbreviation, color_primary, color_secondary)
    VALUES (${lg.id}, ${`${NS}-away`}, 'Sentinel Away', 'S Away', 'SWA', '#778899', '#AABBCC') RETURNING id`;
  S.home = h.id; S.away = a.id;
  const [m] = await sql`
    INSERT INTO matches (league_id, slug, status, home_team_id, away_team_id, kickoff_at, home_score, away_score,
                         season_year, season_phase, week, external_ids, metadata)
    VALUES (${lg.id}, ${`${NS}-final`}, 'final', ${S.home}, ${S.away}, now() - interval '3 hours', 21, 28,
            2026, 'REG', 99, ${JSON.stringify({ sentinel: NS })}::jsonb, ${JSON.stringify({ live_state: { period: 4 } })}::jsonb)
    RETURNING id`;
  S.match = m.id;
  const [c] = await sql`
    INSERT INTO contests (game_type, sport, season_year, week, opens_at, locks_at, settled, board, meta)
    VALUES ('pickem', 'sentinel-widget', 2026, 99, now() - interval '2 days', now() - interval '3 hours', true,
            ${JSON.stringify([{ match_id: S.match }])}::jsonb, ${JSON.stringify({ sentinel: NS })}::jsonb)
    RETURNING id`;
  S.contest = c.id;
  await sql`INSERT INTO contest_entries (contest_id, user_id, lineup) VALUES (${S.contest}, ${S.ok}, ${JSON.stringify({ [S.match]: 'away' })}::jsonb)`;
  await sql`INSERT INTO user_team_follows (user_id, team_id) VALUES (${S.ok}, ${S.away})`;
  ({ GET } = await import('./route.js'));
  ({ GET: teamsGET } = await import('./teams/route.js'));
  clearWidgetMemo(); clearRateLimit();
});

after(async () => {
  await sql`DELETE FROM user_team_follows WHERE user_id IN (${S.ok ?? 0}, ${S.pending ?? 0})`;
  await sql`DELETE FROM contests WHERE id = ${S.contest ?? 0}`;
  await sql`DELETE FROM matches WHERE slug LIKE ${`${NS}%`}`;
  await sql`DELETE FROM teams WHERE slug LIKE ${`${NS}%`}`;
  await sql`DELETE FROM sessions WHERE "userId" IN (${S.ok ?? 0}, ${S.pending ?? 0})`;
  await sql`DELETE FROM users WHERE email LIKE ${`${NS}%`}`;
  const [left] = await sql`
    SELECT (SELECT count(*)::int FROM users WHERE email LIKE 'sentinel-widget-%') AS users,
           (SELECT count(*)::int FROM teams WHERE slug LIKE 'sentinel-widget-%') AS teams,
           (SELECT count(*)::int FROM matches WHERE slug LIKE 'sentinel-widget-%') AS matches,
           (SELECT count(*)::int FROM contests WHERE sport = 'sentinel-widget') AS contests,
           (SELECT count(*)::int FROM sessions WHERE "sessionToken" IN (${S.tok ?? ''}, ${S.tokAge ?? ''}, ${S.tokExpired ?? ''})) AS sessions`;
  assert.deepEqual(left, { users: 0, teams: 0, matches: 0, contests: 0, sessions: 0 }, 'sentinel rows left behind');
});

// ---------------------------------------------------------------------------
// AUTH STATES: always a 200
// ---------------------------------------------------------------------------

test('no token, a malformed token, an unknown token and an expired session: 200 signed_out', async () => {
  for (const tok of [null, 'short', `${'x'.repeat(20)} spaced`, randomUUID(), S.tokExpired]) {
    const { res, body } = await call(tok);
    assert.equal(res.status, 200, String(tok).slice(0, 4));
    assert.equal(body.state, 'signed_out');
    assert.deepEqual(validate(body, FEED), []);
    assert.equal(body.cta.href, '/signin');
    assert.equal(body.games.length + body.teams.length + body.inYourGames.length, 0);
  }
  // A non-Bearer Authorization header is not a token, and it does not fall back to anything.
  const res = await GET(new Request('http://localhost/api/widget/v1', { headers: { authorization: 'Basic abc' } }));
  assert.equal((await res.json()).state, 'signed_out');
});

test('a live session whose account has not passed the age screen: 200 age_required, no data', async () => {
  const { res, body } = await call(S.tokAge);
  assert.equal(res.status, 200);
  assert.equal(body.state, 'age_required');
  assert.equal(body.cta.href, '/age');
  assert.deepEqual(validate(body, FEED), []);
  assert.equal(body.daily, null);
  assert.deepEqual(body.teams, []);
});

test('a valid token: 200 ok, the follow and the pick are in it, and it validates', async () => {
  clearWidgetMemo();
  const { res, body } = await call(S.tok);
  assert.equal(res.status, 200);
  assert.equal(body.state, 'ok');
  assert.deepEqual(validate(body, FEED), [], validate(body, FEED).join('; '));
  assert.equal(body.v, 1);
  assert.match(body.generatedAt, /Z$/);
  assert.ok(Buffer.byteLength(JSON.stringify(body)) < 8 * 1024);
  // THE FOLLOW: the away side of the sentinel final, oriented to it.
  const t = body.teams.find((x) => x.teamId === S.away);
  assert.ok(t, `followed team missing: ${JSON.stringify(body.teams)}`);
  assert.deepEqual([t.team, t.status, t.home, t.score, t.oppScore, t.result, t.opp, t.gameId],
    ['SWA', 'final', false, 28, 21, 'W', 'SWH', S.match]);
  assert.equal(t.color, '#778899');
  // THE PICK: away, which won 28-21.
  const g = body.inYourGames.find((x) => x.gameId === S.match);
  assert.ok(g, `stake missing: ${JSON.stringify(body.inYourGames)}`);
  assert.deepEqual([g.pick, g.pickState, g.status, g.away, g.home], ['SWA', 'won', 'final', 'SWA', 'SWH']);
  assert.equal(g.href, `/cfb/game/${NS}-final`);
});

test('?teams= replaces the follows with the configured teams', async () => {
  const { body } = await call(S.tok, `?teams=${S.home}`);
  assert.equal(body.state, 'ok');
  assert.deepEqual(body.teams.map((t) => t.teamId), [S.home]);
  assert.deepEqual([body.teams[0].home, body.teams[0].result], [true, 'L']);
});

test('the feed is memoised 60 s per user: a second call is the same payload, same generatedAt', async () => {
  clearWidgetMemo();
  const a = (await call(S.tok)).body;
  const b = (await call(S.tok)).body;
  assert.equal(a.generatedAt, b.generatedAt);
  assert.deepEqual(a, b);
});

// ---------------------------------------------------------------------------
// HEADERS
// ---------------------------------------------------------------------------

test('CACHING: private, max-age=60 on every state, Vary on Authorization and Cookie, never public', async () => {
  for (const tok of [null, S.tokAge, S.tok]) {
    const { res } = await call(tok);
    const cc = res.headers.get('cache-control');
    assert.equal(cc, 'private, max-age=60');
    assert.doesNotMatch(cc, /public|s-maxage/);
    assert.match(res.headers.get('vary'), /Authorization/);
    assert.match(res.headers.get('vary'), /Cookie/);
    assert.match(res.headers.get('content-type'), /application\/json/);
  }
});

// ---------------------------------------------------------------------------
// THE PICKER
// ---------------------------------------------------------------------------

test('GET /teams: followed first, then everyone else; signed out gets the list with no follows', async () => {
  const res = await teamsGET(new Request('http://localhost/api/widget/v1/teams', { headers: { authorization: `Bearer ${S.tok}` } }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'private, max-age=300');
  const body = await res.json();
  assert.equal(body.state, 'ok');
  assert.deepEqual(validate(body, PICKER), []);
  assert.deepEqual(body.followed.map((t) => t.id), [S.away]);
  assert.ok(!body.teams.some((t) => t.id === S.away), 'a followed team is not listed twice');
  assert.ok(body.teams.length > 100, `the full list: ${body.teams.length}`);
  assert.ok(['nfl', 'cfb', 'mlb', 'nba', 'epl'].every((l) => body.teams.some((t) => t.league === l)));
  const out = await (await teamsGET(new Request('http://localhost/api/widget/v1/teams'))).json();
  assert.equal(out.state, 'signed_out');
  assert.deepEqual(out.followed, []);
  assert.ok(out.teams.length > 100);
  const age = await (await teamsGET(new Request('http://localhost/api/widget/v1/teams', { headers: { authorization: `Bearer ${S.tokAge}` } }))).json();
  assert.equal(age.state, 'age_required');
  assert.deepEqual(age.followed, []);
});

// ---------------------------------------------------------------------------
// RATE LIMIT, TOKEN SOURCES, AND THE PROXY
// ---------------------------------------------------------------------------

test('RATE LIMIT: the 21st request in a minute on one token is a 429 with Retry-After', async () => {
  clearRateLimit();
  for (let i = 0; i < RATE_MAX; i += 1) assert.equal((await call(S.tokExpired)).res.status, 200);
  const { res, body } = await call(S.tokExpired);
  assert.equal(res.status, 429);
  assert.ok(Number(res.headers.get('retry-after')) >= 1);
  assert.equal(body.state, 'rate_limited');
  // another token is unaffected, and so is no token at all
  assert.equal((await call(S.tokAge)).res.status, 200);
  assert.equal((await call(null)).res.status, 200);
  clearRateLimit();
});

test('the token: Bearer first, else the Auth.js session cookie', () => {
  const t = randomUUID();
  const fake = (auth, cookie) => ({
    headers: new Headers(auth ? { authorization: auth } : {}),
    cookies: { get: (n) => (n === '__Secure-authjs.session-token' && cookie ? { value: cookie } : undefined) },
  });
  assert.equal(tokenFrom(fake(`Bearer ${t}`, 'other-cookie-value-0000')), t);
  assert.equal(tokenFrom(fake(null, t)), t);
  assert.equal(tokenFrom(fake('Bearer', t)), null, 'a broken Authorization header does not fall back to the cookie');
  assert.equal(tokenFrom(fake(null, null)), null);
});

test('PROXY: /api/widget/* is never age-redirected or admin-gated, so Bearer requests reach the route', () => {
  assert.equal(isAgeExempt('/api/widget/v1'), true);
  assert.equal(ageRedirectTarget({ pathname: '/api/widget/v1', sessionToken: 'x', ageCookie: null, expected: 'y' }), null);
  const src = readFileSync(path.join(REPO, 'proxy.js'), 'utf8');
  // the two age-screen matcher entries exclude api/; the admin entries name /api/admin only
  assert.equal((src.match(/source: '\/\(\(\?!_next\/\|api\/\|favicon\.ico\)\.\*\)'/g) ?? []).length, 2);
  assert.doesNotMatch(src, /'\/api\/widget/);
});

test('READ-ONLY: the widget routes export GET and nothing else', async () => {
  for (const f of ['./route.js', './teams/route.js']) {
    const text = readFileSync(path.join(__dirname, f), 'utf8');
    assert.deepEqual([...text.matchAll(/^export async function (\w+)/gm)].map((m) => m[1]), ['GET'], f);
  }
});
