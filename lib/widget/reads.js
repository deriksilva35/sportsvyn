// lib/widget/reads.js - the iOS widget feed's reads (sun-22). ALL READS.
//
// REUSE FIRST. Every block is fed by the reader its screen already uses:
//   yourMove, games   lobbyV2() -> readPlayItems() -> playLobby(), the same
//                     three calls lib/games/lobbyV3.js makes for the Play tab
//                     (minus the leagues read the widget does not draw)
//   daily             lobbyV2()'s daily card and streak (streakLeaderboard)
//   teams             getFollowedTeams() (lib/follows.js) for the list, then
//                     ONE query here for each team's focus game - see below
//   inYourGames       stakeForMatches() (lib/gridiron/scoresV2.js), the Scores
//                     tab's per-game stake fan-out, over a narrow slate
//
// THE ONE NEW QUERY, AND WHY. No reader returns a team's game with its
// live_state AND a recent final: liveElseNext() and myFollowedTeamNext() drop
// finals and do not hand on metadata. A widget showing "W 24-17" the morning
// after needs both, so teamRows() reads live, else a final inside
// FINAL_WINDOW_H, else the next game - plus the kickoff after that.
//
// CACHED 60 s PER USER (feedFor), in memory, per instance. The slate for
// inYourGames is not per-user and is cached 60 s for everyone.

import { sql } from '../db.js';
import { lobbyV2 } from '../games/lobbyV2.js';
import { readPlayItems } from '../games/playRegistry.js';
import { playLobby } from '../games/playLobby.js';
import { getFollowedTeams, followableTeams } from '../follows.js';
import { stakeForMatches } from '../gridiron/scoresV2.js';
import { rowToGame } from '../gridiron/readers.js';
import { winProbForPhone } from '../push/liveActivityState.js';
import { serializeFeed, TEAMS_MAX } from './shape.js';

export { parseTeamIds } from './shape.js';

/** The leagues a widget covers: every league with a game surface today. */
export const WIDGET_LEAGUES = Object.freeze(['nfl', 'cfb', 'mlb', 'nba', 'epl']);
/** A final stays on a team row this long after its kickoff. */
export const FINAL_WINDOW_H = 18;
/** A 'live' row older than this is a feed fault, not a game (playRegistry.nextGameBySport). */
const LIVE_STUCK_H = 12;
export const MEMO_TTL_MS = 60_000;
const MEMO_MAX = 5000;

/**
 * Each team's focus game and its next kickoff. `teams` are getFollowedTeams()
 * rows (or picked ids resolved the same way). One round trip.
 */
