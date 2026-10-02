// lib/leagues/invite.test.mjs - Leagues V1 on DEV: create with settings, the
// typed code and the link token, the cap (under a race), the start line, the
// owner's reset, and migration 122's backfill of a pre-V1 league.
//
// Fixture: SENTINEL users (@example.invalid, "test" in the address - found by
// scripts/dev-orphan-sweep.mjs if a killed run leaves them) and leagues named
// "Test invite ...". after() deletes every one and asserts it did.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');

const core = await import('./core.js');
const invite = await import('./invite.js');
const { REFUSALS } = await import('./code.js');
const { SETTING_REFUSALS } = await import('./settings.js');
const { sql } = await import('../db.js');

const NS = `lgtest-${process.pid}-${Date.now()}`;
const users = [];
const leagueIds = [];
const FUTURE = { nfl: { season: 2026, week: 99, at: '2099-01-01T00:00:00.000Z' }, day: { date: '2099-01-01', at: '2099-01-01T05:00:00.000Z' } };
const PAST = { nfl: { season: 2026, week: 1, at: '2020-01-01T00:00:00.000Z' }, day: { date: '2020-01-01', at: '2020-01-01T05:00:00.000Z' } };
const S = (over = {}) => ({ games: ['daily'], span: 'season', scoring: 'total', format: 'table', maxMembers: 12, lateJoins: false, ...over });

async function mkUser(tag) {
  const [u] = await sql`INSERT INTO users (email) VALUES (${`${NS}-${tag}@example.invalid`}) RETURNING id`;
  users.push(u.id);
  return u.id;
}
async function mkLeague(owner, settings, anchors = FUTURE, name = 'Test invite') {
  const r = await core.createLeague(owner, `${name} ${leagueIds.length}`, settings, { anchors, survivor: false });
  assert.equal(r.ok, true, r.reason);
  leagueIds.push(r.leagueId);
  return r;
}
const memberCount = async (id) => (await sql`SELECT count(*)::int n FROM league_members WHERE league_id = ${id}`)[0].n;

let owner; let a; let b; let c; let d;
before(async () => {
  owner = await mkUser('owner'); a = await mkUser('a'); b = await mkUser('b'); c = await mkUser('c'); d = await mkUser('d');
});

after(async () => {
  if (leagueIds.length) await sql`DELETE FROM player_leagues WHERE id = ANY(${leagueIds})`;
  await sql`DELETE FROM users WHERE email LIKE ${`${NS}-%@example.invalid`}`;
  const [{ n }] = await sql`
    SELECT (SELECT count(*) FROM users WHERE email LIKE ${`${NS}-%@example.invalid`})
         + (SELECT count(*) FROM player_leagues WHERE id = ANY(${leagueIds}))
         + (SELECT count(*) FROM player_league_games WHERE league_id = ANY(${leagueIds}))
         + (SELECT count(*) FROM league_members WHERE league_id = ANY(${leagueIds})) AS n`;
  assert.equal(Number(n), 0, 'teardown left nothing behind');
});

test('create writes the settings, the games (one row per sport), the owner, a code and a token', async () => {
  const r = await mkLeague(owner, S({ games: ['pickem', 'daily'], scoring: 'rank', dropWorst: true, maxMembers: 9, lateJoins: true }));
  assert.match(r.joinCode, /^[A-Z2-9]{6}$/);
  assert.match(r.inviteToken, /^[A-Z2-9]{12}$/);
  const [lg] = await sql`SELECT * FROM player_leagues WHERE id = ${r.leagueId}`;
  assert.equal(lg.span, 'season'); assert.equal(lg.scoring, 'rank'); assert.equal(lg.format, 'table');
  assert.equal(lg.drop_worst, true); assert.equal(lg.max_members, 9); assert.equal(lg.late_joins, true);
  assert.equal(lg.start_week, 99, 'a week game anchors on the NFL week');
  assert.equal(String(lg.start_date instanceof Date ? lg.start_date.toISOString().slice(0, 10) : lg.start_date).slice(0, 10), '2099-01-01');
  assert.equal(new Date(lg.starts_at).toISOString(), '2099-01-01T00:00:00.000Z', 'the earliest anchor');
  const games = await sql`SELECT game_type, sport FROM player_league_games WHERE league_id = ${r.leagueId} ORDER BY game_type, sport`;
  assert.deepEqual(games.map((g) => `${g.game_type}:${g.sport}`), ['daily:all', 'pickem:cfb', 'pickem:nfl']);
  assert.equal(await memberCount(r.leagueId), 1, 'the owner is member #1');
  const mine = await core.myLeagues(owner);
  const card = mine.find((l) => l.id === r.leagueId);
  assert.deepEqual(card.games, ['pickem', 'daily']);
  assert.equal(card.mine, true);
});

