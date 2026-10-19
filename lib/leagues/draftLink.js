// lib/leagues/draftLink.js - a Fantrax draft league, linked to a player league
// (Leagues slice 3, option B, fri-3; docs/reports/2026-10-16-slice3-draft-leagues-recon.md).
//
// THE SPLIT. The player league is the DOOR and the HOME: who is in, roles,
// removals, the one invite (/j/), the league page. The draft tables stay the
// ENGINE and are never rewritten here: draft_configs' facts, franchises and
// claims (draft_config_members), keepers, invites, runs and picks.
//
//   linkConfigToNewLeague  the one-step move: a new player league (kind 'fantasy',
//                          owner = the importer, size = teams_count), every draft
//                          member as a league member with a join line, and the
//                          link - ONE statement, dry run by default
//   joinDoor               where an old /join/<code> link goes now
//   loadDraftHome          the league home's DRAFT tab
//   setBotsOn              the commissioner's "empty seats are bots" switch
//
// TWO MEMBERSHIP TABLES, ONE TRUTH. For a linked config the league decides who
// is in: lib/fantasy/leagueShare.js memberRole() admits a league member, a claim
// writes their draft_config_members row on first use, and a league removal or
// leave deletes it (lib/leagues/members.js). The draft side's own leave / kick /
// invite are refused for a linked config, so nobody joins or leaves around the
// league's door (league_removals included).

import { sql } from '../db.js';
import { makeJoinCode } from './core.js';
import { makeInviteToken } from './invite.js';
import { leagueMembers, myLeagueRuns, franchiseOf } from '../fantasy/leagueShare.js';

// ---------------------------------------------------------------------------
// THE ONE-STEP MOVE
// ---------------------------------------------------------------------------

/** Row counts that must not move when a config is linked (the zero-loss proof). */
export async function draftCounts(configId) {
  const id = Number(configId);
  const [r] = await sql`
    SELECT (SELECT count(*) FROM draft_configs WHERE id = ${id})::int AS configs,
           (SELECT count(*) FROM draft_config_members WHERE config_id = ${id})::int AS members,
           (SELECT count(*) FROM draft_config_members WHERE config_id = ${id} AND fantrax_team_id IS NOT NULL)::int AS claims,
           (SELECT count(*) FROM draft_config_keepers WHERE config_id = ${id})::int AS keepers,
           (SELECT md5(COALESCE(string_agg(k::text, '|' ORDER BY k.id), '')) FROM draft_config_keepers k WHERE k.config_id = ${id}) AS keepers_hash,
           (SELECT count(*) FROM draft_config_invites WHERE config_id = ${id})::int AS invites,
           (SELECT count(*) FROM drafts WHERE config_id = ${id})::int AS drafts,
           (SELECT count(*) FROM draft_picks p JOIN drafts d ON d.id = p.draft_id WHERE d.config_id = ${id})::int AS picks,
           (SELECT count(*) FROM draft_reads x JOIN drafts d ON d.id = x.draft_id WHERE d.config_id = ${id})::int AS reads`;
  return r;
}

export const LINK_REFUSALS = Object.freeze({
  no_config: 'No such draft config',
  not_fantrax: 'Only a Fantrax league becomes a player league; mock and tracker rooms stay private',
  already_linked: 'That draft league is already linked',
  no_owner: 'The config has no owner to own the league',
  bad_size: 'A league is 2 to 100 teams',
});

/**
 * PURE: what the move will write, from the config and its member rows - or
 * { ok: false, code } naming why it will not.
 */
export function linkPlan(config, memberRows = []) {
  const fail = (code) => ({ ok: false, code, reason: LINK_REFUSALS[code] });
  if (!config) return fail('no_config');
  if (config.source !== 'fantrax') return fail('not_fantrax');
  if (config.league_id != null) return fail('already_linked');
  if (config.user_id == null) return fail('no_owner');
  const size = Number(config.teams_count);
  if (!Number.isInteger(size) || size < 2 || size > 100) return fail('bad_size');
  // Every draft member, the owner included even without a row (the importer IS
  // the owner - leagueShare's rule), each once, at their own join time.
  const byUser = new Map();
  for (const m of memberRows) byUser.set(Number(m.user_id), m.joined_at ?? null);
  if (!byUser.has(Number(config.user_id))) byUser.set(Number(config.user_id), config.created_at ?? null);
  return {
    ok: true,
    league: {
      name: String(config.name ?? 'Draft league').slice(0, 40), ownerId: Number(config.user_id), kind: 'fantasy',
      // LEAGUE SIZE = NUMBER OF TEAMS (ruling fri-3).
      maxMembers: size, lateJoins: true, startsAt: config.created_at ?? null,
    },
    members: [...byUser].map(([userId, joinedAt]) => ({ userId, joinedAt })),
  };
}

