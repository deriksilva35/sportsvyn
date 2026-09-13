// lib/gridiron/scoresV2.js - the Scores tab v2 reader (SCORES TAB v2 relay).
//
// One call: seven days of games around today (viewer's zone) plus every live
// game, and per match the pieces the cards need - records, network, spread
// and total, the preview, the latest play (live football), the one stat line
// (finals), the EPL probability, and the signed-in reader's stake. Every side
// read is caught to its empty value; nothing here writes.

import { sql } from '../db.js';
import { rowToGame } from './readers.js';
import { getSpreadHome, getTotalPoints } from './oddsReader.js';
import { loadRecordChips } from './recordsLoader.js';
import { getTopN } from '../rankings.js';
import { currentApRanks } from '../cfb/rankings.js';
import { computeMatchProbabilities } from '../matchProbability.js';
import { currentContest, getEntry } from '../weekly/entries.js';
import { liveScoredBoard, liveEntryRows } from '../weekly/live.js';
import { viewerDay, shiftDay, dayStripDays, dayCounts, groupGames, pickState, mineCount, driveStripFor, ET } from './scoresV2Shape.js';
import { getFollowedTeamIds } from '../follows.js';

const empty = (v) => (p) => p.catch(() => v);

/** Games within [today-3, today+3] in the viewer's zone, plus every live game. */
async function windowGames(today, tz) {
  const lo = new Date(`${shiftDay(today, -4)}T00:00:00Z`).toISOString();
  const hi = new Date(`${shiftDay(today, 5)}T00:00:00Z`).toISOString();
  const rows = await sql`
    SELECT m.id, m.slug, m.status, m.kickoff_at, m.season_year, m.season_phase, m.week,
           m.home_score, m.away_score, m.metadata, m.venue,
           l.slug AS league_slug, l.name AS league_name,
           h.id AS home_id, h.name AS home_name, h.short_name AS home_short, h.abbreviation AS home_abbr,
           h.color_primary AS home_c1, h.color_secondary AS home_c2,
           a.id AS away_id, a.name AS away_name, a.short_name AS away_short, a.abbreviation AS away_abbr,
           a.color_primary AS away_c1, a.color_secondary AS away_c2,
           to_char((m.kickoff_at AT TIME ZONE ${ET})::date, 'YYYY-MM-DD') AS et_day,
           to_char(m.kickoff_at AT TIME ZONE ${ET}, 'Dy') AS et_weekday,
           bc.broadcaster_name AS network
      FROM matches m
      JOIN leagues l ON l.id = m.league_id
      JOIN teams h ON h.id = m.home_team_id
      JOIN teams a ON a.id = m.away_team_id
      LEFT JOIN LATERAL (
        SELECT broadcaster_name FROM match_broadcasters b
         WHERE b.match_id = m.id AND b.country_code = 'US'
         ORDER BY b.is_primary DESC, b.display_order ASC LIMIT 1
      ) bc ON true
     WHERE l.slug IN ('nfl', 'cfb', 'epl')
       AND (m.status = 'live' OR (m.kickoff_at >= ${lo}::timestamptz AND m.kickoff_at < ${hi}::timestamptz))
     ORDER BY (m.status = 'live') DESC, m.kickoff_at ASC, m.id ASC`;
  return rows
    .map((r) => ({ ...rowToGame(r), network: r.network ?? null, home: { ...rowToGame(r).home, shortName: r.home_short }, away: { ...rowToGame(r).away, shortName: r.away_short } }))
    .filter((g) => g.status === 'live' || Math.abs((new Date(viewerDay(g.kickoffAt, tz) + 'T12:00:00Z') - new Date(today + 'T12:00:00Z')) / 86400000) <= 3);
}

async function previews(ids) {
  if (!ids.length) return new Map();
  const rows = await sql`
    SELECT match_id, slug FROM articles WHERE type = 'preview' AND status = 'published' AND match_id = ANY(${ids})`;
  return new Map(rows.map((r) => [r.match_id, `/article/${r.slug}`]));
}

