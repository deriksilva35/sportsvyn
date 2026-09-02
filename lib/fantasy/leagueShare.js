// lib/fantasy/leagueShare.js - league sharing: who may read a config, invite
// codes, franchise claims, the league's mocks list.
//
// THE ACCESS RULE IS ONE FUNCTION. canReadConfig(userId, config): the owner
// (draft_configs.user_id) or a draft_config_members row. Every read of a
// league - the card list, the start, the join preview, the mocks list - goes
// through it or through memberRole(), which it wraps. A second predicate
// written by hand somewhere else would be a second place for the rule to drift.
//
// MEMBERS NEVER WRITE LEAGUE FACTS. Nothing in this module or in
// app/actions/league.js touches draft_configs' columns or draft_config_keepers;
// the import (lib/fantrax/import.js, a script entry, the owner's own Fantrax
// credentials) is the only writer, and there is no re-sync action to reach
// from the app. A member writes their OWN membership row (claim, leave), their
// OWN run's hidden flag, and nothing else. Pinned by leagueShare.test.mjs.
//
// THE CLAIM RACE IS THE INDEX'S. draft_config_members_franchise_key (085) is a
// partial unique on (config_id, fantrax_team_id); two members claiming one
// team resolve to one row and one 'franchise_taken', in commit order. This
// module catches that violation and names it; it never pre-checks and then
// writes, because the gap between the check and the write is the race.

import crypto from 'node:crypto';
import { sql } from '../db.js';
// THE CODE AS A VALUE (alphabet, length, normalization, the join path, the
// refusal wording) is lib/fantasy/inviteCode.js - pure, so the lobby's code
// field can import it. Re-exported here so every server caller keeps one name.
import { CODE_ALPHABET, INVITE_CODE_LENGTH, normalizeInviteCode } from './inviteCode.js';
export { CODE_ALPHABET, INVITE_CODE_LENGTH, normalizeInviteCode, joinPath, REFUSALS } from './inviteCode.js';

export const INVITE_DAYS = 14;
export const INVITE_MAX_USES = 12;

export function makeInviteCode(rng = crypto.randomInt) {
  let out = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i += 1) out += CODE_ALPHABET[rng(CODE_ALPHABET.length)];
  return out;
}

// ---------------------------------------------------------------------------
// ACCESS
// ---------------------------------------------------------------------------

/** 'owner' | 'member' | null. The config's user_id is the owner even without a row. */
export async function memberRole(userId, configId) {
  const uid = Number(userId);
  if (!Number.isInteger(uid)) return null;
  const [r] = await sql`
    SELECT CASE WHEN c.user_id = ${uid} THEN 'owner' ELSE m.role END AS role
      FROM draft_configs c
      LEFT JOIN draft_config_members m ON m.config_id = c.id AND m.user_id = ${uid}
     WHERE c.id = ${Number(configId)}
       AND (c.user_id = ${uid} OR m.user_id IS NOT NULL)
     LIMIT 1`;
  return r?.role ?? null;
}

/** THE ACCESS RULE: owner or member may read a league's facts. */
export async function canReadConfig(userId, config) {
  if (!config || userId == null) return false;
  if (Number(config.user_id) === Number(userId)) return true;
  return (await memberRole(userId, config.id)) != null;
}

// ---------------------------------------------------------------------------
// MEMBERS + FRANCHISES
// ---------------------------------------------------------------------------

/** The franchise (teams entry) a member has claimed, or null. */
export function franchiseOf(teams, fantraxTeamId) {
  if (fantraxTeamId == null) return null;
  return (teams ?? []).find((t) => String(t.fantraxTeamId) === String(fantraxTeamId)) ?? null;
}

/**
 * THE DEFAULT SEAT. A claimed franchise's column; for the owner with no claim,
 * the imported isMine seat (what the card defaulted to before sharing). An
 * unclaimed member has no default - the picker opens on seat 1 and the strip
 * shows, and the seat is sent explicitly.
 */
export function defaultSeatFor(config, membership) {
  const claimed = franchiseOf(config?.teams, membership?.fantrax_team_id);
  if (claimed?.slot) return Number(claimed.slot);
  const role = membership?.role ?? (config?.user_id != null && membership?.user_id === config.user_id ? 'owner' : null);
  if (role === 'owner') {
    const mine = (config?.teams ?? []).find((t) => t.isMine === true);
    if (mine?.slot) return Number(mine.slot);
  }
  return null;
}