/**
 * Link a Fantrax config to a NEW player league. Dry run unless `apply`.
 * -> { ok, plan, before, after?, leagueId?, checks? } | { ok: false, code, reason }
 */
export async function linkConfigToNewLeague(configId, { apply = false } = {}) {
  const id = Number(configId);
  const [config] = await sql`
    SELECT id, name, user_id, source, teams_count, league_id, created_at FROM draft_configs WHERE id = ${id}`;
  const memberRows = config ? await sql`SELECT user_id, joined_at FROM draft_config_members WHERE config_id = ${id}` : [];
  const plan = linkPlan(config, memberRows);
  if (!plan.ok) return plan;
  const before = await draftCounts(id);
  if (!apply) return { ok: true, dryRun: true, plan, before };

  const uids = plan.members.map((m) => m.userId);
  const joined = plan.members.map((m) => (m.joinedAt ? new Date(m.joinedAt).toISOString() : new Date().toISOString()));
  let row = null;
  for (let attempt = 0; attempt < 5 && !row; attempt += 1) {
    try {
      // ONE STATEMENT: the league, its members, their join lines and the link
      // commit together or not at all. The link's WHERE re-checks "fantrax and
      // not linked", so a second run (or a race) links nothing - and then the
      // league it would have made is not made either (the CTEs hang off `link`).
      [row] = await sql`
        WITH link_ok AS (
          SELECT id FROM draft_configs WHERE id = ${id} AND source = 'fantrax' AND league_id IS NULL FOR UPDATE),
        lg AS (
          INSERT INTO player_leagues (name, owner_id, join_code, invite_token, span, scoring, format,
                                      max_members, late_joins, starts_at, kind)
          SELECT ${plan.league.name}, ${plan.league.ownerId}, ${makeJoinCode()}, ${makeInviteToken()}, 'season', 'total', 'table',
                 ${plan.league.maxMembers}, true, ${plan.league.startsAt}::timestamptz, 'fantasy'
            FROM link_ok
          RETURNING id),
        mem AS (
          INSERT INTO league_members (league_id, user_id, joined_at)
          SELECT lg.id, u.uid, u.at FROM lg, unnest(${uids}::int[], ${joined}::timestamptz[]) AS u(uid, at)
          ON CONFLICT DO NOTHING RETURNING user_id),
        ev AS (
          INSERT INTO league_events (league_id, kind, user_id, period_key, at)
          SELECT lg.id, 'join', u.uid, '', u.at FROM lg, unnest(${uids}::int[], ${joined}::timestamptz[]) AS u(uid, at)
          ON CONFLICT DO NOTHING RETURNING user_id),
        link AS (
          UPDATE draft_configs c SET league_id = lg.id FROM lg WHERE c.id = ${id} RETURNING c.id)
        SELECT (SELECT id FROM lg) AS league_id, (SELECT count(*) FROM mem)::int AS members,
               (SELECT count(*) FROM ev)::int AS events, (SELECT count(*) FROM link)::int AS linked`;
    } catch (e) {
      const m = String(e?.message ?? '');
      if (!m.includes('player_leagues_join_code_key') && !m.includes('player_leagues_invite_token_key')) throw e;
    }
  }
  if (!row?.league_id) return { ok: false, code: 'already_linked', reason: LINK_REFUSALS.already_linked };
  const after = await draftCounts(id);
  const checks = await linkChecks(id, row.league_id);
  return { ok: true, dryRun: false, plan, before, after, leagueId: row.league_id, wrote: row, checks };
}

/** The post-move checks: every one must be true. */
export async function linkChecks(configId, leagueId) {
  const [r] = await sql`
    SELECT
      (SELECT count(*) FROM draft_config_members m WHERE m.config_id = ${configId}
          AND NOT EXISTS (SELECT 1 FROM league_members l WHERE l.league_id = ${leagueId} AND l.user_id = m.user_id))::int AS members_missing,
      (SELECT (l.owner_id = c.user_id) FROM player_leagues l, draft_configs c WHERE l.id = ${leagueId} AND c.id = ${configId}) AS same_owner,
      (SELECT (l.max_members = c.teams_count) FROM player_leagues l, draft_configs c WHERE l.id = ${leagueId} AND c.id = ${configId}) AS size_is_teams,
      (SELECT league_id FROM draft_configs WHERE id = ${configId}) = ${leagueId} AS linked,
      (SELECT kind FROM player_leagues WHERE id = ${leagueId}) = 'fantasy' AS fantasy`;
  return { ...r, ok: r.members_missing === 0 && r.same_owner && r.size_is_teams && r.linked && r.fantasy };
}