/** Latest down-bearing play and latest play text per live football game. */
async function latestPlays(ids) {
  if (!ids.length) return new Map();
  const [downs, texts] = await Promise.all([
    sql`SELECT DISTINCT ON (match_id) match_id, period, clock, down, distance, yards_to_goal, offense_team_id, text
          FROM plays WHERE match_id = ANY(${ids}) AND down IS NOT NULL
         ORDER BY match_id, play_number DESC NULLS LAST, id DESC`,
    sql`SELECT DISTINCT ON (match_id) match_id, text FROM plays WHERE match_id = ANY(${ids}) AND text IS NOT NULL
         ORDER BY match_id, play_number DESC NULLS LAST, id DESC`,
  ]);
  const t = new Map(texts.map((r) => [r.match_id, r.text]));
  return new Map(downs.map((r) => [r.match_id, {
    play: { period: r.period, clock: r.clock, down: r.down, distance: r.distance, yardsToGoal: r.yards_to_goal, offenseTeamId: r.offense_team_id, text: r.text },
    lastText: t.get(r.match_id) ?? r.text,
  }]));
}

/** One stat line per final: the passing leader (NFL/CFB) or the scorers (EPL); plus whether stat rows exist. */
async function statLines(finals) {
  const nfl = finals.filter((g) => g.leagueSlug === 'nfl').map((g) => g.id);
  const cfb = finals.filter((g) => g.leagueSlug === 'cfb').map((g) => g.id);
  const epl = finals.filter((g) => g.leagueSlug === 'epl').map((g) => g.id);
  const out = new Map(); const hasRows = new Set();
  const [n, c, e, cnt] = await Promise.all([
    nfl.length ? sql`SELECT DISTINCT ON (s.match_id) s.match_id, p.full_name AS name, s.pass_cmp, s.pass_att, s.pass_yds, s.pass_td
                       FROM nfl_player_game_stats s JOIN nfl_players p ON p.id = s.nfl_player_id
                      WHERE s.match_id = ANY(${nfl}) AND s.pass_att > 0 ORDER BY s.match_id, s.pass_yds DESC NULLS LAST` : [],
    cfb.length ? sql`SELECT DISTINCT ON (s.match_id) s.match_id, p.full_name AS name, s.pass_cmp, s.pass_att, s.pass_yds, s.pass_td
                       FROM cfb_player_game_stats s JOIN players p ON p.id = s.player_id
                      WHERE s.match_id = ANY(${cfb}) AND s.pass_att > 0 ORDER BY s.match_id, s.pass_yds DESC NULLS LAST` : [],
    epl.length ? sql`SELECT s.match_id, p.full_name AS name, p.known_as, s.goals FROM player_match_stats s JOIN players p ON p.id = s.player_id
                      WHERE s.match_id = ANY(${epl}) AND s.goals > 0 ORDER BY s.match_id, s.goals DESC` : [],
    (nfl.length || cfb.length) ? sql`SELECT match_id FROM nfl_player_game_stats WHERE match_id = ANY(${nfl.length ? nfl : [0]}) GROUP BY match_id
                                     UNION ALL SELECT match_id FROM cfb_player_game_stats WHERE match_id = ANY(${cfb.length ? cfb : [0]}) GROUP BY match_id` : [],
  ]);
  for (const r of [...n, ...c]) out.set(r.match_id, { name: r.name, passCmp: r.pass_cmp, passAtt: r.pass_att, passYds: r.pass_yds, passTd: r.pass_td });
  for (const r of e) {
    const cur = out.get(r.match_id) ?? { scorers: [] };
    cur.scorers.push({ name: (r.known_as ?? r.name ?? '').split(/\s+/).pop(), goals: Number(r.goals) });
    out.set(r.match_id, cur);
  }
  for (const r of cnt) hasRows.add(r.match_id);
  return { lines: out, hasRows };
}