test('create refuses a total-points bundle and Survivor while its flag is off - and writes nothing', async () => {
  const before = (await sql`SELECT count(*)::int n FROM player_leagues WHERE owner_id = ${owner}`)[0].n;
  const bundle = await core.createLeague(owner, 'Test invite bundle', S({ games: ['pickem', 'weekly'] }), { anchors: FUTURE, survivor: false });
  assert.equal(bundle.ok, false);
  assert.equal(bundle.reason, SETTING_REFUSALS.total_one_game);
  const surv = await core.createLeague(owner, 'Test invite surv', S({ games: ['survivor'] }), { anchors: FUTURE, survivor: false });
  assert.equal(surv.reason, SETTING_REFUSALS.survivor_off);
  const after = (await sql`SELECT count(*)::int n FROM player_leagues WHERE owner_id = ${owner}`)[0].n;
  assert.equal(after, before);
});

test('join by the typed code and by the link token; the preview never writes', async () => {
  const r = await mkLeague(owner, S());
  const p = await invite.invitePreview(r.inviteToken, a);
  assert.equal(p.ok, true);
  assert.equal(p.league.name.startsWith('Test invite'), true);
  assert.equal(p.league.members, 1);
  assert.deepEqual(p.league.games, ['daily']);
  assert.equal(p.league.join_code, undefined, 'the preview never hands out the code');
  assert.equal(p.league.invite_token, undefined, 'or the token');
  assert.equal(await memberCount(r.leagueId), 1, 'a preview is a read');

  const viaToken = await invite.joinByInvite(a, r.inviteToken.toLowerCase());
  assert.equal(viaToken.ok, true); assert.equal(viaToken.leagueId, r.leagueId);
  const viaCode = await core.joinLeague(b, r.joinCode);
  assert.equal(viaCode.ok, true);
  const again = await invite.joinByInvite(a, r.joinCode);
  assert.deepEqual([again.ok, again.already], [true, true], 'joining twice is a no-op, never a refusal');
  assert.equal(await memberCount(r.leagueId), 3);
  const pIn = await invite.invitePreview(r.joinCode, a);
  assert.equal(pIn.already, true);

  assert.equal((await invite.joinByInvite(c, 'ABC')).reason, REFUSALS.not_a_code);
  assert.equal((await invite.joinByInvite(c, 'ZZZZZZZZZZZZ')).reason, REFUSALS.dead_link);
  assert.equal((await invite.joinByInvite(null, r.joinCode)).reason, REFUSALS.signed_out);
});

test('THE CAP: refused when full, and a race for the last seats never overfills', async () => {
  const r = await mkLeague(owner, S({ maxMembers: 2 }));
  assert.equal((await invite.joinByInvite(a, r.joinCode)).ok, true);
  const full = await invite.joinByInvite(b, r.joinCode);
  assert.equal(full.ok, false);
  assert.equal(full.reason, REFUSALS.full);
  assert.equal((await invite.invitePreview(r.inviteToken, b)).reason, 'full', 'the preview says so before the tap');
  assert.equal(await memberCount(r.leagueId), 2);

  // Owner + two seats; four friends tap at once.
  const race = await mkLeague(owner, S({ maxMembers: 3 }));
  const res = await Promise.all([a, b, c, d].map((u) => invite.joinByInvite(u, race.inviteToken)));
  assert.equal(res.filter((x) => x.ok).length, 2, 'two seats, two winners');
  assert.ok(res.filter((x) => !x.ok).every((x) => x.reason === REFUSALS.full));
  assert.equal(await memberCount(race.leagueId), 3, 'never past max_members');
});

test('THE START LINE: refused after starts_at unless late joins are on', async () => {
  const shut = await mkLeague(owner, S({ lateJoins: false }), PAST);
  const late = await invite.joinByInvite(a, shut.joinCode);
  assert.equal(late.ok, false);
  assert.equal(late.reason, REFUSALS.started);
  const open = await mkLeague(owner, S({ lateJoins: true }), PAST);
  assert.equal((await invite.joinByInvite(a, open.joinCode)).ok, true);
  const before = await mkLeague(owner, S({ lateJoins: false }), FUTURE);
  assert.equal((await invite.joinByInvite(a, before.joinCode)).ok, true, 'before the start, the door is open');
});

