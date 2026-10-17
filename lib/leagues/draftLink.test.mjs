// lib/leagues/draftLink.test.mjs - Leagues slice 3, option B (fri-3): a Fantrax
// draft league linked to a player league. Link integrity, keepers (and every
// draft-side row) unchanged, the /join redirect, members and roles across the
// two tables, size = teams.
//
// Fixture: SENTINEL users (dltest-...@example.invalid - "test" in the address,
// found by scripts/dev-orphan-sweep.mjs), one fantrax config "Test link ..."
// with 12 teams, 3 keepers, a live and an expired invite. after() deletes every
// one and asserts it did.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const dl = await import('./draftLink.js');
const ls = await import('../fantasy/leagueShare.js');
const members = await import('./members.js');
const invite = await import('./invite.js');
const core = await import('./core.js');
const nav = await import('./nav.js');
const { getMyLeagues } = await import('../fantasy/drafts.js');
const { REFUSALS } = await import('./code.js');
const { sql } = await import('../db.js');

const NS = `dltest-${process.pid}-${Date.now()}`;
const TEAMS = Array.from({ length: 12 }, (_, i) => ({ name: `Franchise ${i + 1}`, slot: i + 1, isMine: i === 2, fantraxTeamId: `ftx${i + 1}` }));
const U = {};
const configIds = [];
let cfg; let leagueId; let liveCode; let deadCode;

async function mkUser(tag) {
  const [u] = await sql`INSERT INTO users (email) VALUES (${`${NS}-${tag}@example.invalid`}) RETURNING id`;
  return u.id;
}
async function mkConfig(source = 'fantrax', name = 'Test link') {
  const [c] = await sql`INSERT INTO draft_configs (user_id, name, teams_count, scoring_format, roster_slots,
                          pick_timer_seconds, is_preset, source, external_league_id, teams, pool_source)
                        VALUES (${U.owner}, ${`${name} ${NS.slice(-6)}`}, 12, 'ppr',
                          ${JSON.stringify({ QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BN: 6 })}::jsonb,
                          90, false, ${source}, ${`${NS}-${source}`}, ${JSON.stringify(TEAMS)}::jsonb, 'ffc')
                        RETURNING id, user_id, teams`;
  configIds.push(c.id);
  return c;
}

before(async () => {
  for (const k of ['owner', 'a', 'b', 'joiner', 'removed', 'outsider']) U[k] = await mkUser(k);
  cfg = await mkConfig();
  await sql`INSERT INTO draft_config_members (config_id, user_id, role, fantrax_team_id, joined_at) VALUES
              (${cfg.id}, ${U.owner}, 'owner', 'ftx3', '2026-09-01T12:00:00Z'),
              (${cfg.id}, ${U.a}, 'member', 'ftx5', '2026-09-02T12:00:00Z'),
              (${cfg.id}, ${U.b}, 'member', NULL, '2026-09-03T12:00:00Z')`;
  await sql`INSERT INTO draft_config_keepers (config_id, team_slot, round, pick_in_round, fantrax_player_id, player_name, position, fantrax_team_id)
            VALUES (${cfg.id}, 3, 1, 3, 'p1', 'Keeper One', 'WR', 'ftx3'),
                   (${cfg.id}, 5, 2, 8, 'p2', 'Keeper Two', 'RB', 'ftx5'),
                   (${cfg.id}, 3, 4, 10, 'p3', 'Keeper Three', 'QB', 'ftx3')`;
  liveCode = ls.makeInviteCode(); deadCode = ls.makeInviteCode();
  await sql`INSERT INTO draft_config_invites (config_id, code, created_by, expires_at, max_uses) VALUES
              (${cfg.id}, ${liveCode}, ${U.owner}, now() + interval '7 days', 12),
              (${cfg.id}, ${deadCode}, ${U.owner}, now() - interval '1 day', 12)`;
});

after(async () => {
  if (leagueId) await sql`DELETE FROM player_leagues WHERE id = ${leagueId}`;
  await sql`DELETE FROM draft_configs WHERE id = ANY(${configIds})`;
  await sql`DELETE FROM users WHERE email LIKE ${`${NS}-%@example.invalid`}`;
  const [{ n }] = await sql`
    SELECT (SELECT count(*) FROM users WHERE email LIKE ${`${NS}-%@example.invalid`})
         + (SELECT count(*) FROM draft_configs WHERE id = ANY(${configIds}))
         + (SELECT count(*) FROM draft_config_keepers WHERE config_id = ANY(${configIds}))
         + (SELECT count(*) FROM player_leagues WHERE id = ${leagueId ?? -1}) AS n`;
  assert.equal(Number(n), 0, 'teardown left nothing behind');
});