export async function teamRows(teams, { now = new Date(), db = sql } = {}) {
  if (!teams?.length) return [];
  const ids = teams.map((t) => Number(t.id));
  const at = new Date(now).toISOString();
  const rows = await db`
    SELECT t.id AS team_id, g.id AS game_id, g.slug AS game_slug, g.status, g.kickoff_at,
           g.home_team_id, g.home_score, g.away_score, g.metadata->'live_state' AS live_state,
           o.id AS opp_id, o.abbreviation AS opp_abbr, coalesce(o.short_name, o.name) AS opp_name, o.name AS opp_full,
           nx.kickoff_at AS next_at
      FROM teams t
      LEFT JOIN LATERAL (
        SELECT m.id, m.slug, m.status, m.kickoff_at, m.home_team_id, m.away_team_id, m.home_score, m.away_score, m.metadata
          FROM matches m
         WHERE (m.home_team_id = t.id OR m.away_team_id = t.id)
           AND ((m.status = 'live' AND m.kickoff_at > ${at}::timestamptz - make_interval(hours => ${LIVE_STUCK_H}))
             OR (m.status = 'final' AND m.kickoff_at > ${at}::timestamptz - make_interval(hours => ${FINAL_WINDOW_H}))
             OR (m.status = 'scheduled' AND m.kickoff_at > ${at}::timestamptz))
         ORDER BY CASE m.status WHEN 'live' THEN 0 WHEN 'final' THEN 1 ELSE 2 END,
                  CASE WHEN m.status = 'final' THEN -extract(epoch FROM m.kickoff_at) ELSE extract(epoch FROM m.kickoff_at) END,
                  m.id
         LIMIT 1
      ) g ON true
      LEFT JOIN teams o ON o.id = CASE WHEN g.home_team_id = t.id THEN g.away_team_id ELSE g.home_team_id END
      LEFT JOIN LATERAL (
        SELECT min(m2.kickoff_at) AS kickoff_at FROM matches m2
         WHERE (m2.home_team_id = t.id OR m2.away_team_id = t.id)
           AND m2.status = 'scheduled' AND m2.kickoff_at > ${at}::timestamptz
           AND m2.id IS DISTINCT FROM g.id
      ) nx ON true
     WHERE t.id = ANY(${ids})`;
  const byId = new Map(rows.map((r) => [Number(r.team_id), r]));
  return teams.map((t) => {
    const r = byId.get(Number(t.id)) ?? {};
    return {
      teamId: t.id, teamAbbr: t.abbreviation ?? null, teamName: t.name ?? null, teamFullName: t.fullName ?? null, teamSlug: t.slug ?? null,
      leagueSlug: t.leagueSlug ?? null, color: t.colors?.primary ?? null, altColor: t.colors?.secondary ?? null,
      gameId: r.game_id ?? null, gameSlug: r.game_slug ?? null, status: r.status ?? null, kickoffAt: r.kickoff_at ?? null,
      homeTeamId: r.home_team_id ?? null, homeScore: r.home_score ?? null, awayScore: r.away_score ?? null,
      liveState: r.live_state ?? null,
      oppId: r.opp_id ?? null, oppAbbr: r.opp_abbr ?? null, oppName: r.opp_name ?? null, oppFullName: r.opp_full ?? null,
      nextAt: r.next_at ?? null,
    };
  });
}

/** Teams by id, in the order given, shaped like getFollowedTeams() rows. */
export async function teamsById(ids, { db = sql } = {}) {
  if (!ids?.length) return [];
  const rows = await db`
    SELECT t.id, t.slug, t.name, t.short_name, t.abbreviation, t.color_primary, t.color_secondary, l.slug AS league_slug
      FROM teams t JOIN leagues l ON l.id = t.league_id
     WHERE t.id = ANY(${ids.map(Number)}) AND l.slug = ANY(${[...WIDGET_LEAGUES]})`;
  const by = new Map(rows.map((r) => [Number(r.id), r]));
  return ids.map((id) => by.get(Number(id))).filter(Boolean).map((r) => ({
    id: r.id, slug: r.slug, name: r.short_name ?? r.name, fullName: r.name, abbreviation: r.abbreviation ?? null,
    colors: { primary: r.color_primary ?? null, secondary: r.color_secondary ?? null }, leagueSlug: r.league_slug,
  }));
}

// ---------------------------------------------------------------------------
// THE STAKE SLATE: live now, or kicking off inside [now - 12h, now + 24h].
// Not per-user, so one copy for everyone, 60 s.
// ---------------------------------------------------------------------------

let slateMemo = { at: 0, rows: null, key: null };

export async function stakeSlate({ now = new Date(), db = sql } = {}) {
  const t = new Date(now).getTime();
  const key = Math.floor(t / MEMO_TTL_MS);
  if (db === sql && slateMemo.rows && slateMemo.key === key) return slateMemo.rows;
  const lo = new Date(t - 12 * 3_600_000).toISOString();
  const hi = new Date(t + 24 * 3_600_000).toISOString();
  const rows = await db`
    SELECT m.id, m.slug, m.status, m.kickoff_at, m.season_year, m.season_phase, m.week,
           m.home_score, m.away_score, jsonb_build_object('live_state', m.metadata->'live_state') AS metadata,
           l.slug AS league_slug,
           h.id AS home_id, h.name AS home_name, h.abbreviation AS home_abbr, h.color_primary AS home_c1, h.color_secondary AS home_c2,
           a.id AS away_id, a.name AS away_name, a.abbreviation AS away_abbr, a.color_primary AS away_c1, a.color_secondary AS away_c2
      FROM matches m
      JOIN leagues l ON l.id = m.league_id
      JOIN teams h ON h.id = m.home_team_id
      JOIN teams a ON a.id = m.away_team_id
     WHERE l.slug = ANY(${[...WIDGET_LEAGUES]})
       AND m.status <> 'not_needed'
       AND ((m.status = 'live' AND m.kickoff_at > ${lo}::timestamptz)
         OR (m.kickoff_at >= ${lo}::timestamptz AND m.kickoff_at < ${hi}::timestamptz))
     ORDER BY (m.status = 'live') DESC, m.kickoff_at ASC, m.id ASC
     LIMIT 300`;
  const games = rows.map(rowToGame);
  if (db === sql) slateMemo = { at: t, rows: games, key };
  return games;
}

