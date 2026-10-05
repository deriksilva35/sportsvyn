// services/live-poller/winprob.test.mjs - live win probability, COMPOSED:
// the real pollOnce against DEV, then the real NFL game page reading what it
// wrote (the standing law: the path, not the parts).
//
// THREE SENTINEL GAMES, all created and deleted here, the teardown verified:
//   NFL  a pre-kick consensus line and one scrimmage snap -> the prior is
//        frozen, live_state carries win_prob, winprob_log gets a row, and the
//        page draws OUR live read with the Calibrating tag
//   CFB  the same inputs -> computed, LOGGED and written for display (sat-1)
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
  PID.hold = await seedGame('hold', 'nfl');
  PID.dup = await seedGame('dup', 'nfl');
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
  // THE SNAP'S OWN CLOCK, NOT THE SCOREBOARD'S (relay fri-4 c): the play was
  // snapped at Q3 8:50 while the scoreboard already reads 8:41, and training
  // read each play's own time.
  assert.equal(L[0].inputs.secs_game, 900 + 530, 'Q3 8:50 - the snap - is 1,430 regulation seconds; the scoreboard\'s 8:41 is not used');
});

test('the prior is FROZEN: a later poll does not move it, and an unchanged state logs nothing new', async () => {
  const before = (await meta(ids.nfl)).market_prior;
  await poll('nfl', [row(PID.nfl)]);
  assert.deepEqual((await meta(ids.nfl)).market_prior, before);
  assert.equal((await logs(ids.nfl)).length, 1, 'same inputs, no new row');
  // THE SCORE ARRIVES BEFORE ITS PLAY ROW (the score poller runs every 30 s,
  // plays-live every one to two minutes): the tick HOLDS - no new STATE, and the
  // card keeps its number with a fresh stamp rather than going to "Paused".
  // SINCE relay mon-3 D THE HOLD ITSELF IS LOGGED: one 'hold' row carrying the
  // held value (lib/winprob/live.js logHoldStart), so audits need no sampler.
  const shown = (await meta(ids.nfl)).live_state.win_prob;
  await poll('nfl', [row(PID.nfl, { homeScore: 17, clock: '6:02' })]);
  const H = await logs(ids.nfl);
  assert.equal(H.length, 2, 'plays behind the score: no state row - the hold row only');
  assert.equal(H[1].inputs.reason, 'hold');
  const heldLs = (await meta(ids.nfl)).live_state;
  assert.equal(heldLs.win_prob, shown, 'the last value is kept');
  assert.ok(Date.now() - Date.parse(heldLs.win_prob_at) < 60_000, 'and stamped fresh, so it does not read Paused');
  // THE TOUCHDOWN ROW LANDS, carrying the score after it: the plays have caught up.
  await sql`INSERT INTO plays (match_id, provider_play_id, drive_id, drive_number, play_number, period, clock, down, distance,
                               yards_to_goal, yards_gained, offense_team_id, play_type, text, home_score, away_score, scoring)
            VALUES (${ids.nfl}, ${`${PID.nfl}-p2`}, 'd1', 5, 4, 3, '6:02', 1, 10, 30, 30, ${teams.nfl.home.id}, 'Pass Reception', 'A touchdown', 17, 7, true)`;
  await poll('nfl', [row(PID.nfl, { homeScore: 17, clock: '6:02' })]);
  const L = await logs(ids.nfl);
  assert.deepEqual(L.map((r) => r.inputs.reason ?? 'state'), ['state', 'hold', 'release', 'state'],
    'the hold is closed by a release, then the touchdown is a new state, once its row is in');
  assert.ok(L[3].p_home > L[0].p_home);
  assert.ok(heldLs.win_prob_hold_since, 'the hold was marked');
  assert.equal((await meta(ids.nfl)).live_state.win_prob_hold_since, undefined, 'a computed value ends the hold, so the next one starts its 180 s afresh');
});

test('NO LINE, NO NUMBER: nothing frozen, nothing written, nothing logged', async () => {
  const md = await meta(ids.noline);
  assert.equal(md.market_prior ?? null, null);
  assert.equal(md.live_state?.win_prob ?? null, null);
  assert.equal((await logs(ids.noline)).length, 0);
});

