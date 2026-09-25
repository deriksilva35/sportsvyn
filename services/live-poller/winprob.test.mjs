// services/live-poller/winprob.test.mjs - live win probability, COMPOSED:
// the real pollOnce against DEV, then the real NFL game page reading what it
// wrote (the standing law: the path, not the parts).
//
// THREE SENTINEL GAMES, all created and deleted here, the teardown verified:
//   NFL  a pre-kick consensus line and one scrimmage snap -> the prior is
//        frozen, live_state carries win_prob, winprob_log gets a row, and the
//        page draws OUR live read with the Calibrating tag
//   CFB  the same inputs -> computed and LOGGED, never written for display
//   NFL-NOLINE  no odds at all -> no prior, no number, no log, no bar
// The provider is a synthetic payload handed to pollOnce as its fetcher; the
// Live Activity sender is dark (no APNs env), so nothing leaves the machine.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { install } from '../../lib/testing/nextResolve.mjs';
import { stubPath } from '../../lib/testing/stubDir.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
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
for (const k of ['PUSH_ENABLED', 'APNS_KEY', 'APNS_KEY_PATH', 'APNS_KEY_ID', 'APNS_TEAM_ID', 'WINPROB_PHONE']) delete process.env[k];

// THE PAGE'S CLIENT CONTROLS AND AUTH ARE STUBBED; its READER is not.
install();
const S = {
  link: stubPath('__wp_link.mjs'), nav: stubPath('__wp_nav.mjs'), css: stubPath('__wp_css.mjs'),
  header: stubPath('__wp_header.mjs'), auth: stubPath('__wp_auth.mjs'), follows: stubPath('__wp_follows.mjs'),
  shell: stubPath('__wp_shell.mjs'), bell: stubPath('__wp_bell.mjs'), actions: stubPath('__wp_actions.mjs'),
};
writeFileSync(S.link, "import React from 'react'; export default function Link({ href, children, ...rest }) { return React.createElement('a', { ...rest, href: String(href) }, children); }\n");
writeFileSync(S.nav, "export function notFound() { throw new Error('notFound'); } export function redirect(u) { throw new Error('redirect ' + u); } export function useRouter() { return { refresh() {}, push() {} }; } export function usePathname() { return '/'; } export function useSearchParams() { return new URLSearchParams(); }\n");
writeFileSync(S.css, 'export default {};\n');
writeFileSync(S.header, 'export default function GlobalHeaderServer() { return null; }\n');
writeFileSync(S.auth, 'export async function auth() { return null; }\n');
writeFileSync(S.follows, 'export async function getFollowedTeamIds() { return new Set(); }\n');
writeFileSync(S.shell, "export async function resolveShellMode() { return { isShell: false }; } export function isShellRequest() { return false; }\n");
writeFileSync(S.bell, 'export default function AlertBell() { return null; }\n');
writeFileSync(S.actions, 'export async function followTeam() { return { ok: true }; } export async function unfollowTeam() { return { ok: true }; }\n');
registerHooks({ resolve(spec, ctx, next) {
  const to = (p) => ({ url: pathToFileURL(p).href, shortCircuit: true });
  if (spec === 'next/link') return to(S.link);
  if (spec === 'next/navigation') return to(S.nav);
  if (spec.endsWith('.css')) return to(S.css);
  if (spec.endsWith('components/GlobalHeaderServer')) return to(S.header);
  if (spec === '@/auth') return to(S.auth);
  if (spec.endsWith('lib/follows')) return to(S.follows);
  if (spec.endsWith('lib/shell/shell')) return to(S.shell);
  if (spec.endsWith('components/alerts/AlertBell')) return to(S.bell);
  if (spec === '@/app/actions/follows') return to(S.actions);
  return next(spec, ctx);
} });

const { sql } = await import('../../lib/db.js');
const { pollOnce } = await import('./poll.mjs');
const { stateFromMatch } = await import('../../lib/push/liveActivityState.js');

const NS = `sentinel-winprob-${process.pid}-${Date.now()}`;
const ids = {}; const teams = {};
const KICK = new Date(Date.now() - 40 * 60_000);

const normalise = (row) => ({
  providerId: String(row.id), status: row.status, homeScore: row.homeScore, awayScore: row.awayScore,
  liveState: row.status === 'live' ? { period: row.period, clock: row.clock } : null,
});
const feed = (rows) => async () => ({ rows, calls: 1 });
const row = (pid, extra = {}) => ({ id: pid, status: 'live', homeScore: 10, awayScore: 7, period: 3, clock: '8:41', ...extra });