test('PURE: the plan - fantrax only, never twice, owner included, size = teams', () => {
  const base = { id: 1, name: 'X', user_id: 7, source: 'fantrax', teams_count: 12, league_id: null };
  assert.equal(dl.linkPlan(null).code, 'no_config');
  assert.equal(dl.linkPlan({ ...base, source: 'manual' }).code, 'not_fantrax', 'mock rooms stay out');
  assert.equal(dl.linkPlan({ ...base, source: 'tracker' }).code, 'not_fantrax', 'tracker rooms stay out');
  assert.equal(dl.linkPlan({ ...base, league_id: 9 }).code, 'already_linked');
  const p = dl.linkPlan(base, [{ user_id: 8 }, { user_id: 8 }]);
  assert.equal(p.league.maxMembers, 12, 'LEAGUE SIZE = NUMBER OF TEAMS');
  assert.equal(p.league.kind, 'fantasy');
  assert.deepEqual(p.members.map((m) => m.userId).sort(), [7, 8], 'the owner is a member even without a row; each once');
});

test('PURE: the old /join door', () => {
  assert.equal(dl.joinDoor({}), null, 'not linked: render as before');
  assert.equal(dl.joinDoor({ leagueId: 4, member: true, refusal: 'expired' }), '/leagues/4?tab=draft', 'a member goes to the Draft tab, even on a dead code');
  assert.equal(dl.joinDoor({ leagueId: 4, member: false, refusal: null, inviteToken: 'TOKEN' }), '/j/TOKEN', 'a live code walks into the league door');
  assert.equal(dl.joinDoor({ leagueId: 4, member: false, refusal: 'expired', inviteToken: 'TOKEN' }), null, 'a dead code stays dead');
});

test('THE MOVE: dry run writes nothing; apply links once; every draft-side row is unchanged', async () => {
  const dry = await dl.linkConfigToNewLeague(cfg.id);
  assert.equal(dry.ok, true); assert.equal(dry.dryRun, true);
  assert.equal((await sql`SELECT league_id FROM draft_configs WHERE id = ${cfg.id}`)[0].league_id, null, 'dry run wrote nothing');
  const before = await dl.draftCounts(cfg.id);
  assert.equal(before.keepers, 3);

  const res = await dl.linkConfigToNewLeague(cfg.id, { apply: true });
  assert.equal(res.ok, true, res.reason);
  leagueId = res.leagueId;
  assert.deepEqual(res.after, before, 'members, claims, keepers (and their hash), invites, drafts, picks, reads: unchanged');
  assert.equal(res.checks.ok, true, JSON.stringify(res.checks));
  assert.deepEqual(res.wrote, { league_id: leagueId, members: 3, events: 3, linked: 1 });

  const [lg] = await sql`SELECT kind, owner_id, max_members, late_joins, bots_on FROM player_leagues WHERE id = ${leagueId}`;
  assert.deepEqual(lg, { kind: 'fantasy', owner_id: U.owner, max_members: 12, late_joins: true, bots_on: false }, 'size = teams; bots off until the owner says');
  const lm = (await sql`SELECT user_id FROM league_members WHERE league_id = ${leagueId} ORDER BY user_id`).map((r) => r.user_id);
  assert.deepEqual(lm, [U.owner, U.a, U.b].sort((x, y) => x - y));
  const ev = await sql`SELECT user_id, at FROM league_events WHERE league_id = ${leagueId} AND kind = 'join' ORDER BY at`;
  assert.equal(new Date(ev[0].at).toISOString(), '2026-09-01T12:00:00.000Z', 'join lines at the original join time');

  assert.equal((await dl.linkConfigToNewLeague(cfg.id, { apply: true })).code, 'already_linked', 'never twice');
  assert.equal((await sql`SELECT count(*)::int n FROM player_leagues WHERE owner_id = ${U.owner} AND kind = 'fantasy'`)[0].n, 1, 'and no second league');
});

test('LINK INTEGRITY: the database refuses a non-fantrax link', async () => {
  const manual = await mkConfig('manual', 'Test link manual');
  await assert.rejects(sql`UPDATE draft_configs SET league_id = ${leagueId} WHERE id = ${manual.id}`, /draft_configs_league_fantrax_check/);
  assert.equal((await dl.linkConfigToNewLeague(manual.id, { apply: true })).code, 'not_fantrax');
});

