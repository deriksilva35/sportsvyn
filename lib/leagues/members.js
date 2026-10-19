// lib/leagues/members.js - who may do what to whom in a league, and the writes
// (Leagues Phase 1, slice 1, thu-4; the mock's Members board).
//
// THREE ROLES. The OWNER is player_leagues.owner_id (one, never a role value);
// a CO-ADMIN is league_members.role = 'co_admin' (migration 144); everyone else
// is a MEMBER.
//
//   make / unmake co-admin   owner only, on anyone but the owner
//   remove                   owner: anyone but themself
//                            co-admin: plain members only (not the owner, not
//                            another co-admin, not themself)
//   leave                    anyone but the owner (an owner leaving would
//                            orphan the league; handing it over is not built)
//
// canAct() is the rule, PURE. Every write re-reads the rows and asks canAct()
// again, and its UPDATE / DELETE repeats the condition in SQL, so a stale page
// or a crafted call cannot act past what the rows allow right now.
//
// A REMOVED MEMBER STAYS OUT: the removal is recorded (league_removals) and the
// join path refuses that user, so a removal is not undone by pasting the code.

import { sql } from '../db.js';

export const ROLE_LABEL = Object.freeze({ owner: 'Owner', co_admin: 'Co-admin', member: null });

export const MEMBER_REFUSALS = Object.freeze({
  not_allowed: "You can't do that in this league",
  owner_cannot_leave: "The owner can't leave the league",
  not_member: 'Not a member of this league',
  failed: 'That did not go through - try again',
});

/** The role of `userId` in a league row ({ owner_id }) and its member rows ([{user_id, role}]). */
export function roleOf(league, memberRows, userId) {
  const u = Number(userId);
  if (league?.owner_id != null && Number(league.owner_id) === u) return 'owner';
  const m = memberRows.find((r) => Number(r.user_id) === u);
  if (!m) return null;
  return m.role === 'co_admin' ? 'co_admin' : 'member';
}

/**
 * PURE. action: 'promote' | 'demote' | 'remove' | 'leave'. actor/target: roles
 * ('owner' | 'co_admin' | 'member' | null for not a member); self: same person.
 */
export function canAct(action, { actor, target, self = false }) {
  if (actor == null) return false;
  if (action === 'leave') return actor !== 'owner';
  if (self || target == null || target === 'owner') return false;
  if (action === 'promote') return actor === 'owner' && target === 'member';
  if (action === 'demote') return actor === 'owner' && target === 'co_admin';
  if (action === 'remove') return actor === 'owner' || (actor === 'co_admin' && target === 'member');
  return false;
}

/** The menu a member row shows the reader: [{ action, label }] (empty = no menu). */
export function menuFor({ actor, target, self = false }) {
  const out = [];
  if (canAct('promote', { actor, target, self })) out.push({ action: 'promote', label: 'Make co-admin' });
  if (canAct('demote', { actor, target, self })) out.push({ action: 'demote', label: 'Remove co-admin' });
  if (canAct('remove', { actor, target, self })) out.push({ action: 'remove', label: 'Remove from league' });
  return out;
}

async function load(leagueId) {
  const [lg] = await sql`SELECT id, owner_id FROM player_leagues WHERE id = ${Number(leagueId)}`;
  if (!lg) return null;
  const rows = await sql`SELECT user_id, role FROM league_members WHERE league_id = ${lg.id}`;
  return { lg, rows };
}

const refuse = (k) => ({ ok: false, reason: MEMBER_REFUSALS[k], code: k });

/** Owner: make a member co-admin (role 'co_admin') or back (role 'member'). */
export async function setMemberRole(actorId, leagueId, targetId, role) {
  if (role !== 'co_admin' && role !== 'member') return refuse('not_allowed');
  const st = await load(leagueId);
  // No league and not yours are ONE refusal (ids are serial - sun-12 item 8).
  if (!st) return refuse('not_allowed');
  const actor = roleOf(st.lg, st.rows, actorId);
  const target = roleOf(st.lg, st.rows, targetId);
  const action = role === 'co_admin' ? 'promote' : 'demote';
  if (!canAct(action, { actor, target, self: Number(actorId) === Number(targetId) })) return refuse('not_allowed');
  const rows = await sql`
    UPDATE league_members m SET role = ${role}
      FROM player_leagues l
     WHERE m.league_id = l.id AND l.id = ${st.lg.id} AND l.owner_id = ${Number(actorId)}
       AND m.user_id = ${Number(targetId)} AND m.user_id <> l.owner_id
       AND m.role = ${role === 'co_admin' ? 'member' : 'co_admin'}
    RETURNING m.user_id`;
  return rows.length ? { ok: true, role } : refuse('failed');
}