// sat-1: CFB was SHADOW (computed and logged, never written for display);
// it is now displayed, tagged Calibrating by the surfaces (lib/winprob/display.js).
test('CFB is DISPLAYED (sat-1): computed, logged, and written for display', async () => {
  await poll('cfb', [row(PID.cfb)]);
  const md = await meta(ids.cfb);
  assert.equal(md.market_prior.spread, -3.5);
  assert.ok(Number.isInteger(md.live_state?.win_prob) && md.live_state.win_prob >= 0 && md.live_state.win_prob <= 100, 'a display value');
  assert.ok(md.live_state.win_prob_at, 'stamped');
  const L = await logs(ids.cfb);
  assert.equal(L.length, 1); assert.equal(L[0].sport, 'cfb'); assert.equal(L[0].model_version, 'sportsvyn-winprob-cfb@0.1.0-shadow');
  assert.equal(L[0].inputs.season, 2026);
});

test('THE PHONE (sun-23): the Live Activity state carries NFL\'s winProb and never CFB\'s', async () => {
  const st = async (lg, id) => {
    const md = await meta(id);
    return { md, st: stateFromMatch({ leagueSlug: lg, liveState: md.live_state, homeScore: 17, awayScore: 7, away: { abbreviation: 'A' }, home: { abbreviation: 'H' } }) };
  };
  const nfl = await st('nfl', ids.nfl);
  assert.ok(Number.isInteger(nfl.md.live_state.win_prob), 'the poller wrote an NFL number');
  assert.equal(nfl.st.winProb, nfl.md.live_state.win_prob, 'NFL: on the lock screen');
  const cfb = await st('cfb', ids.cfb);
  assert.ok(Number.isInteger(cfb.md.live_state.win_prob), 'the poller wrote a CFB number (displayed on the web)');
  assert.equal('winProb' in cfb.st, false, 'CFB: not on the phone until its sealed re-score passes');
  // NO ENV CAN TURN IT ON OR OFF ANY MORE: the switch is lib/winprob/display.js PHONE.
  process.env.WINPROB_PHONE = 'on';
  try {
    assert.equal('winProb' in (await st('cfb', ids.cfb)).st, false);
  } finally { delete process.env.WINPROB_PHONE; }
});

test('THE PAGE draws our live read from what the poller wrote - no tag (sat-1), the method note, two-way, no market strip', async () => {
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const Page = (await import('../../app/nfl/game/[slug]/page.js')).default;
  const render = async (slug) => renderToStaticMarkup(await Page({ params: Promise.resolve({ slug }), searchParams: Promise.resolve({}) }));
  const md = await meta(ids.nfl);
  const h = await render(`${NS}-nfl`);
  assert.match(h, /data-winprob="live" data-stale="0"/);
  assert.match(h, /<span class="lbl">Win Probability · our live read<\/span><\/div>/);
  assert.doesNotMatch(h, /Calibrating|gi-wp-cal/, 'NFL: no tag (sat-1)');
  assert.doesNotMatch(h, /Paused/, 'fresh: no paused line');
  assert.match(h, /Sportsvyn model · market prior \+ game state/, 'the method note');
  assert.match(h, new RegExp(`>${md.live_state.win_prob}%<`)); assert.match(h, new RegExp(`>${100 - md.live_state.win_prob}%<`));
  assert.doesNotMatch(h, /pre-kickoff consensus/i, 'once live, the market strip is gone');
  assert.doesNotMatch(h, /Draw/);
  const none = await render(`${NS}-noline`);
  assert.doesNotMatch(none, /data-winprob/, 'no line: no bar, no 50/50');
  void React;
});

// ---------------------------------------------------------------------------
// THE CURVE ENDS AT THE RESULT (27 Sep audit): on a final the log gets one
// terminal row after the last play row - the winner 1, the loser 0 - through
// the real poller, once, and only for a game the model priced.
// ---------------------------------------------------------------------------

