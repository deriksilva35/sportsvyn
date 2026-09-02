// lib/fantasy/leagueShare.test.mjs - league sharing (085), against DEV.
//
// node --test. Sentinel users only (simtest-*@example.invalid), deleted in
// after() - the users cascade takes their configs, members, invites and runs.
// Run: node --test lib/fantasy/leagueShare.test.mjs

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
(function loadEnv(p) {
  let t; try { t = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of t.split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const k = s.slice(0, eq).trim();
    let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.join(REPO, '.env.local'));

const { neon } = await import('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
const ls = await import('./leagueShare.js');
const d = await import('./drafts.js');

const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const MARK = 'simtest-share-%@example.invalid';
async function wipe() { await sql`DELETE FROM users WHERE email LIKE ${MARK}`; }
async function mkUser(tag) {
  return (await sql`INSERT INTO users (name, email, handle) VALUES (${'Share ' + tag}, ${`simtest-share-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.invalid`}, ${`share_${tag}_${Date.now().toString(36)}`}) RETURNING id`)[0].id;
}
const TEAMS = Array.from({ length: 12 }, (_, i) => ({
  slot: i + 1, name: `Team ${i + 1}`, fantraxTeamId: `ftx${i + 1}`, isMine: i + 1 === 3,
}));
// Mirrors the import (lib/fantrax/import.js): the config row, then the
// owner's members row tied to the isMine franchise.
async function mkLeague(ownerId, tag) {
  const [c] = await sql`INSERT INTO draft_configs (user_id, name, teams_count, scoring_format, roster_slots,
                          pick_timer_seconds, is_preset, source, external_league_id, teams, pool_source)
                        VALUES (${ownerId}, ${'Share League ' + tag}, 12, 'ppr',
                          ${JSON.stringify({ QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BN: 6 })}::jsonb,
                          90, false, 'fantrax', ${'sharetest-' + tag + '-' + Date.now()}, ${JSON.stringify(TEAMS)}::jsonb, 'ffc')
                        RETURNING id, user_id, teams`;
  await sql`INSERT INTO draft_config_members (config_id, user_id, role, fantrax_team_id) VALUES (${c.id}, ${ownerId}, 'owner', 'ftx3')`;
  return c;
}

let U = {}, L;
before(async () => {
  await wipe();
  for (const tag of ['owner', 'b', 'c', 'x', 'y', 'z', 'stranger']) U[tag] = await mkUser(tag);
  L = await mkLeague(U.owner, 'main');
});
after(wipe);

// ---- backfill ---------------------------------------------------------------
test('085 backfill: every owned config has an owner row, and the fantrax owner is tied to the isMine franchise', async () => {
  const [{ n: missing }] = await sql`SELECT count(*)::int AS n FROM draft_configs c
     WHERE c.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM draft_config_members m WHERE m.config_id = c.id AND m.user_id = c.user_id AND m.role = 'owner')`;
  assert.equal(missing, 0, 'no owned config without its owner row');
  const rows = await sql`SELECT c.id, m.fantrax_team_id,
       (SELECT t->>'fantraxTeamId' FROM jsonb_array_elements(c.teams) t WHERE (t->>'isMine')::boolean LIMIT 1) AS mine
     FROM draft_configs c JOIN draft_config_members m ON m.config_id = c.id AND m.role = 'owner'
     WHERE c.source = 'fantrax'`;
  assert.ok(rows.length >= 1, 'at least one fantrax league on DEV');
  for (const r of rows) assert.equal(r.fantrax_team_id, r.mine, `config ${r.id}: owner tie = isMine`);
});

// ---- codes ---------------------------------------------------------------------
test('invite codes: 8 chars of the no-lookalike alphabet; normalize forgives case, spaces and hyphens, and nothing else', () => {
  const code = ls.makeInviteCode();
  assert.equal(code.length, 8);
  assert.match(code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
  assert.equal(ls.normalizeInviteCode(' abcd-efgh '), 'ABCDEFGH');
  assert.equal(ls.normalizeInviteCode('ABCDEFG'), null, 'seven is not a code');
  assert.equal(ls.normalizeInviteCode('ABCDEFGO'), null, 'O is not in the alphabet');
  assert.equal(ls.normalizeInviteCode(null), null);
});

// ---- access ---------------------------------------------------------------------
test('ACCESS RULE: owner reads, stranger does not; only the owner mints or revokes', async () => {
  assert.equal(await ls.memberRole(U.owner, L.id), 'owner');
  assert.equal(await ls.memberRole(U.stranger, L.id), null);
  assert.equal(await ls.canReadConfig(U.owner, L), true);
  assert.equal(await ls.canReadConfig(U.stranger, L), false);
  assert.equal(await ls.canReadConfig(null, L), false);
  assert.deepEqual(await ls.createInvite(U.stranger, L.id), { ok: false, reason: 'not_owner' });
  assert.deepEqual(await ls.revokeInvites(U.stranger, L.id), { ok: false, reason: 'not_owner' });
  // The list: the owner's card, nobody else's.
  const mine = await d.getMyLeagues(U.owner);
  assert.equal(mine.filter((l) => l.id === L.id).length, 1);
  assert.equal((await d.getMyLeagues(U.stranger)).filter((l) => l.id === L.id).length, 0);
  const card = mine.find((l) => l.id === L.id);
  assert.equal(card.role, 'owner');
  assert.equal(card.default_seat, 3, 'the owner defaults to the isMine franchise');
  assert.equal(card.members.length, 1);
  assert.equal(card.invite, null, 'no live code until Share is tapped');
  // A stranger cannot start a run from it.
  assert.deepEqual(await d.startLeagueDraftFor(U.stranger, L.id, {}), { ok: false, reason: 'league_not_found' });
});

// ---- invite + claim -------------------------------------------------------------
let CODE;
test('the owner mints ONE live code; a second mint retires the first', async () => {
  const one = await ls.createInvite(U.owner, L.id);
  assert.equal(one.ok, true);
  assert.equal(one.invite.maxUses, 12);
  assert.equal(one.invite.uses, 0);
  const days = (new Date(one.invite.expiresAt) - Date.now()) / 86400e3;
  assert.ok(days > 13.9 && days <= 14.01, `expires in ~14 days, got ${days}`);
  const two = await ls.createInvite(U.owner, L.id);
  assert.equal(two.ok, true);
  assert.notEqual(two.invite.code, one.invite.code);
  assert.equal((await ls.activeInvite(L.id)).code, two.invite.code, 'the newest is the live one');
  const pv = await ls.invitePreview(one.invite.code, U.b);
  assert.equal(pv.ok, false);
  assert.equal(pv.reason, 'revoked');
  assert.equal(pv.league.name, 'Share League main', 'a dead code still names its league');
  CODE = two.invite.code;
  const card = (await d.getMyLeagues(U.owner)).find((l) => l.id === L.id);
  assert.equal(card.invite.code, CODE, 'the owner\'s card carries the live code');
});

test('preview is a read: no membership until the tap; franchises list the owner\'s claim', async () => {
  const pv = await ls.invitePreview(CODE.toLowerCase(), U.b);
  assert.equal(pv.ok, true);
  assert.equal(pv.league.id, L.id);
  assert.equal(pv.franchises.length, 12);
  assert.equal(pv.franchises[2].claimedBy?.mine, false);
  assert.equal(pv.franchises[2].claimedBy?.handle?.startsWith('share_owner'), true);
  assert.equal(pv.franchises[4].claimedBy, null);
  assert.equal(pv.alreadyMember, false);
  assert.equal(await ls.memberRole(U.b, L.id), null, 'preview wrote nothing');
  assert.equal((await ls.activeInvite(L.id)).uses, 0, 'preview is not a use');
});

test('redeem: join + claim in one tap; re-tapping is idempotent and not a use; default seat = the claimed column', async () => {
  const r = await ls.redeemInvite(U.b, CODE, 'ftx5');
  assert.deepEqual(r, { ok: true, configId: L.id, joined: true, role: 'member', claimed: true, slot: 5 });
  assert.equal((await ls.activeInvite(L.id)).uses, 1);
  const again = await ls.redeemInvite(U.b, CODE);
  assert.equal(again.joined, false);
  assert.equal(again.role, 'member');
  assert.equal((await ls.activeInvite(L.id)).uses, 1, 'a member re-tapping is not a use');
  assert.equal(await ls.canReadConfig(U.b, L), true);
  const card = (await d.getMyLeagues(U.b)).find((l) => l.id === L.id);
  assert.ok(card, 'the member sees the league');
  assert.equal(card.role, 'member');
  assert.equal(card.default_seat, 5, 'the member defaults to their claimed franchise');
  assert.equal(card.invite, null, 'a member never sees the code');
  assert.equal(card.members.length, 2);
  assert.equal(card.members.find((m) => m.userId === U.b).teamName, 'Team 5');
  // The wire cannot rename the league through a member.
  const pv = await ls.invitePreview(CODE, U.b);
  assert.equal(pv.alreadyMember, true);
  assert.equal(pv.franchises[4].claimedBy.mine, true);
});

test('CLAIM RACE: two members tapping one franchise at once - exactly one claim, decided by the partial unique', async () => {
  await ls.redeemInvite(U.c, CODE);
  await ls.redeemInvite(U.x, CODE);
  const [a, b] = await Promise.all([ls.claimFranchise(U.c, L.id, 'ftx7'), ls.claimFranchise(U.x, L.id, 'ftx7')]);
  const oks = [a, b].filter((r) => r.ok);
  const lost = [a, b].filter((r) => !r.ok);
  assert.equal(oks.length, 1, 'one winner');
  assert.equal(lost.length, 1);
  assert.equal(lost[0].reason, 'franchise_taken');
  const holders = await sql`SELECT user_id FROM draft_config_members WHERE config_id = ${L.id} AND fantrax_team_id = 'ftx7'`;
  assert.equal(holders.length, 1, 'the index holds one row for the franchise');
  // A redeem carrying a taken team: membership stands, the claim is refused.
  const r = await ls.redeemInvite(U.y, CODE, 'ftx7');
  assert.equal(r.ok, true);
  assert.equal(r.joined, true);
  assert.equal(r.claimed, false);
  assert.equal(r.claimReason, 'franchise_taken');
  // A team that is not in the league.
  assert.deepEqual(await ls.claimFranchise(U.y, L.id, 'nope'), { ok: false, reason: 'no_such_franchise' });
  // An unclaimed member has no default seat.
  const card = (await d.getMyLeagues(U.y)).find((l) => l.id === L.id);
  assert.equal(card.default_seat, null);
});

test('MEMBERS NEVER WRITE LEAGUE FACTS: no member API touches draft_configs or draft_config_keepers, and the owner-only gates refuse a member', async () => {
  const core = stripComments(src('lib/fantasy/leagueShare.js'));
  const act = stripComments(src('app/actions/league.js'));
  for (const s of [core, act]) {
    assert.doesNotMatch(s, /UPDATE draft_configs\b/);
    assert.doesNotMatch(s, /INSERT INTO draft_configs\b/);
    assert.doesNotMatch(s, /DELETE FROM draft_configs\b/);
    assert.doesNotMatch(s, /draft_config_keepers/);
  }
  assert.doesNotMatch(act, /INSERT INTO|UPDATE |DELETE FROM/, 'the actions delegate; they hold no SQL');
  assert.deepEqual(await ls.createInvite(U.b, L.id), { ok: false, reason: 'not_owner' });
  assert.deepEqual(await ls.revokeInvites(U.b, L.id), { ok: false, reason: 'not_owner' });
  assert.deepEqual(await ls.kickMember(U.b, L.id, U.c), { ok: false, reason: 'not_owner' });
  assert.deepEqual(await ls.leaveLeague(U.owner, L.id), { ok: false, reason: 'owner_cannot_leave' });
  assert.deepEqual(await ls.kickMember(U.owner, L.id, U.owner), { ok: false, reason: 'owner_cannot_leave' });
  // A member's own row is the only thing a member writes.
  const [before] = await sql`SELECT teams::text AS t, name, user_id FROM draft_configs WHERE id = ${L.id}`;
  await ls.claimFranchise(U.b, L.id, 'ftx6');
  const [after] = await sql`SELECT teams::text AS t, name, user_id FROM draft_configs WHERE id = ${L.id}`;
  assert.deepEqual(after, before, 'a claim does not touch the config row');
});

test('leave frees the franchise; kick is the owner\'s and frees it too', async () => {
  const winner = (await sql`SELECT user_id FROM draft_config_members WHERE config_id = ${L.id} AND fantrax_team_id = 'ftx7'`)[0].user_id;
  const kicked = await ls.kickMember(U.owner, L.id, winner);
  assert.equal(kicked.ok, true);
  assert.equal(await ls.memberRole(winner, L.id), null);
  const r = await ls.claimFranchise(U.y, L.id, 'ftx7');
  assert.equal(r.ok, true, 'the kicked member\'s franchise is free');
  assert.equal(r.slot, 7);
  assert.deepEqual(await ls.leaveLeague(U.y, L.id), { ok: true });
  assert.equal(await ls.memberRole(U.y, L.id), null);
  assert.deepEqual(await ls.leaveLeague(U.y, L.id), { ok: false, reason: 'not_a_member' });
  assert.equal((await sql`SELECT 1 FROM draft_config_members WHERE config_id = ${L.id} AND fantrax_team_id = 'ftx7'`).length, 0, 'ftx7 is open again');
  assert.equal(await ls.canReadConfig(U.y, L), false, 'gone is gone');
});

test('invite gates: expired, full (guarded count, no thirteenth row), revoked', async () => {
  // expiry
  await sql`UPDATE draft_config_invites SET expires_at = now() - interval '1 minute' WHERE code = ${CODE}`;
  assert.deepEqual(await ls.redeemInvite(U.z, CODE), { ok: false, reason: 'expired' });
  assert.equal((await ls.invitePreview(CODE, U.z)).reason, 'expired');
  assert.equal(await ls.activeInvite(L.id), null, 'an expired code is not live');
  await sql`UPDATE draft_config_invites SET expires_at = now() + interval '1 day' WHERE code = ${CODE}`;
  // max_uses: one seat left, two strangers at once -> one joins, one 'full'
  const [{ uses }] = await sql`SELECT uses FROM draft_config_invites WHERE code = ${CODE}`;
  await sql`UPDATE draft_config_invites SET max_uses = ${uses + 1} WHERE code = ${CODE}`;
  const fresh1 = await mkUser('r1'); const fresh2 = await mkUser('r2');
  const res = await Promise.all([ls.redeemInvite(fresh1, CODE), ls.redeemInvite(fresh2, CODE)]);
  assert.equal(res.filter((r) => r.ok).length, 1, 'one seat, one join');
  assert.equal(res.filter((r) => !r.ok && r.reason === 'full').length, 1);
  const [{ uses: u2, max_uses }] = await sql`SELECT uses, max_uses FROM draft_config_invites WHERE code = ${CODE}`;
  assert.equal(u2, max_uses, 'uses never exceeds max_uses');
  assert.equal(await ls.activeInvite(L.id), null, 'a full code is not live');
  assert.equal((await ls.invitePreview(CODE)).reason, 'full');
  // a member re-tapping a full code is still fine (not a use)
  assert.equal((await ls.redeemInvite(U.b, CODE)).ok, false, 'full is full even for a member - the gate reads first');
  await sql`UPDATE draft_config_invites SET max_uses = 12 WHERE code = ${CODE}`;
  // revoke
  const rv = await ls.revokeInvites(U.owner, L.id);
  assert.equal(rv.ok, true);
  assert.equal(rv.revoked, 1);
  assert.deepEqual(await ls.redeemInvite(U.z, CODE), { ok: false, reason: 'revoked' });
  assert.equal(await ls.activeInvite(L.id), null);
  assert.equal((await ls.redeemInvite(U.z, 'ZZZZZZZZ')).reason, 'invalid_code');
  assert.equal((await ls.redeemInvite(U.z, 'bad')).reason, 'invalid_code');
});

// ---- runs + mocks ---------------------------------------------------------------
test('a member starts a run from their claimed franchise; the run is theirs alone; the mocks list shows completed only, hidden to its owner only', async () => {
  // U.b claimed ftx6 above -> default seat 6.
  const start = await d.startLeagueDraftFor(U.b, L.id, {});
  assert.equal(start.ok, true, JSON.stringify(start));
  const [row] = await sql`SELECT user_id, config_id, pick_position, user_seat, status FROM drafts WHERE id = ${start.draftId}`;
  assert.equal(row.user_id, U.b);
  assert.equal(row.config_id, L.id);
  assert.equal(row.pick_position, 6, 'the claimed franchise\'s column');
  assert.equal(row.user_seat, 6);
  // The owner cannot open the member's run (drafts stay per-user).
  assert.equal(await d.getDraft(start.draftId, U.owner), null);
  assert.ok(await d.getDraft(start.draftId, U.b));
  // An unclaimed member must send a seat. (U.z joins on a fresh code - the race
  // above left one of c/x kicked, and which one is the index's call.)
  const fresh = await ls.createInvite(U.owner, L.id);
  assert.equal((await ls.redeemInvite(U.z, fresh.invite.code)).joined, true);
  assert.deepEqual(await d.startLeagueDraftFor(U.z, L.id, {}), { ok: false, reason: 'no_seat' });
  const explicit = await d.startLeagueDraftFor(U.z, L.id, { seat: 2 });
  assert.equal(explicit.ok, true);
  // Mocks: in_progress never shows.
  assert.equal((await ls.leagueMocks(L.id, U.owner)).length, 0, 'in-progress runs are nobody\'s business');
  // Complete one with three user picks; abandon another; hide a third.
  await sql`UPDATE drafts SET status = 'completed', completed_at = now() WHERE id = ${start.draftId}`;
  // Seat 6's picks in snake order: 6, 19, 30, 43. The third is picked_by 'ai'
  // (an auto turn) and still counts - the seat is the run's, whoever clicked.
  const names = ['Alpha One', 'Bravo Two', 'Charlie Three', 'Delta Four'];
  const overalls = [6, 19, 30, 43];
  for (let i = 0; i < 4; i += 1) {
    await sql`INSERT INTO draft_picks (draft_id, round, overall_pick, roster_slot, ffc_player_id, player_name, position, picked_by, adp_at_pick, picked_at, is_keeper)
              VALUES (${start.draftId}, ${i + 1}, ${overalls[i]}, ${i + 1}, ${900000 + i}, ${names[i]}, 'RB', ${i === 2 ? 'ai' : 'user'}, 1, now(), false)`;
  }
  // Another seat's pick in round 2, ahead of seat 6's, must not appear.
  await sql`INSERT INTO draft_picks (draft_id, round, overall_pick, roster_slot, ffc_player_id, player_name, position, picked_by, adp_at_pick, picked_at, is_keeper)
            VALUES (${start.draftId}, 2, 13, 2, 900100, 'Seat Twelve', 'WR', 'ai', 1, now(), false)`;
  // The start itself made the bots' picks 1..5 (seat 6 is on the clock); they are 'ai' and must not appear.
  const [{ n: bots }] = await sql`SELECT count(*)::int AS n FROM draft_picks WHERE draft_id = ${start.draftId} AND picked_by = 'ai' AND overall_pick < 6`;
  assert.equal(bots, 5, 'five bot picks ahead of seat 6');
  await sql`UPDATE drafts SET status = 'abandoned' WHERE id = ${explicit.draftId}`;
  const hiddenRun = await d.startLeagueDraftFor(U.z, L.id, { seat: 4 });
  await sql`UPDATE drafts SET status = 'completed', completed_at = now() - interval '1 hour' WHERE id = ${hiddenRun.draftId}`;
  assert.deepEqual(await ls.setRunHidden(U.b, hiddenRun.draftId, true), { ok: false, reason: 'not_your_run' });
  assert.deepEqual(await ls.setRunHidden(U.z, hiddenRun.draftId, true), { ok: true });

  const forOwner = await ls.leagueMocks(L.id, U.owner, { teams: L.teams });
  assert.deepEqual(forOwner.map((r) => r.draftId), [start.draftId], 'completed + visible only; abandoned and hidden absent');
  assert.equal(forOwner[0].seat, 6);
  assert.equal(forOwner[0].franchise, 'Team 6');
  assert.equal(forOwner[0].mine, false);
  assert.deepEqual(forOwner[0].firstPicks.map((p) => p.name), ['Alpha One', 'Bravo Two', 'Charlie Three'], 'the first three picks AT THE SEAT, in order - no other seat\'s pick, and an auto turn counts');
  const forC = await ls.leagueMocks(L.id, U.z, { teams: L.teams });
  assert.deepEqual(forC.map((r) => [r.draftId, r.hidden, r.mine]), [[start.draftId, false, false], [hiddenRun.draftId, true, true]], 'the hider sees their hidden run, marked');
  assert.deepEqual(await ls.setRunHidden(U.z, hiddenRun.draftId, false), { ok: true });
  assert.equal((await ls.leagueMocks(L.id, U.owner)).length, 2, 'shown again');
  // The card carries the list.
  const card = (await d.getMyLeagues(U.owner)).find((l) => l.id === L.id);
  assert.equal(card.mocks.length, 2);
  // Ten is the cap.
  for (let i = 0; i < 11; i += 1) {
    await sql`INSERT INTO drafts (user_id, config_id, status, pick_position, pool_snapshot_date, pool_scoring_format, pool_teams_count, started_at, completed_at)
              VALUES (${U.b}, ${L.id}, 'completed', 6, '2026-07-15', 'ppr', 12, now(), now())`;
  }
  assert.equal((await ls.leagueMocks(L.id, U.owner)).length, 10);
  // Tracker runs are not league mocks.
  await sql`INSERT INTO drafts (user_id, config_id, status, pick_position, pool_snapshot_date, pool_scoring_format, pool_teams_count, started_at, completed_at, mode)
            VALUES (${U.b}, ${L.id}, 'completed', 6, '2026-07-15', 'ppr', 12, now(), now() + interval '1 day', 'tracker')`;
  const top = (await ls.leagueMocks(L.id, U.owner))[0];
  assert.notEqual(top.completedAt && new Date(top.completedAt) > new Date(Date.now() + 3600e3), true, 'the tracker row is not on top');
});

test('an owner leaving the app takes the league and its member runs (drafts.config_id CASCADE), so account deletion cannot fail on the FK', async () => {
  const o = await mkUser('del'); const m = await mkUser('delm');
  const cfg = await mkLeague(o, 'del');
  await sql`INSERT INTO draft_config_members (config_id, user_id, role) VALUES (${cfg.id}, ${m}, 'member')`;
  const run = await d.startLeagueDraftFor(m, cfg.id, { seat: 1 });
  assert.equal(run.ok, true);
  const [fk] = await sql`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'drafts'::regclass AND conname = 'drafts_config_id_fkey'`;
  assert.match(fk.def, /ON DELETE CASCADE/);
  await sql`DELETE FROM users WHERE id = ${o}`;
  assert.equal((await sql`SELECT 1 FROM draft_configs WHERE id = ${cfg.id}`).length, 0);
  assert.equal((await sql`SELECT 1 FROM drafts WHERE id = ${run.draftId}`).length, 0, 'the member\'s run of the gone league is gone');
  assert.equal((await sql`SELECT 1 FROM users WHERE id = ${m}`).length, 1, 'the member\'s account is untouched');
});

// ---- source pins -----------------------------------------------------------------
test('SOURCE: the join route carries the code through sign-in; the flow-core reads through the ACCESS RULE; the import writes the owner row; proxy is not widened', () => {
  const page = stripComments(src('app/join/[code]/page.js'));
  assert.match(page, /if \(userId == null\) redirect\(shellSigninHref\(`\/join\/\$\{encodeURIComponent\(code\)\}`, isShell\)\);/, 'signed out -> sign-in with /join/CODE as the callback');
  assert.match(page, /await invitePreview\(code, userId\)/);
  assert.doesNotMatch(page, /redeemInvite/, 'no write on a GET');
  const claim = stripComments(src('components/sim/JoinClaim.js'));
  assert.match(claim, /redeemInvite\(code, fantraxTeamId\)/);
  assert.match(claim, /router\.push\('\/sim'\)/);
  const core = stripComments(src('lib/fantasy/drafts.js'));
  assert.match(core, /if \(!\(await canReadConfig\(userId, config\)\)\) return \{ ok: false, reason: 'league_not_found' \};/);
  // The run belongs to the CALLER: finalizeStart writes config.user_id, which on a league is the importer.
  assert.match(core, /return finalizeStart\(\{ \.\.\.config, user_id: userId \}, seat, \{ \.\.\.opts, franchise: true \}/);
  assert.match(core, /WHERE \(c\.user_id = \$\{uid\} OR m\.user_id IS NOT NULL\) AND c\.source = 'fantrax'/);
  assert.doesNotMatch(core, /FROM draft_configs WHERE id = \$\{configId\} AND user_id = \$\{userId\}/, 'the ownership-only start predicate is gone');
  const imp = stripComments(src('lib/fantrax/import.js'));
  assert.match(imp, /INSERT INTO draft_config_members \(config_id, user_id, role, fantrax_team_id\)\s+VALUES \(\$\{cfg\.id\}, \$\{userId\}, 'owner', \$\{mine\.teamId \?\? null\}\)/);
  const proxy = src('proxy.js');
  assert.doesNotMatch(proxy, /\/join/, 'the join route does its own auth; the matcher is not widened');
  assert.ok(existsSync(path.join(REPO, 'app/join/[code]/page.js')));
  const share = stripComments(src('components/sim/LeagueShare.js'));
  assert.match(share, /`\$\{SITE\}\/join\/\$\{code\}`/);
  assert.match(share, /const SITE = 'https:\/\/sportsvyn\.com';/);
  // The signed-out rule itself, as a value: the code rides inside callbackUrl on both surfaces.
});

test('signInHref round-trip: /join/CODE survives as the callbackUrl on web and in the shell', async () => {
  const { shellSigninHref } = await import('../shell/signinHref.js');
  const web = shellSigninHref('/join/ABCDEFGH', false);
  assert.equal(web, '/signin?callbackUrl=%2Fjoin%2FABCDEFGH');
  const shell = shellSigninHref('/join/ABCDEFGH', true);
  const cb = new URL('https://x' + shell).searchParams.get('callbackUrl');
  assert.ok(cb.startsWith('/join/ABCDEFGH?'), `shell callback carries the code: ${cb}`);
});