/** EPL win probabilities from the team-power rating (the market ledger's model). */
async function eplProbabilities(games) {
  const epl = games.filter((g) => g.leagueSlug === 'epl' && g.status !== 'final');
  if (!epl.length) return new Map();
  const rows = await getTopN({ listSlug: 'team-power', leagueSlug: 'epl', limit: 48 }).catch(() => []);
  const rating = new Map(rows.map((r) => [r.team_id, Number(r.score)]));
  const out = new Map();
  for (const g of epl) {
    const p = computeMatchProbabilities(rating.get(g.home.id), rating.get(g.away.id));
    if (p) out.set(g.id, p);
  }
  return out;
}

/**
 * THE STAKE, one round trip per source, not per card:
 *   Map(matchId -> { pick: {side, abbr, state} | null, weekly: [{name, pos, points}], alerts: boolean })
 */
export async function stakeForMatches(userId, games, { now = new Date(), db = sql, weeklyRows = null, followedIds = null } = {}) {
  const out = new Map();
  const uid = userId == null ? null : Number(userId);
  if (uid == null || !games.length) return out;
  const ids = games.map((g) => g.id);
  const teamIds = [...new Set(games.flatMap((g) => [g.home?.id, g.away?.id]).filter((x) => x != null))];
  const [entries, alerts, weekly, followRows] = await Promise.all([
    db`SELECT e.lineup FROM contest_entries e JOIN contests c ON c.id = e.contest_id
         WHERE c.game_type = 'pickem' AND e.user_id = ${uid}`.catch(() => []),
    db`SELECT scope, scope_id FROM alert_prefs
         WHERE user_id = ${uid} AND master
           AND ((scope = 'match' AND scope_id = ANY(${ids})) OR (scope = 'team' AND scope_id = ANY(${teamIds})))`.catch(() => []),
    weeklyRows ? Promise.resolve(weeklyRows) : (async () => {
      const contest = await currentContest({ now });
      if (!contest) return [];
      const entry = await getEntry(contest.id, uid);
      if (!entry) return [];
      const { scored, playedIds } = await liveScoredBoard(contest);
      return liveEntryRows({ lineup: entry.lineup ?? {}, scored, playedIds }).rows.filter((r) => r.id != null);
    })().catch(() => []),
    // A FOLLOWED TEAM IS A STAKE (TEAM FOLLOWING relay, R2). Mine was picks,
    // Weekly players and alerts - three things the reader did to a GAME. A
    // follow is something they did to a TEAM, and it is the most durable of
    // the four: it survives the season, the board and the alert sheet. It
    // counts here rather than getting a pill of its own, so Mine stays one
    // answer to one question.
    // Injectable like weeklyRows, and for the same reason: this function is
    // tested against a stub db, and a read that reached past the stub to the
    // real database would make the fixture test depend on whatever rows
    // happened to exist for that user id.
    followedIds ?? getFollowedTeamIds(uid).catch(() => []),
  ]);
  const followed = new Set(followRows);
  const picks = Object.assign({}, ...entries.map((e) => e.lineup ?? {}));
  const alertMatch = new Set(alerts.filter((a) => a.scope === 'match').map((a) => Number(a.scope_id)));
  const alertTeam = new Set(alerts.filter((a) => a.scope === 'team').map((a) => Number(a.scope_id)));
  for (const g of games) {
    const side = picks[g.id] ?? picks[String(g.id)] ?? null;
    const pick = side ? { side, abbr: (side === 'home' ? g.home : g.away)?.abbreviation ?? null,
      state: pickState({ side, homeScore: g.homeScore, awayScore: g.awayScore, status: g.status }) } : null;
    const w = g.leagueSlug === 'nfl'
      ? weekly.filter((r) => r.team && (r.team === g.home?.abbreviation || r.team === g.away?.abbreviation))
        .map((r) => ({ name: r.name, pos: r.slot?.replace(/\d+$/, '') ?? null, points: Number(r.points) || 0 }))
      : [];
    const al = alertMatch.has(g.id) || alertTeam.has(g.home?.id) || alertTeam.has(g.away?.id);
    // Which side is followed, not just whether one is - the row can say "your
    // team" about the right half of the card.
    const follow = followed.has(g.home?.id) ? 'home' : followed.has(g.away?.id) ? 'away' : null;
    if (pick || w.length || al || follow) out.set(g.id, { pick, weekly: w, alerts: al, follow });
  }
  return out;
}