test('A FINAL CLOSES THE CURVE: one terminal row, the winner at 100, after the last play row - and only once', async () => {
  const before = await logs(ids.nfl);
  assert.ok(before.length >= 1, 'the game has a curve to close');
  const lastPlay = before.at(-1);
  await poll('nfl', [row(PID.nfl, { status: 'final', homeScore: 24, awayScore: 17 })], new Date(Date.now() + 1000));
  const rows = await logs(ids.nfl);
  const term = rows.at(-1);
  assert.equal(rows.length, before.length + 1, 'exactly one row more');
  assert.equal(term.inputs.reason, 'final');
  assert.equal(Number(term.p_home), 1, 'the home side won 24-17: 100');
  assert.equal(term.inputs.secs_game, 0, 'so the fourth-quarter read includes it');
  assert.equal(String(term.play_seq), String(lastPlay.play_seq), 'it carries the last play row\'s play_seq');
  assert.equal(term.model_version, lastPlay.model_version);
  assert.ok(new Date(term.ts) > new Date(lastPlay.ts), 'and it lands after it');
  // the next poll still sees final (the window's 3 minutes): nothing more
  await poll('nfl', [row(PID.nfl, { status: 'final', homeScore: 24, awayScore: 17 })], new Date(Date.now() + 2000));
  assert.equal((await logs(ids.nfl)).length, rows.length, 'never twice');
});

test('A GAME THE MODEL NEVER PRICED HAS NO CURVE TO CLOSE, and an away win closes at 0', async () => {
  await poll('nfl', [row(PID.noline, { status: 'final', homeScore: 3, awayScore: 6 })]);
  assert.equal((await logs(ids.noline)).length, 0, 'no line, no curve, no terminal row');
  const { terminalRow } = await import('../../lib/winprob/live.js');
  assert.equal(terminalRow({ homeScore: 3, awayScore: 6 }).p, 0, 'the away side won: home 0');
  assert.equal(terminalRow({ homeScore: 21, awayScore: 21 }).p, 0.5, 'a tie closes at 50');
  assert.equal(terminalRow({ homeScore: null, awayScore: 6 }), null, 'no score, no row');
});

// ---------------------------------------------------------------------------
// HOLDS ARE WRITTEN DOWN (relay mon-3 D): the poll that starts a hold writes a
// 'hold' row with the held value; the tick that ends it writes a 'release' row
// with the seconds held, then its own row. Through the real poller.
// ---------------------------------------------------------------------------

test('A HOLD IS LOGGED: one row when it starts, one when it ends with the seconds held - never two starts', async () => {
  const t0 = new Date(Date.now() + 10_000);
  await poll('nfl', [row(PID.hold, { homeScore: 10, awayScore: 7 })], t0);
  const base = await logs(ids.hold);
  assert.equal(base.length, 1, 'a normal tick first');
  // the score moves ahead of the plays (a touchdown the feed has not filed): hold
  const t1 = new Date(t0.getTime() + 30_000);
  await poll('nfl', [row(PID.hold, { homeScore: 17, awayScore: 7 })], t1);
  let rows = await logs(ids.hold);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].inputs.reason, 'hold');
  assert.equal(Number(rows[1].p_home), Number(base[0].p_home), 'the hold row carries the value being held');
  assert.equal(new Date(rows[1].inputs.since).getTime(), t1.getTime());
  // still behind: nothing more
  await poll('nfl', [row(PID.hold, { homeScore: 17, awayScore: 7 })], new Date(t1.getTime() + 30_000));
  assert.equal((await logs(ids.hold)).length, 2, 'a hold is started once');
  // the touchdown lands in the plays: release, then the computed row
  const { home } = teams.hold;
  await sql`INSERT INTO plays (match_id, provider_play_id, drive_id, drive_number, play_number, period, clock, down, distance,
                               yards_to_goal, yards_gained, offense_team_id, play_type, text, home_score, away_score, scoring)
            VALUES (${ids.hold}, ${`${PID.hold}-p2`}, 'd1', 5, 4, 3, '8:10', 1, 10, 0, 45, ${home.id}, 'Passing Touchdown', 'A score', 17, 7, true)`;
  const t2 = new Date(t1.getTime() + 95_000);
  await poll('nfl', [row(PID.hold, { homeScore: 17, awayScore: 7, clock: '8:05' })], t2);
  rows = await logs(ids.hold);
  assert.equal(rows[2].inputs.reason, 'release');
  assert.equal(rows[2].inputs.secs_held, 95, 'held from t1 to t2');
  assert.equal(rows.length, 4, 'and the computed tick after it');
  assert.equal(rows[3].inputs.reason, undefined, 'a plain state row');
});

