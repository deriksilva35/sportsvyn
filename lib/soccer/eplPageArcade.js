// lib/soccer/eplPageArcade.js - the EPL match page under the ARCADE theme
// (thu-24), on the gridiron game page's structure (lib/gridiron/gamePageArcade.js):
// the board's card face, then modules per state, each dropped when empty.
//
//   pre    card
//   live   card, moments (goals and cards), stats
//   final  card, moments, stats, players
//
// PURE SHAPING FIRST, then one read function whose every side read is caught.
// The dark page (app/epl/match/[slug]/page.js below its arcade branch) is
// unchanged.

import { sql } from '../db.js';
import { rowToGame } from '../gridiron/readers.js';
import { ET } from '../gridiron/scoresV2Shape.js';
import { eplPositionChips } from '../standings/read.js';
import { compareRows } from './matchCenter.js';
import { matchweekLabel } from './roundLabel.js';
import { momentsFromEvents, momentList, surname } from './moments.js';

/** The page state from the row's status. */
export const eplState = (status) => (status === 'final' ? 'final' : status === 'live' ? 'live' : 'pre');

/** The module order per state; a module with nothing in it is not drawn. PURE. */
export function eplModules({ state, hasMoments = false, hasStats = false, hasPlayers = false }) {
  if (state === 'pre') return ['card'];
  return ['card', hasMoments ? 'moments' : null, hasStats ? 'stats' : null,
    state === 'final' && hasPlayers ? 'players' : null].filter(Boolean);
}

/**
 * TOP PLAYERS, three a side: by rating, goals and assists breaking ties, and
 * only players who played. Each line is what they did, not a paragraph. PURE.
 */
export function topPlayers(rows = [], { homeId, awayId, per = 3 } = {}) {
  const score = (r) => [Number(r.match_rating ?? 0), Number(r.goals ?? 0), Number(r.assists ?? 0)];
  const cmp = (a, b) => { const x = score(a); const y = score(b); return (y[0] - x[0]) || (y[1] - x[1]) || (y[2] - x[2]); };
  const line = (r) => [
    r.match_rating != null ? Number(r.match_rating).toFixed(1) : null,
    Number(r.goals) ? `${r.goals} G` : null,
    Number(r.assists) ? `${r.assists} A` : null,
    r.saves != null && Number(r.saves) > 0 ? `${r.saves} saves` : null,
    `${r.minutes_played ?? 0}'`,
  ].filter(Boolean).join(' · ');
  const side = (id) => rows.filter((r) => r.team_id === id && Number(r.minutes_played ?? 0) > 0).sort(cmp).slice(0, per)
    .map((r) => ({ name: surname(r.known_as ?? r.full_name), line: line(r) }));
  return { home: side(homeId), away: side(awayId) };
}

const caught = (p, v) => Promise.resolve(p).catch(() => v);

/** Everything the arcade EPL page draws, for one slug; null when there is no such EPL row. */
export async function eplArcadeView(slug) {
  const r = (await sql`
    SELECT m.id, m.slug, m.status, m.kickoff_at, m.season_year, m.season_phase, m.week,
           m.home_score, m.away_score, m.metadata, m.venue,
           l.slug AS league_slug, l.name AS league_name,
           h.id AS home_id, h.name AS home_name, h.short_name AS home_short, h.abbreviation AS home_abbr,
           h.color_primary AS home_c1, h.color_secondary AS home_c2,
           a.id AS away_id, a.name AS away_name, a.short_name AS away_short, a.abbreviation AS away_abbr,
           a.color_primary AS away_c1, a.color_secondary AS away_c2,
           to_char(m.kickoff_at AT TIME ZONE ${ET}, 'Dy') AS et_weekday
      FROM matches m
      JOIN leagues l ON l.id = m.league_id
      JOIN teams h ON h.id = m.home_team_id
      JOIN teams a ON a.id = m.away_team_id
     WHERE m.slug = ${slug} AND l.slug = 'epl' LIMIT 1`)[0];
  if (!r) return null;
  const base = rowToGame(r);
  const g = {
    ...base,
    etWeekday: r.et_weekday,
    network: null,
    home: { ...base.home, shortName: r.home_short ?? null },
    away: { ...base.away, shortName: r.away_short ?? null },
  };
  const state = eplState(g.status);
  const [events, stats, players, chips] = await Promise.all([
    state === 'pre' ? [] : caught(sql`
      SELECT id, minute, minute_extra, event_type, detail, team_side, player_name, assist_name, raw->>'comments' AS comments
        FROM match_events WHERE match_id = ${g.id} AND is_current AND event_type IN ('Goal', 'Card')`, []),
    state === 'pre' ? [] : caught(sql`SELECT team_side, stats FROM match_statistics WHERE match_id = ${g.id} AND is_current`, []),
    state !== 'final' ? [] : caught(sql`
      SELECT s.team_id, s.minutes_played, s.goals, s.assists, s.saves, s.match_rating, p.full_name, p.known_as
        FROM player_match_stats s JOIN players p ON p.id = s.player_id WHERE s.match_id = ${g.id}`, []),
    caught(eplPositionChips(), new Map()),
  ]);
  const moments = momentsFromEvents(events);
  const st = (side) => stats.find((x) => x.team_side === side)?.stats ?? null;
  const compare = compareRows(st('home'), st('away'));
  const top = topPlayers(players, { homeId: g.home.id, awayId: g.away.id });
  const list = momentList(moments, { homeAbbr: g.home.abbreviation ?? '', awayAbbr: g.away.abbreviation ?? '' });
  const x = {
    rank: { home: null, away: null },
    // The table position is the EPL card's record chip ("3rd"), from the
    // same stored table /epl/standings reads.
    record: { home: chips.get(g.home.id) ?? null, away: chips.get(g.away.id) ?? null },
    spreadHome: null, total: null, openHome: null, preview: null, drive: null, diamond: null,
    stat: null, hasStats: false, mlbFoot: null, probables: null, prob: null, stake: null, open: false,
    line: null, closing: null, lastPlay: null,
    soccer: moments,
  };
  return {
    state, g, x,
    modules: eplModules({ state, hasMoments: list.length > 0, hasStats: compare.length > 0, hasPlayers: top.home.length + top.away.length > 0 }),
    moments: list, compare, players: top,
    crumb: ['EPL', matchweekLabel(g.week), g.etWeekday].filter(Boolean).join(' · '),
  };
}