/** Owner or co-admin: remove a member, and keep them out. */
export async function removeMember(actorId, leagueId, targetId) {
  const st = await load(leagueId);
  if (!st) return refuse('not_allowed');
  const actor = roleOf(st.lg, st.rows, actorId);
  const target = roleOf(st.lg, st.rows, targetId);
  if (!canAct('remove', { actor, target, self: Number(actorId) === Number(targetId) })) return refuse('not_allowed');
  const a = Number(actorId); const t = Number(targetId); const id = st.lg.id;
  // ONE STATEMENT, and the DELETE re-states the rule: the actor is still the
  // owner, or still a co-admin removing a plain member. The removal is
  // recorded only for a row this statement actually deleted.
  const deleted = await sql`
    WITH d AS (
      DELETE FROM league_members m USING player_leagues l
       WHERE m.league_id = l.id AND l.id = ${id} AND m.user_id = ${t} AND m.user_id IS DISTINCT FROM l.owner_id
         AND (l.owner_id = ${a}
           OR (m.role = 'member' AND EXISTS (SELECT 1 FROM league_members x
                WHERE x.league_id = l.id AND x.user_id = ${a} AND x.role = 'co_admin')))
      RETURNING m.league_id, m.user_id)
    INSERT INTO league_removals (league_id, user_id, removed_by)
    SELECT league_id, user_id, ${a} FROM d
    ON CONFLICT (league_id, user_id) DO UPDATE SET removed_by = EXCLUDED.removed_by, removed_at = now()
    RETURNING user_id`;
  // SLICE 3: the same person leaves every draft linked to this league - the claim
  // row goes and the franchise is free; the owner's row is never touched.
  if (deleted.length) await dropDraftRows(id, t);
  return deleted.length ? { ok: true } : refuse('failed');
}

/** Anyone but the owner: leave. Leaving is not a removal - the code still works for them. */
export async function leaveLeague(userId, leagueId) {
  const st = await load(leagueId);
  if (!st) return refuse('not_member');
  const actor = roleOf(st.lg, st.rows, userId);
  if (actor == null) return refuse('not_member');
  if (!canAct('leave', { actor })) return refuse('owner_cannot_leave');
  const rows = await sql`
    DELETE FROM league_members m USING player_leagues l
     WHERE m.league_id = l.id AND l.id = ${st.lg.id} AND m.user_id = ${Number(userId)}
       AND m.user_id IS DISTINCT FROM l.owner_id
    RETURNING m.user_id`;
  if (rows.length) await dropDraftRows(st.lg.id, Number(userId));
  return rows.length ? { ok: true } : refuse('failed');
}

/** A league member is gone: their draft_config_members rows on the league's linked configs go too. */
async function dropDraftRows(leagueId, userId) {
  await sql`
    DELETE FROM draft_config_members m USING draft_configs c
     WHERE c.id = m.config_id AND c.league_id = ${leagueId} AND m.user_id = ${userId} AND m.role = 'member'`;
}

export const NOTIFY_KEYS = Object.freeze(['chat', 'results', 'joins']);
export const NOTIFY_LABEL = Object.freeze({
  chat: 'New chat messages', results: 'Daily results in this league', joins: 'Someone joins',
});

/** Store the reader's own toggles. STORED ONLY: the senders read them when built. */
export async function setNotifyPrefs(userId, leagueId, prefs = {}) {
  const v = (k) => (typeof prefs[k] === 'boolean' ? prefs[k] : null);
  const rows = await sql`
    UPDATE league_members SET
           notify_chat = COALESCE(${v('chat')}::boolean, notify_chat),
           notify_results = COALESCE(${v('results')}::boolean, notify_results),
           notify_joins = COALESCE(${v('joins')}::boolean, notify_joins)
     WHERE league_id = ${Number(leagueId)} AND user_id = ${Number(userId)}
    RETURNING notify_chat, notify_results, notify_joins`;
  if (!rows.length) return refuse('not_member');
  const r = rows[0];
  return { ok: true, prefs: { chat: r.notify_chat, results: r.notify_results, joins: r.notify_joins } };
}

/** Has this user been removed from this league? */
export async function wasRemoved(leagueId, userId) {
  const [r] = await sql`SELECT 1 AS x FROM league_removals WHERE league_id = ${Number(leagueId)} AND user_id = ${Number(userId)}`;
  return !!r;
}