// ---------------------------------------------------------------------------
// THE OLD DOOR
// ---------------------------------------------------------------------------

/**
 * PURE: where /join/<code> sends a signed-in reader for a LINKED config. A
 * member goes to the league's Draft tab. A non-member is let through the
 * league's own door (/j/<token>, which checks size, removals and late joins)
 * only while the old code itself is still good; a dead code stays dead - an
 * expired link must not become a live one by moving. null = render as before.
 */
export function joinDoor({ leagueId = null, member = false, refusal = null, inviteToken = null } = {}) {
  if (leagueId == null) return null;
  if (member) return `/leagues/${leagueId}?tab=draft`;
  if (refusal == null && inviteToken) return `/j/${inviteToken}`;
  return null;
}

// ---------------------------------------------------------------------------
// THE DRAFT TAB
// ---------------------------------------------------------------------------

/** The newest config linked to a league (a league holds one draft per season). */
export async function linkedConfigId(leagueId) {
  const [r] = await sql`SELECT id FROM draft_configs WHERE league_id = ${Number(leagueId)} ORDER BY created_at DESC, id DESC LIMIT 1`;
  return r?.id ?? null;
}

/**
 * Everything the Draft tab shows, for a reader who is a league member.
 * -> { config, franchises: [{slot, name, fantraxTeamId, manager, keepers: [..]}],
 *      keeperCount, me: { claimed, fantraxTeamId }, runs, keptBySeat }
 */
export async function loadDraftHome(configId, viewerId) {
  const [config] = await sql`
    SELECT id, name, user_id, teams_count, scoring_format, roster_slots, draft_date, pick_timer_seconds, teams, created_at
      FROM draft_configs WHERE id = ${Number(configId)}`;
  if (!config) return null;
  const [members, keepers, runs] = await Promise.all([
    leagueMembers(config.id, config.teams),
    sql`SELECT round, pick_in_round, fantrax_team_id, player_name, position, team
          FROM draft_config_keepers WHERE config_id = ${config.id} ORDER BY round, pick_in_round`,
    myLeagueRuns(config.id, viewerId, { teams: config.teams }),
  ]);
  const byTeam = new Map();
  for (const k of keepers) {
    const key = String(k.fantrax_team_id);
    if (!byTeam.has(key)) byTeam.set(key, []);
    byTeam.get(key).push({ round: k.round, name: k.player_name, position: k.position, team: k.team });
  }
  const managerOf = new Map(members.filter((m) => m.fantraxTeamId != null).map((m) => [String(m.fantraxTeamId), m]));
  const franchises = [...(config.teams ?? [])].sort((a, b) => a.slot - b.slot).map((t) => {
    const m = managerOf.get(String(t.fantraxTeamId)) ?? null;
    return {
      slot: t.slot, name: t.name, fantraxTeamId: String(t.fantraxTeamId),
      manager: m ? { userId: Number(m.userId), handle: m.handle } : null,
      keepers: byTeam.get(String(t.fantraxTeamId)) ?? [],
    };
  });
  const mine = members.find((m) => Number(m.userId) === Number(viewerId)) ?? null;
  const claimed = mine?.fantraxTeamId != null ? franchiseOf(config.teams, mine.fantraxTeamId) : null;
  const { keptBySeat } = await import('../fantrax/keeperSeed.js');
  return {
    config, franchises, keeperCount: keepers.length, runs,
    members: members.map((m) => ({ userId: Number(m.userId), teamName: m.teamName, fantraxTeamId: m.fantraxTeamId })),
    me: { claimed: claimed ? { slot: claimed.slot, name: claimed.name } : null, fantraxTeamId: mine?.fantraxTeamId ?? null },
    keptBySeat: keepers.length ? keptBySeat(keepers.map((k) => ({ fantrax_team_id: k.fantrax_team_id })), config.teams) : null,
  };
}

/** The commissioner's switch: empty draft seats are bots, or stay empty. Owner only. */
export async function setBotsOn(actorId, leagueId, on) {
  const rows = await sql`
    UPDATE player_leagues SET bots_on = ${!!on}
     WHERE id = ${Number(leagueId)} AND owner_id = ${Number(actorId)} AND kind = 'fantasy'
    RETURNING bots_on`;
  return rows.length ? { ok: true, botsOn: rows[0].bots_on } : { ok: false, reason: 'Only the league owner can do that' };
}