/** Everything the Scores tab draws. */
export async function scoresV2({ userId = null, date = null, sport = 'all', mine = false, top25 = false, tz = ET, now = new Date() } = {}) {
  const today = viewerDay(now.toISOString(), tz);
  const picked = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today;
  const games = await windowGames(today, tz).catch(() => []);
  const ids = games.map((g) => g.id);
  const liveFootball = games.filter((g) => g.status === 'live' && g.leagueSlug !== 'epl').map((g) => g.id);
  const finals = games.filter((g) => g.status === 'final');
  const [records, spreads, totals, prev, plays, stats, probs, stake, ap] = await Promise.all([
    empty(new Map())(loadRecordChips({ now })),
    empty(new Map())(getSpreadHome(ids)),
    empty(new Map())(getTotalPoints(ids)),
    empty(new Map())(previews(ids)),
    empty(new Map())(latestPlays(liveFootball)),
    empty({ lines: new Map(), hasRows: new Set() })(statLines(finals)),
    empty(new Map())(eplProbabilities(games)),
    empty(new Map())(stakeForMatches(userId, games, { now })),
    currentApRanks().catch(() => ({ ranks: new Map(), season: null, week: null })),
  ]);
  // AP RANKS, CFB ONLY (R4): one reader, attached here so every card, the
  // pill and the filter read the same numbers.
  const rankOf = (g, side) => (g.leagueSlug === 'cfb' ? ap.ranks.get(side === 'home' ? g.home?.id : g.away?.id) ?? null : null);
  const extras = new Map(games.map((g) => [g.id, {
    rank: { home: rankOf(g, 'home'), away: rankOf(g, 'away') },
    record: { home: records.get?.(g.home?.id) ?? null, away: records.get?.(g.away?.id) ?? null },
    spreadHome: spreads.get(g.id) ?? null, total: totals.get(g.id) ?? null,
    preview: prev.get(g.id) ?? null,
    drive: plays.has(g.id) ? driveStripFor({ ...plays.get(g.id), game: g }) : null,
    stat: stats.lines.get(g.id) ?? null, hasStats: stats.hasRows.has(g.id),
    prob: probs.get(g.id) ?? null,
    stake: stake.get(g.id) ?? null,
    open: g.status === 'scheduled' && new Date(g.kickoffAt).getTime() > now.getTime(),
  }]));
  const counts = dayCounts(games, tz);
  const days = dayStripDays(today).map((d) => ({ ...d, counts: counts.get(d.date) ?? null, on: d.date === picked }));
  // R5 LIVES INSIDE groupGames, which is the only thing that knows what this
  // day would actually draw. It hands back whether the pill exists
  // (rankedToday) and whether the flag applied (top25) - a stale ?top25=1
  // carried onto an unranked day stops applying rather than emptying the
  // board, and the pill that set it is not on screen to unset.
  const { groups, liveAway, rankedToday, top25: useTop25 } = groupGames(games, { date: picked, today, tz, sport, mine, top25, stake, extras, signedIn: userId != null });
  return {
    today, date: picked, tz, sport, mine, top25: useTop25, rankedToday, apWeek: ap.week, apSeason: ap.season,
    liveCount: games.filter((g) => g.status === 'live').length,
    mineCount: userId == null ? 0 : mineCount(games.filter((g) => g.status === 'live' || viewerDay(g.kickoffAt, tz) === picked), stake),
    days, groups, liveAway, extras,
  };
}