// ---------------------------------------------------------------------------
// THE FEED
// ---------------------------------------------------------------------------

/**
 * Every input the serializer takes, for one signed-in reader. Each block is
 * caught on its own: a failed read empties its block, never the feed.
 * @param teamIds  optional ids the widget was configured with (the picker);
 *                 when absent, the reader's follows.
 */
export async function readFeedInputs(userId, { now = new Date(), teamIds = null } = {}) {
  const uid = Number(userId);
  const v2 = await lobbyV2(uid, { now }).catch(() => null);
  const [items, teams, stakeGames] = await Promise.all([
    v2 ? readPlayItems({ uid, now, v2 }).catch(() => []) : [],
    (teamIds?.length ? teamsById(teamIds)
      : getFollowedTeams(uid).then((ts) => ts.filter((t) => WIDGET_LEAGUES.includes(t.leagueSlug)))).catch(() => []),
    stakeSlate({ now }).catch(() => []),
  ]);
  const view = playLobby(items, { now, signedIn: true, chip: 'all' });
  // Only the teams the widget can show are read: follows are newest-first,
  // and a follow with no game in the window sorts last anyway.
  const [rows, stakes] = await Promise.all([
    teamRows(teams.slice(0, TEAMS_MAX * 3), { now }).catch(() => []),
    stakeForMatches(uid, stakeGames, { now, followedIds: [] }).catch(() => new Map()),
  ]);
  return {
    view, daily: v2?.daily ?? null, streak: v2?.streak ?? 0,
    teamRows: rows, stakeGames, stakes, phoneOn: winProbForPhone(),
  };
}

export async function buildFeed(userId, opts = {}) {
  const now = opts.now ?? new Date();
  return serializeFeed(await readFeedInputs(userId, { ...opts, now }), now);
}

// userId|teams -> { at, promise }. In-flight requests share one build.
const memo = new Map();

/** The feed, built at most once per MEMO_TTL_MS per (user, team selection). */
export async function feedFor(userId, { now = new Date(), teamIds = null, build = buildFeed } = {}) {
  const key = `${Number(userId)}|${(teamIds ?? []).join(',')}`;
  const t = new Date(now).getTime();
  const hit = memo.get(key);
  if (hit && t - hit.at < MEMO_TTL_MS) return { payload: await hit.promise, cached: true };
  const promise = build(userId, { now, teamIds });
  memo.set(key, { at: t, promise });
  promise.catch(() => memo.delete(key));
  if (memo.size > MEMO_MAX) {
    for (const [k, v] of memo) { if (t - v.at >= MEMO_TTL_MS) memo.delete(k); }
    while (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value);
  }
  return { payload: await promise, cached: false };
}

/** Tests only: forget every memo. */
export function clearWidgetMemo() { memo.clear(); slateMemo = { at: 0, rows: null, key: null }; pickerMemo = { at: 0, rows: null }; }

// ---------------------------------------------------------------------------
// THE PICKER'S "ALL TEAMS": public, the same for everyone, 10 minutes.
// ---------------------------------------------------------------------------

const PICKER_TTL_MS = 10 * 60_000;
let pickerMemo = { at: 0, rows: null };

export async function pickerTeams({ now = new Date() } = {}) {
  const t = new Date(now).getTime();
  if (pickerMemo.rows && t - pickerMemo.at < PICKER_TTL_MS) return pickerMemo.rows;
  const rows = await followableTeams(WIDGET_LEAGUES, { colors: true });
  pickerMemo = { at: t, rows };
  return rows;
}