/** Everyone in the league, with their claimed franchise resolved to a slot + name. */
export async function leagueMembers(configId, teams = null) {
  const rows = await sql`
    SELECT m.user_id, m.role, m.fantrax_team_id, m.joined_at, u.handle, u.name
      FROM draft_config_members m JOIN users u ON u.id = m.user_id
     WHERE m.config_id = ${Number(configId)}
     ORDER BY (m.role = 'owner') DESC, m.joined_at, m.user_id`;
  return rows.map((m) => {
    const f = franchiseOf(teams, m.fantrax_team_id);
    return {
      userId: m.user_id, role: m.role, handle: m.handle ?? null, name: m.name ?? null,
      fantraxTeamId: m.fantrax_team_id, slot: f?.slot ?? null, teamName: f?.name ?? null,
      joinedAt: m.joined_at,
    };
  });
}

const FRANCHISE_KEY = 'draft_config_members_franchise_key';

/**
 * Claim a franchise (or null to release yours). Any member, their own row only.
 * The team must be one of the config's; a taken team is the index's verdict.
 */
export async function claimFranchise(userId, configId, fantraxTeamId) {
  const role = await memberRole(userId, configId);
  if (role == null) return { ok: false, reason: 'not_a_member' };
  let team = null;
  if (fantraxTeamId != null) {
    const [c] = await sql`SELECT teams FROM draft_configs WHERE id = ${Number(configId)} LIMIT 1`;
    team = franchiseOf(c?.teams, fantraxTeamId);
    if (!team) return { ok: false, reason: 'no_such_franchise' };
  }
  try {
    const rows = await sql`
      UPDATE draft_config_members SET fantrax_team_id = ${team ? String(team.fantraxTeamId) : null}
       WHERE config_id = ${Number(configId)} AND user_id = ${Number(userId)}
       RETURNING fantrax_team_id`;
    if (!rows.length) return { ok: false, reason: 'not_a_member' };
    return { ok: true, fantraxTeamId: rows[0].fantrax_team_id, slot: team?.slot ?? null };
  } catch (e) {
    if (String(e?.message ?? '').includes(FRANCHISE_KEY)) return { ok: false, reason: 'franchise_taken' };
    throw e;
  }
}

/** A member leaves; the row goes and the franchise is free. The owner cannot leave. */
export async function leaveLeague(userId, configId) {
  const role = await memberRole(userId, configId);
  if (role == null) return { ok: false, reason: 'not_a_member' };
  if (role === 'owner') return { ok: false, reason: 'owner_cannot_leave' };
  await sql`DELETE FROM draft_config_members
             WHERE config_id = ${Number(configId)} AND user_id = ${Number(userId)} AND role = 'member'`;
  return { ok: true };
}

/** The owner removes a member. Never the owner's own row. */
export async function kickMember(userId, configId, targetUserId) {
  if ((await memberRole(userId, configId)) !== 'owner') return { ok: false, reason: 'not_owner' };
  if (Number(targetUserId) === Number(userId)) return { ok: false, reason: 'owner_cannot_leave' };
  const rows = await sql`DELETE FROM draft_config_members
             WHERE config_id = ${Number(configId)} AND user_id = ${Number(targetUserId)} AND role = 'member'
             RETURNING user_id`;
  return rows.length ? { ok: true } : { ok: false, reason: 'not_a_member' };
}

// ---------------------------------------------------------------------------
// INVITES
// ---------------------------------------------------------------------------

const inviteShape = (i) => (i ? {
  code: i.code, expiresAt: i.expires_at, maxUses: i.max_uses, uses: i.uses,
  revokedAt: i.revoked_at ?? null, createdAt: i.created_at,
} : null);

/** The league's one live code (unrevoked, unexpired, uses left), or null. */
export async function activeInvite(configId) {
  const [i] = await sql`
    SELECT code, expires_at, max_uses, uses, revoked_at, created_at
      FROM draft_config_invites
     WHERE config_id = ${Number(configId)} AND revoked_at IS NULL
       AND expires_at > now() AND uses < max_uses
     ORDER BY created_at DESC LIMIT 1`;
  return inviteShape(i);
}