async function seedGame(tag, leagueSlug, { line = true } = {}) {
  const [lg] = await sql`SELECT id FROM leagues WHERE slug = ${leagueSlug}`;
  const t = await sql`SELECT id, name FROM teams WHERE league_id = ${lg.id} AND name IS NOT NULL
                       ${leagueSlug === 'cfb' ? sql`AND metadata->>'classification' = 'fbs'` : sql``} ORDER BY id LIMIT 2`;
  const [home, away] = t;
  const pid = `${NS}-${tag}`;
  const [m] = await sql`
    INSERT INTO matches (league_id, slug, status, home_team_id, away_team_id, kickoff_at, home_score, away_score,
                         season_year, season_phase, week, external_ids, metadata)
    VALUES (${lg.id}, ${`${NS}-${tag}`}, 'live', ${home.id}, ${away.id}, ${KICK.toISOString()}, 7, 7, 2026, 'REG', 4,
            ${JSON.stringify({ bdl_game_id: pid, cfbd_game_id: pid })}::jsonb, '{}'::jsonb)
    RETURNING id`;
  if (line) {
    // THE CONSENSUS AS THE INGEST WRITES IT: two rows per snapshot, named by
    // team, league_id NULL. Home -3.5 = home favoured by 3.5. An older, wider
    // snapshot sits before it to prove the LAST pre-kick one is taken, and a
    // post-kick one after it to prove nothing after kickoff is.
    const snap = async (at, homeV, awayV) => {
      for (const [label, v] of [[home.name, homeV], [away.name, awayV]]) {
        await sql`INSERT INTO odds_markets (market_scope, market_type, match_id, selection_label, selection_value, american_odds,
                                            implied_probability, consensus_method, num_books, is_current, fetched_at)
                  VALUES ('match', 'spread', ${m.id}, ${label}, ${v}, -110, 52.38, 'median', 9, false, ${at.toISOString()})`;
      }
    };
    await snap(new Date(KICK.getTime() - 3 * 3600e3), '-7', '+7');
    await snap(new Date(KICK.getTime() - 14 * 60e3), '-3.5', '+3.5');
    await snap(new Date(KICK.getTime() + 20 * 60e3), '+10', '-10');
  }
  // ONE SCRIMMAGE SNAP: 2nd & 7 at the away 45, the home side's ball.
  await sql`INSERT INTO plays (match_id, provider_play_id, drive_id, drive_number, play_number, period, clock, down, distance,
                               yards_to_goal, yards_gained, offense_team_id, play_type, text, home_score, away_score, scoring)
            VALUES (${m.id}, ${`${pid}-p1`}, 'd1', 5, 3, 3, '8:50', 2, 7, 45, 0, ${home.id}, 'Rush', 'A run', 10, 7, false)`;
  ids[tag] = m.id; teams[tag] = { home, away };
  return pid;
}

let PID = {};
before(async () => {
  PID.nfl = await seedGame('nfl', 'nfl');
  PID.cfb = await seedGame('cfb', 'cfb');
  PID.noline = await seedGame('noline', 'nfl', { line: false });
});

after(async () => {
  const all = Object.values(ids);
  await sql`DELETE FROM winprob_log WHERE match_id = ANY(${all})`;
  await sql`DELETE FROM plays WHERE match_id = ANY(${all})`;
  await sql`DELETE FROM odds_markets WHERE match_id = ANY(${all})`;
  await sql`DELETE FROM matches WHERE id = ANY(${all})`;
  const [left] = await sql`SELECT count(*)::int n FROM matches WHERE slug LIKE ${`${NS}%`}`;
  assert.equal(left.n, 0, 'the sentinels are gone');
  for (const f of Object.values(S)) { try { unlinkSync(f); } catch { /* gone */ } }
});

const meta = async (id) => (await sql`SELECT metadata FROM matches WHERE id = ${id}`)[0].metadata;
const logs = async (id) => sql`SELECT * FROM winprob_log WHERE match_id = ${id} ORDER BY id`;
const poll = (league, rows, now = new Date()) => pollOnce(sql, { league, providerKey: league === 'cfb' ? 'cfbd_game_id' : 'bdl_game_id', fetcher: feed(rows), normalise, now, push: true });