test('THE RESET: owner only; the old code and the old token are dead, the new ones work', async () => {
  const r = await mkLeague(owner, S());
  assert.equal((await invite.joinByInvite(a, r.joinCode)).ok, true);
  const no = await invite.resetInvite(a, r.leagueId);
  assert.equal(no.ok, false);
  assert.equal(no.reason, REFUSALS.not_owner, 'a member cannot rotate the door');

  const yes = await invite.resetInvite(owner, r.leagueId);
  assert.equal(yes.ok, true);
  assert.notEqual(yes.joinCode, r.joinCode);
  assert.notEqual(yes.inviteToken, r.inviteToken);
  const [row] = await sql`SELECT code_reset_at FROM player_leagues WHERE id = ${r.leagueId}`;
  assert.ok(row.code_reset_at, 'the reset is stamped');

  assert.equal((await invite.joinByInvite(b, r.joinCode)).reason, REFUSALS.no_league, 'old code: no league');
  assert.equal((await invite.joinByInvite(b, r.inviteToken)).reason, REFUSALS.dead_link, 'old link: reset');
  assert.equal((await invite.invitePreview(r.inviteToken, b)).reason, 'dead_link');
  assert.equal((await invite.joinByInvite(b, yes.inviteToken)).ok, true);
  assert.equal((await invite.joinByInvite(c, yes.joinCode)).ok, true);
});

test("MIGRATION 122's BACKFILL: a pre-V1 league becomes Daily-only, total, open - and a re-run changes nothing", async () => {
  const [lg] = await sql`
    INSERT INTO player_leagues (name, owner_id, join_code, created_at)
    VALUES ('Test invite legacy', ${owner}, ${`T${String(Date.now()).slice(-5).replace(/[01]/g, '2')}`.slice(0, 6)}, '2026-08-20T15:00:00Z')
    RETURNING id`;
  leagueIds.push(lg.id);
  await sql`INSERT INTO league_members (league_id, user_id) VALUES (${lg.id}, ${owner}), (${lg.id}, ${a})`;
  const file = readFileSync(path.join(REPO, 'migrations/122_leagues_v1.sql'), 'utf8');
  const body = file.slice(file.indexOf('UPDATE player_leagues l'), file.lastIndexOf('COMMIT;'));
  // The two backfill statements, scoped to THIS fixture so a parallel run's
  // leagues are never touched: every "WHERE NOT EXISTS" gains "l.id = <id> AND".
  const stmts = body.split(';').map((s) => s.trim()).filter(Boolean)
    .map((s) => s.replace('WHERE NOT EXISTS', `WHERE l.id = ${Number(lg.id)} AND NOT EXISTS`));
  assert.equal(stmts.length, 2, 'one UPDATE, one INSERT');
  for (let run = 0; run < 2; run += 1) for (const s of stmts) await sql.query(s);
  const [after] = await sql`SELECT span, scoring, format, drop_worst, late_joins, max_members, starts_at, start_date::text AS sd FROM player_leagues WHERE id = ${lg.id}`;
  assert.deepEqual(
    { span: after.span, scoring: after.scoring, format: after.format, drop: after.drop_worst, late: after.late_joins, max: after.max_members, sd: after.sd },
    { span: 'season', scoring: 'total', format: 'table', drop: false, late: true, max: 12, sd: '2026-08-20' });
  assert.equal(new Date(after.starts_at).toISOString(), '2026-08-20T15:00:00.000Z');
  const games = await sql`SELECT game_type, sport FROM player_league_games WHERE league_id = ${lg.id}`;
  assert.deepEqual(games, [{ game_type: 'daily', sport: 'all' }], 'Daily only, once - the second run added nothing');
  // and the old code still joins (late joins on, under the cap)
  assert.equal((await core.joinLeague(b, (await sql`SELECT join_code FROM player_leagues WHERE id = ${lg.id}`)[0].join_code)).ok, true);
});

test('the cap is a lock: the join locks the league row before it re-counts', () => {
  const t = readFileSync(path.join(REPO, 'lib/leagues/invite.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const fn = t.slice(t.indexOf('export async function joinByInvite'), t.indexOf('export async function resetInvite'));
  assert.match(fn, /sql\.transaction\(\[\s*sql`SELECT id FROM player_leagues WHERE id = \$\{lg\.id\} FOR UPDATE`/);
  assert.match(fn, /< l\.max_members/);
  assert.match(fn, /isolationLevel: 'ReadCommitted'/, 'the re-count needs a fresh snapshot after the lock');
});