/**
 * Owner mints a code. ONE LIVE CODE PER LEAGUE: minting revokes the previous
 * one, so "new code" is also "the old link stops working". Retries the string
 * on UNIQUE collision, and only on that.
 */
export async function createInvite(userId, configId) {
  if ((await memberRole(userId, configId)) !== 'owner') return { ok: false, reason: 'not_owner' };
  await sql`UPDATE draft_config_invites SET revoked_at = now()
             WHERE config_id = ${Number(configId)} AND revoked_at IS NULL`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = makeInviteCode();
    try {
      const [row] = await sql`
        INSERT INTO draft_config_invites (config_id, code, created_by, expires_at, max_uses)
        VALUES (${Number(configId)}, ${code}, ${Number(userId)},
                now() + make_interval(days => ${INVITE_DAYS}), ${INVITE_MAX_USES})
        RETURNING code, expires_at, max_uses, uses, revoked_at, created_at`;
      return { ok: true, invite: inviteShape(row) };
    } catch (e) {
      if (!String(e?.message ?? '').includes('draft_config_invites_code_key')) throw e;
    }
  }
  return { ok: false, reason: 'code_collision' };
}

/** Owner revokes every live code. The league stays; only the doors close. */
export async function revokeInvites(userId, configId) {
  if ((await memberRole(userId, configId)) !== 'owner') return { ok: false, reason: 'not_owner' };
  const rows = await sql`UPDATE draft_config_invites SET revoked_at = now()
             WHERE config_id = ${Number(configId)} AND revoked_at IS NULL RETURNING id`;
  return { ok: true, revoked: rows.length };
}

/** Why a code cannot be used, or null when it can. Order: exists, revoked, expired, full. */
export function inviteRefusal(inv, now = new Date()) {
  if (!inv) return 'invalid_code';
  if (inv.revoked_at != null) return 'revoked';
  if (new Date(inv.expires_at) <= now) return 'expired';
  if (inv.uses >= inv.max_uses) return 'full';
  return null;
}

/**
 * What a code-holder sees BEFORE joining: the league's name, size, and its
 * franchises with the claimed ones marked (name + handle). No write on a GET.
 * The refusal, when there is one, still names the league when it can - a dud
 * link should say what it was for, not 404 the friend for the owner's typo.
 */
export async function invitePreview(rawCode, userId = null) {
  const code = normalizeInviteCode(rawCode);
  if (!code) return { ok: false, reason: 'invalid_code', league: null };
  const [inv] = await sql`
    SELECT i.config_id, i.code, i.expires_at, i.max_uses, i.uses, i.revoked_at,
           c.name, c.teams_count, c.teams, c.draft_date, c.user_id
      FROM draft_config_invites i JOIN draft_configs c ON c.id = i.config_id
     WHERE i.code = ${code} LIMIT 1`;
  const refusal = inviteRefusal(inv);
  const league = inv ? { id: inv.config_id, name: inv.name, teamsCount: inv.teams_count, draftDate: inv.draft_date } : null;
  if (refusal) return { ok: false, reason: refusal, league };
  const members = await leagueMembers(inv.config_id, inv.teams);
  const me = userId == null ? null : members.find((m) => Number(m.userId) === Number(userId)) ?? null;
  const claimedBy = new Map(members.filter((m) => m.fantraxTeamId != null).map((m) => [String(m.fantraxTeamId), m]));
  const franchises = [...(inv.teams ?? [])].sort((a, b) => a.slot - b.slot).map((t) => {
    const by = claimedBy.get(String(t.fantraxTeamId)) ?? null;
    return {
      slot: t.slot, name: t.name, fantraxTeamId: String(t.fantraxTeamId),
      claimedBy: by ? { handle: by.handle, name: by.name, mine: me != null && by.userId === me.userId } : null,
    };
  });
  return { ok: true, code, league, franchises, memberCount: members.length, alreadyMember: me != null, myRole: me?.role ?? null };
}

/**
 * Redeem: become a member (idempotent - a member re-tapping the link is not a
 * use), then claim the tapped franchise if any. The use is counted with a
 * guard (uses < max_uses) in the same statement, so twelve friends tapping at
 * once get twelve seats and the thirteenth gets 'full', never a thirteenth
 * row. A taken franchise leaves the membership standing - they are in,
 * unclaimed, and the claim screen says so.
 */