test('NFL: the poll freezes the LAST pre-kick line, writes win_prob into live_state, and logs one row', async () => {
  const now = new Date();
  await poll('nfl', [row(PID.nfl), row(PID.noline)], now);
  const md = await meta(ids.nfl);
  assert.equal(md.market_prior.spread, -3.5, 'the last snapshot before kickoff - not the older -7, not the post-kick +10');
  assert.equal(md.market_prior.n_books, 9);
  assert.ok(md.market_prior.captured_at);
  const wp = md.live_state.win_prob;
  assert.ok(Number.isInteger(wp) && wp > 50 && wp < 100, `home favoured, leading 10-7 with the ball: ${wp}`);
  assert.equal(md.live_state.win_prob_at, now.toISOString());
  assert.equal(md.live_state.period, 3, 'the rest of live_state is the poll\'s own');
  const L = await logs(ids.nfl);
  assert.equal(L.length, 1); assert.equal(L[0].sport, 'nfl'); assert.equal(L[0].model_version, 'sportsvyn-winprob-nfl@1.0.0');
  assert.equal(Math.round(L[0].p_home * 100), wp, 'the card shows the logged number, rounded');
  assert.equal(L[0].inputs.spread, -3.5); assert.equal(L[0].inputs.down_f, 2); assert.equal(L[0].inputs.posteam_is_home, 1);
  assert.equal(L[0].inputs.secs_game, 900 + 521, 'Q3 8:41 is 1,421 regulation seconds');
});

test('the prior is FROZEN: a later poll does not move it, and an unchanged state logs nothing new', async () => {
  const before = (await meta(ids.nfl)).market_prior;
  await poll('nfl', [row(PID.nfl)]);
  assert.deepEqual((await meta(ids.nfl)).market_prior, before);
  assert.equal((await logs(ids.nfl)).length, 1, 'same inputs, no new row');
  await poll('nfl', [row(PID.nfl, { homeScore: 17, clock: '6:02' })]);
  const L = await logs(ids.nfl);
  assert.equal(L.length, 2, 'a touchdown is a new state');
  assert.ok(L[1].p_home > L[0].p_home);
});

test('NO LINE, NO NUMBER: nothing frozen, nothing written, nothing logged', async () => {
  const md = await meta(ids.noline);
  assert.equal(md.market_prior ?? null, null);
  assert.equal(md.live_state?.win_prob ?? null, null);
  assert.equal((await logs(ids.noline)).length, 0);
});

test('CFB is SHADOW: computed and logged, never written for display', async () => {
  await poll('cfb', [row(PID.cfb)]);
  const md = await meta(ids.cfb);
  assert.equal(md.market_prior.spread, -3.5);
  assert.equal(md.live_state?.win_prob ?? null, null, 'no display value');
  const L = await logs(ids.cfb);
  assert.equal(L.length, 1); assert.equal(L[0].sport, 'cfb'); assert.equal(L[0].model_version, 'sportsvyn-winprob-cfb@0.1.0-shadow');
  assert.equal(L[0].inputs.season, 2026);
});

test('THE PHONE GETS NOTHING: the Live Activity state carries no winProb with WINPROB_PHONE off', async () => {
  const md = await meta(ids.nfl);
  const st = stateFromMatch({ leagueSlug: 'nfl', liveState: md.live_state, homeScore: 17, awayScore: 7, away: { abbreviation: 'A' }, home: { abbreviation: 'H' } });
  assert.equal('winProb' in st, false);
  process.env.WINPROB_PHONE = 'on';
  try {
    const on = stateFromMatch({ leagueSlug: 'nfl', liveState: md.live_state, homeScore: 17, awayScore: 7, away: { abbreviation: 'A' }, home: { abbreviation: 'H' } });
    assert.equal(on.winProb, md.live_state.win_prob, 'the flag is the only thing between them');
  } finally { delete process.env.WINPROB_PHONE; }
});

test('THE PAGE draws our live read from what the poller wrote - Calibrating, two-way, no market strip', async () => {
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const Page = (await import('../../app/nfl/game/[slug]/page.js')).default;
  const render = async (slug) => renderToStaticMarkup(await Page({ params: Promise.resolve({ slug }), searchParams: Promise.resolve({}) }));
  const md = await meta(ids.nfl);
  const h = await render(`${NS}-nfl`);
  assert.match(h, /data-winprob="live" data-stale="0"/);
  assert.match(h, /Win Probability · our live read <span class="gi-wp-cal">Calibrating<\/span>/);
  assert.match(h, /Our live model, still being validated against results\./);
  assert.match(h, new RegExp(`>${md.live_state.win_prob}%<`)); assert.match(h, new RegExp(`>${100 - md.live_state.win_prob}%<`));
  assert.doesNotMatch(h, /pre-kickoff consensus/i, 'once live, the market strip is gone');
  assert.doesNotMatch(h, /Draw/);
  const none = await render(`${NS}-noline`);
  assert.doesNotMatch(none, /data-winprob/, 'no line: no bar, no 50/50');
  void React;
});