test('MEMBERS AND ROLES: a league joiner reads the draft and claims on first use; the draft door is the league\'s', async () => {
  const [{ join_code: code }] = await sql`SELECT join_code FROM player_leagues WHERE id = ${leagueId}`;
  assert.equal((await invite.joinByInvite(U.joiner, code)).ok, true);
  assert.equal(await ls.memberRole(U.joiner, cfg.id), 'member', 'admitted through the league');
  assert.equal(await ls.memberRole(U.outsider, cfg.id), null);
  assert.ok((await getMyLeagues(U.joiner)).some((l) => l.id === cfg.id && l.league_id === leagueId), '/sim lists it, with the league link');
  const claim = await ls.claimFranchise(U.joiner, cfg.id, 'ftx7');
  assert.equal(claim.ok, true);
  const [row] = await sql`SELECT role, fantrax_team_id FROM draft_config_members WHERE config_id = ${cfg.id} AND user_id = ${U.joiner}`;
  assert.deepEqual(row, { role: 'member', fantrax_team_id: 'ftx7' }, 'the claim wrote their own row');
  assert.equal((await ls.claimFranchise(U.joiner, cfg.id, 'ftx5')).reason, 'franchise_taken', 'the claim race is still the index\'s');

  // The draft side's own doors are closed for a linked config.
  assert.equal((await ls.createInvite(U.owner, cfg.id)).reason, 'use_league_invite');
  assert.equal((await ls.redeemInvite(U.outsider, liveCode)).reason, 'use_league_invite', 'the old code adds nobody around the league');
  assert.equal((await ls.leaveLeague(U.a, cfg.id)).reason, 'managed_by_league');
  assert.equal((await ls.kickMember(U.owner, cfg.id, U.a)).reason, 'managed_by_league');

  // Leaving the LEAGUE frees the franchise; a removal frees it and keeps them out.
  assert.equal((await members.leaveLeague(U.joiner, leagueId)).ok, true);
  assert.equal((await sql`SELECT count(*)::int n FROM draft_config_members WHERE config_id = ${cfg.id} AND user_id = ${U.joiner}`)[0].n, 0);
  assert.equal((await members.removeMember(U.owner, leagueId, U.a)).ok, true);
  assert.equal((await sql`SELECT count(*)::int n FROM draft_config_members WHERE config_id = ${cfg.id} AND user_id = ${U.a}`)[0].n, 0, 'the two tables agree');
  assert.equal(await ls.memberRole(U.a, cfg.id), null);
  assert.equal((await invite.joinByInvite(U.a, code)).reason, REFUSALS.removed, 'and the league door refuses them');
  assert.equal((await sql`SELECT count(*)::int n FROM draft_config_members WHERE config_id = ${cfg.id} AND role = 'owner' AND user_id = ${U.owner}`)[0].n, 1, 'the owner row is never touched');
  assert.equal((await dl.draftCounts(cfg.id)).keepers, 3, 'keepers untouched by any of it');
});

test('/join REDIRECTS: a member to the Draft tab, a live code into /j/, a dead code renders as before', async () => {
  const [{ invite_token: token }] = await sql`SELECT invite_token FROM player_leagues WHERE id = ${leagueId}`;
  assert.equal(dl.joinDoor(await ls.inviteLeagueDoor(liveCode, U.owner)), `/leagues/${leagueId}?tab=draft`);
  assert.equal(dl.joinDoor(await ls.inviteLeagueDoor(liveCode, U.outsider)), `/j/${token}`);
  assert.equal(dl.joinDoor(await ls.inviteLeagueDoor(deadCode, U.outsider)), null);
  const page = src('app/join/[code]/page.js');
  assert.ok(page.indexOf('joinDoor(') > 0 && page.indexOf('joinDoor(') < page.indexOf('invitePreview(code, userId)'), 'the redirect comes before the render');
});

test('SIZE = TEAMS: the league door caps at the number of teams', async () => {
  const lg = { members: 12, max_members: 12, late_joins: true, starts_at: null };
  assert.equal(invite.joinRefusal(lg), 'full');
  assert.equal((await sql`SELECT max_members FROM player_leagues WHERE id = ${leagueId}`)[0].max_members, 12);
});

test('THE LEAGUE HOME: Draft tab only for a linked league; it opens on Draft when there are no games', async () => {
  const draftOnly = nav.leagueTabs({ hasDraft: true, hasGames: false }).map((t) => t.key);
  assert.deepEqual(draftOnly, ['draft', 'chat', 'members']);
  assert.equal(nav.landingTab('standings', nav.leagueTabs({ hasDraft: true, hasGames: false })), 'draft');
  assert.deepEqual(nav.leagueTabs({ hasDraft: true, hasGames: true }).map((t) => t.key), ['draft', 'standings', 'today', 'chat', 'members'], 'games beside the draft');
  assert.deepEqual(nav.leagueTabs({}).map((t) => t.key), ['standings', 'today', 'chat', 'members'], 'every other league: unchanged');
  const detail = await core.leagueDetail(leagueId, U.owner);
  assert.equal(detail.draft_config_id, cfg.id);
  assert.equal(detail.kind, 'fantasy');
  const home = await dl.loadDraftHome(cfg.id, U.owner);
  assert.equal(home.franchises.length, 12);
  assert.deepEqual(home.franchises.find((f) => f.slot === 3).keepers.map((k) => k.round), [1, 4]);
  assert.equal(home.franchises.find((f) => f.slot === 3).manager.userId, U.owner);
  assert.deepEqual(home.me.claimed, { slot: 3, name: 'Franchise 3' });
  assert.equal((await dl.setBotsOn(U.b, leagueId, true)).ok, false, 'only the owner turns bots on');
  assert.equal((await dl.setBotsOn(U.owner, leagueId, true)).botsOn, true);
});