export async function redeemInvite(userId, rawCode, fantraxTeamId = null) {
  const uid = Number(userId);
  if (!Number.isInteger(uid)) return { ok: false, reason: 'unauthenticated' };
  const code = normalizeInviteCode(rawCode);
  if (!code) return { ok: false, reason: 'invalid_code' };
  const [inv] = await sql`
    SELECT i.id, i.config_id, i.expires_at, i.max_uses, i.uses, i.revoked_at, c.user_id AS owner_id
      FROM draft_config_invites i JOIN draft_configs c ON c.id = i.config_id
     WHERE i.code = ${code} LIMIT 1`;
  const refusal = inviteRefusal(inv);
  if (refusal) return { ok: false, reason: refusal };
  const configId = inv.config_id;
  const existing = await memberRole(uid, configId);
  if (existing == null) {
    const used = await sql`UPDATE draft_config_invites SET uses = uses + 1
                            WHERE id = ${inv.id} AND uses < max_uses AND revoked_at IS NULL AND expires_at > now()
                            RETURNING uses`;
    if (!used.length) return { ok: false, reason: 'full' };
    await sql`INSERT INTO draft_config_members (config_id, user_id, role)
              VALUES (${configId}, ${uid}, 'member') ON CONFLICT (config_id, user_id) DO NOTHING`;
  }
  const out = { ok: true, configId, joined: existing == null, role: existing ?? 'member', claimed: false };
  if (fantraxTeamId != null) {
    const claim = await claimFranchise(uid, configId, fantraxTeamId);
    if (claim.ok) { out.claimed = true; out.slot = claim.slot; }
    else out.claimReason = claim.reason;
  }
  return out;
}

// ---------------------------------------------------------------------------
// THE LEAGUE'S MOCKS
// ---------------------------------------------------------------------------

/**
 * YOUR last N COMPLETED runs of this league - and only yours.
 *
 * RUNS ARE PRIVATE (ruling reversed 2 Sep). The first cut listed the league's
 * runs to every member: who, as which franchise, their first three picks, with
 * a per-run hide flag as the escape. Reversed: a member sees exactly their own
 * completed runs on the league card - never another member's, in any state,
 * anywhere - and the owner has no special visibility into members' runs. So the
 * viewer is not a filter on this query, it IS the scope: `d.user_id = viewer`,
 * the same predicate getDraft puts on every room and results read. No viewer,
 * no rows. drafts.hidden_from_league is inert (nothing reads or writes it; it
 * goes in the next migration that touches drafts).
 *
 * "First three picks" are the picks AT THE RUN'S SEAT (snake order from
 * overall_pick, the engine's own geometry), keepers excluded - not
 * picked_by = 'user', because an auto run's picks are all 'ai' and the seat is
 * still the one they played. in_progress and abandoned never appear: a run that
 * is not over is not a result yet, and one walked away from never was.
 */
export async function myLeagueRuns(configId, viewerId, { limit = 10, teams = null } = {}) {
  if (viewerId == null) return [];
  const vid = Number(viewerId);
  const rows = await sql`
    SELECT d.id, d.user_id, d.pick_position, d.completed_at,
           (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', p.player_name, 'position', p.position, 'overall', p.overall_pick)
                            ORDER BY p.overall_pick), '[]'::jsonb)
              FROM (SELECT player_name, position, overall_pick FROM draft_picks p
                     WHERE p.draft_id = d.id AND p.is_keeper IS NOT TRUE
                       AND (CASE WHEN p.round % 2 = 1
                                 THEN ((p.overall_pick - 1) % d.pool_teams_count) + 1
                                 ELSE d.pool_teams_count - ((p.overall_pick - 1) % d.pool_teams_count) END) = d.pick_position
                     ORDER BY p.overall_pick LIMIT 3) p) AS first_picks
      FROM drafts d
     WHERE d.config_id = ${Number(configId)} AND d.user_id = ${vid}
       AND d.status = 'completed' AND d.mode = 'sim'
     ORDER BY d.completed_at DESC NULLS LAST, d.id DESC
     LIMIT ${Number(limit)}`;
  return rows.map((r) => {
    const f = (teams ?? []).find((t) => Number(t.slot) === Number(r.pick_position)) ?? null;
    return {
      draftId: r.id, userId: r.user_id,
      seat: r.pick_position, franchise: f?.name ?? null, completedAt: r.completed_at,
      firstPicks: r.first_picks ?? [],
    };
  });
}