// ---------------------------------------------------------------------------
// THE SAME MOMENT IS ONE ROW (droplet-mon-9 item 6)
// ---------------------------------------------------------------------------

test('sameMoment: play, clock and both scores equal to a STATE row - and never a hold/release/final row', async () => {
  const { sameMoment } = await import('../../lib/winprob/live.js');
  const st = { secs_game: 2310, home_score: 10, away_score: 7, score_diff: 3 };
  const last = { play_seq: 41, inputs: { ...st, prior_logit: 0.1 } };
  assert.equal(sameMoment(last, 41, { ...st, prior_logit: 0.2 }), true, 'a moved prior is still the same moment');
  assert.equal(sameMoment(last, 42, st), false, 'a new play is a new moment');
  assert.equal(sameMoment(last, 41, { ...st, secs_game: 2300 }), false, 'the clock moved');
  assert.equal(sameMoment(last, 41, { ...st, home_score: 17, score_diff: 10 }), false, 'the score moved');
  assert.equal(sameMoment(last, 41, { ...st, home_score: 14, away_score: 11 }), false, '14-11 is not 10-7 though both are +3');
  for (const reason of ['hold', 'release', 'final']) {
    assert.equal(sameMoment({ play_seq: 41, inputs: { ...st, reason } }, 41, st), false, `a ${reason} row is never the last state`);
  }
  assert.equal(sameMoment(null, 41, st), false, 'no row yet writes');
});

test('A REPEATED KICKOFF POLL WRITES ONE ROW (DEV sentinel)', async () => {
  const count = async () => (await sql`SELECT count(*)::int n FROM winprob_log WHERE match_id = ${ids.dup}`)[0].n;
  const now = Date.now();
  await poll('nfl', [row(PID.dup)], new Date(now));
  const one = await count();
  assert.equal(one, 1, 'the first poll writes');
  for (let i = 1; i <= 3; i++) await poll('nfl', [row(PID.dup)], new Date(now + i * 30_000));
  assert.equal(await count(), one, 'three more polls of the same moment write nothing');
});

test('THE SAME MOMENT WITH A MOVED INPUT IS SKIPPED AND COUNTED; A CHANGED SCORE WRITES (DEV sentinel)', async () => {
  const { logWinProb } = await import('../../lib/winprob/live.js');
  const count = async () => (await sql`SELECT count(*)::int n FROM winprob_log WHERE match_id = ${ids.dup}`)[0].n;
  const base = await count();
  const tick = (priorLogit, home, away, secs = 1800) => ({
    sport: 'nfl', p: 0.6, model: 'test', playSeq: 900001,
    state: { score_diff: home - away, secs_game: secs, secs_half: 900, is_ot: 0 },
    prior: { prior_logit: priorLogit, spread: -3.5 }, scores: { home, away },
  });
  let dups = 0; const onDup = () => { dups += 1; };
  const t0 = Date.now() + 600_000;
  assert.equal(await logWinProb(sql, ids.dup, tick(0.10, 10, 7), { now: new Date(t0), onDup }), true, 'a new moment writes');
  assert.equal(await logWinProb(sql, ids.dup, tick(0.12, 10, 7), { now: new Date(t0 + 30_000), onDup }), false,
    'same play, clock and score - only the prior moved - is not written');
  assert.equal(dups, 1, 'and it is counted as dup_skipped');
  assert.equal(await count(), base + 1);
  assert.equal(await logWinProb(sql, ids.dup, tick(0.12, 17, 7), { now: new Date(t0 + 60_000), onDup }), true, 'a changed score writes');
  assert.equal(await count(), base + 2);
  assert.equal(dups, 1);
});

test('THE POLLER JOURNALS wrote= and dup_skipped=', () => {
  const idx = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');
  assert.match(idx, /winprob wrote=\$\{r\.winprob \?\? 0\} dup_skipped=\$\{r\.dup_skipped \?\? 0\}/);
  const poll = readFileSync(new URL('./poll.mjs', import.meta.url), 'utf8');
  assert.match(poll, /onDup: \(\) => \{ out\.dup_skipped = \(out\.dup_skipped \?\? 0\) \+ 1; \}/);
});
