/**
 * lib/gridiron/gameDetail.js - the per-game reads behind /nfl/game/[slug].
 *
 * STORED, NOT PROXIED. The page is one server render against our own database:
 * a provider outage costs a tab its freshness, never the page. It also means
 * the brief pipeline reads the same rows the page does, so what the model was
 * told and what the reader sees cannot diverge.
 *
 * THREE PROVIDER READS, WITH DIFFERENT COVERAGE (probed 2026-08-11):
 *   events        scoring plays only. Serves PRE and REG.
 *   playerStats   per-player lines in named groups. Serves PRE and REG.
 *   teamStats     team totals. REG ONLY - zero rows for preseason.
 *
 * That last one is why the team box is a tab that JOINS rather than a section
 * that empties: in August the provider has nothing to give, and a frame with
 * nothing in it reads as broken rather than as not-yet.
 *
 * ABSENCE OVER INFERENCE, THROUGHOUT. Nothing here manufactures a zero, a
 * placeholder player, or an empty group. A group the provider did not send is
 * absent from the result, and the page renders one fewer table.
 */

import { sql } from '../db.js';
import { apiSportsFootball } from '../apiSportsFootball.js';
import { quarterIndex, parseStatLine, makeRunSummary } from './ingest.js';
import { fantasyPoints } from '../fantasy/scoring.js';
// The same en dash the line score uses for a quarter the feed did not send.
// ONE absence glyph across the gridiron surface, so a reader learns it once.
import { ABSENT } from './lineScore.js';

const PROVIDER_GAME_KEY = 'apisports_game_id';

// ---------------------------------------------------------------------------
// Fetch + store
// ---------------------------------------------------------------------------

async function teamMapByProviderId(leagueId) {
  const rows = await sql`
    SELECT id, external_ids->>'apisports_team_id' AS pid FROM teams
     WHERE league_id = ${leagueId} AND jsonb_exists(external_ids, 'apisports_team_id')`;
  return new Map(rows.map((r) => [r.pid, r.id]));
}

/**
 * Pull events + player lines for one stored match and write them.
 *
 * TWO REQUESTS PER GAME, and that is the whole cost model: the day-slate score
 * sweep stays one request for every game at once, while detail is per-game and
 * therefore rationed. See lib/pollers/preseasonWindow.js for the budget.
 *
 * Returns a summary rather than throwing, so a poller can record a partial
 * result: events landing while player lines fail is a real and survivable
 * outcome, and losing both because one threw would be worse.
 */
export async function fetchGameDetail(matchId, { includeTeamStats = false } = {}) {
  const summary = makeRunSummary();
  summary.requests = 0;
  summary.events = 0;
  summary.playerLines = 0;
  summary.errors = [];

  const m = (await sql`
    SELECT m.id, m.league_id, m.status, m.season_phase,
           m.metadata->'detail'->>'final_seen_at' AS final_seen_at,
           m.external_ids->>${PROVIDER_GAME_KEY} AS gid
      FROM matches m WHERE m.id = ${matchId} LIMIT 1`)[0];
  if (!m) throw new Error(`no match row for id ${matchId}`);
  if (!m.gid) throw new Error(`match ${matchId} carries no ${PROVIDER_GAME_KEY}`);

  const teams = await teamMapByProviderId(m.league_id);

  // --- events ---------------------------------------------------------------
  try {
    const rows = await apiSportsFootball.events(m.gid);
    summary.requests += 1;
    const mapped = [];
    rows.forEach((e, i) => {
      const q = quarterIndex(e?.quarter, summary);
      if (q == null) return;                       // counted, not guessed
      mapped.push({
        seq: i,
        quarter: q,
        quarterLabel: e?.quarter ?? null,
        clock: e?.minute ?? null,                  // the provider calls the clock "minute"
        teamId: teams.get(String(e?.team?.id)) ?? null,
        scoringType: String(e?.type ?? '').toUpperCase() || 'UNKNOWN',
        playerName: e?.player?.name ?? null,
        description: e?.comment ?? null,
        homeScore: e?.score?.home ?? null,
        awayScore: e?.score?.away ?? null,
      });
    });
    // Replace-in-place per game. A live game is re-fetched every few minutes and
    // must not accumulate duplicate touchdowns; the provider's array is
    // append-only and chronological, so a wholesale rewrite is both correct and
    // simpler than diffing.
    if (mapped.length) {
      await sql`DELETE FROM gridiron_game_events WHERE match_id = ${matchId}`;
      for (const e of mapped) {
        await sql`
          INSERT INTO gridiron_game_events
            (match_id, seq, quarter, quarter_label, clock, team_id, scoring_type,
             player_name, description, home_score, away_score)
          VALUES (${matchId}, ${e.seq}, ${e.quarter}, ${e.quarterLabel}, ${e.clock},
                  ${e.teamId}, ${e.scoringType}, ${e.playerName}, ${e.description},
                  ${e.homeScore}, ${e.awayScore})`;
      }
    }
    summary.events = mapped.length;
  } catch (err) {
    summary.errors.push(`events: ${String(err?.message ?? err).slice(0, 160)}`);
  }

  // --- player lines ---------------------------------------------------------
  try {
    const sides = await apiSportsFootball.playerStats(m.gid);
    summary.requests += 1;
    const lines = [];
    for (const side of sides ?? []) {
      const teamId = teams.get(String(side?.team?.id)) ?? null;
      for (const grp of side?.groups ?? []) {
        for (const p of grp?.players ?? []) {
          const name = p?.player?.name;
          if (!name) continue;
          const { group, stats, order, parsed } = parseStatLine(grp.name, p.statistics);
          lines.push({
            teamId, group, name,
            providerPlayerId: p?.player?.id ?? null,
            stats, order, parsed,
          });
        }
      }
    }
    if (lines.length) {
      await sql`DELETE FROM gridiron_player_lines WHERE match_id = ${matchId}`;
      for (const l of lines) {
        await sql`
          INSERT INTO gridiron_player_lines
            (match_id, team_id, stat_group, provider_player_id, player_name, stats, stat_order, parsed)
          VALUES (${matchId}, ${l.teamId}, ${l.group}, ${l.providerPlayerId}, ${l.name},
                  ${JSON.stringify(l.stats)}::jsonb, ${l.order}, ${JSON.stringify(l.parsed)}::jsonb)
          ON CONFLICT (match_id, team_id, stat_group, player_name) DO UPDATE
            SET stats = EXCLUDED.stats, stat_order = EXCLUDED.stat_order, parsed = EXCLUDED.parsed`;
      }
    }
    summary.playerLines = lines.length;
  } catch (err) {
    summary.errors.push(`players: ${String(err?.message ?? err).slice(0, 160)}`);
  }

  // --- team box (REG only) --------------------------------------------------
  // Not attempted for preseason at all. The provider returns zero rows there,
  // and spending a request to be told nothing is the kind of cost that only
  // shows up on the invoice.
  if (includeTeamStats && m.season_phase !== 'PRE') {
    try {
      const sides = await apiSportsFootball.teamStats(m.gid);
      summary.requests += 1;
      if (sides?.length) {
        const box = {};
        for (const side of sides) {
          const teamId = teams.get(String(side?.team?.id));
          if (teamId) box[teamId] = side.statistics ?? {};
        }
        await sql`
          UPDATE matches
             SET metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ team_box: box })}::jsonb,
                 updated_at = now()
           WHERE id = ${matchId}`;
        summary.teamBox = Object.keys(box).length;
      } else {
        summary.teamBox = 0;
      }
    } catch (err) {
      summary.errors.push(`teams: ${String(err?.message ?? err).slice(0, 160)}`);
    }
  }

  // --- stamp what happened -------------------------------------------------
  // The poller decides the next fetch from these two fields, so they are
  // written LAST and only when something landed. A failed fetch leaves the old
  // stamp in place and is therefore retried on the next round, rather than
  // being recorded as done.
  if (summary.events > 0 || summary.playerLines > 0) {
    const stamp = {
      detail: {
        at: new Date().toISOString(),
        // The post-final fetch, claimed once. A game marked final here is not
        // fetched again - the provider does not revise a finished preseason box
        // score, and a poller that keeps asking would spend two requests a
        // round on every game that has ever ended.
        //
        // final_seen_at, NOT the live status. The feed walks statuses backwards,
        // and reading `m.status` here meant a fetch that ran during a flap
        // stamped final:false and threw away its own claim - which is how TEN at
        // SF ended the night with an 11:51pm snapshot on its page.
        final: m.status === 'final' || m.final_seen_at != null,
      },
    };
    await writeDetailStamp(matchId, stamp.detail);
  }

  return summary;
}

/**
 * Write metadata.detail WITHOUT destroying sibling keys already in it.
 *
 * `jsonb ||` IS A SHALLOW MERGE. `metadata || '{"detail":{...}}'` replaces the
 * WHOLE detail object, so a stamp written here deleted final_seen_at, which is
 * written separately (and correctly, nested) by apiSportsImport.js. On 14 Aug
 * that cost the slate its flap immunity: the hot sweep stamped final_seen_at at
 * 02:01:37Z, this write wiped it seconds later, all three games flapped final ->
 * live, and the post-whistle fetch had nothing left to key on. It re-claimed
 * them eight minutes later off the live status, and only because the last writer
 * that round happened to be the hot sweep and not another detail fetch.
 *
 * So the merge is nested here, one level down, and:
 *
 *   FINAL_SEEN_AT IS SET-ONCE. It is the one key an incoming stamp may not win.
 *   The whole point of a timestamp is that it cannot be walked backwards, which
 *   is worth nothing if a later writer can clear it. Every other key takes the
 *   incoming value - `at` and `final` are current-state fields and SHOULD move.
 *
 * The CASE re-asserts the stored value after the incoming object has been
 * merged, which also covers the case of an incoming stamp that carries its own
 * final_seen_at: first writer wins, always.
 */
export async function writeDetailStamp(matchId, detail) {
  await sql`
    UPDATE matches
       SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
             'detail',
             COALESCE(metadata->'detail', '{}'::jsonb)
               || ${JSON.stringify(detail ?? {})}::jsonb
               || CASE
                    WHEN metadata->'detail' ? 'final_seen_at'
                    THEN jsonb_build_object('final_seen_at', metadata->'detail'->'final_seen_at')
                    ELSE '{}'::jsonb
                  END
           ),
           updated_at = now()
     WHERE id = ${matchId}`;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Everything the game page needs, in one round of reads.
 *
 * Returns null when the slug is not a gridiron match, so the route can 404
 * rather than render a shell.
 */
export async function getGamePage(slug) {
  const m = (await sql`
    SELECT m.id, m.slug, m.status, m.kickoff_at, m.season_year, m.season_phase, m.week,
           m.home_score, m.away_score, m.metadata,
           l.slug AS league_slug,
           h.id AS home_id, h.name AS home_name, h.abbreviation AS home_abbr,
           a.id AS away_id, a.name AS away_name, a.abbreviation AS away_abbr
      FROM matches m
      JOIN leagues l ON l.id = m.league_id
      LEFT JOIN teams h ON h.id = m.home_team_id
      LEFT JOIN teams a ON a.id = m.away_team_id
     WHERE m.slug = ${slug} AND l.slug IN ('nfl', 'cfb')
     LIMIT 1`)[0];
  if (!m) return null;

  const meta = m.metadata ?? {};
  const [events, lines] = await Promise.all([
    sql`SELECT seq, quarter, quarter_label, clock, team_id, scoring_type,
               player_name, description, home_score, away_score
          FROM gridiron_game_events WHERE match_id = ${m.id} ORDER BY seq`,
    sql`SELECT team_id, stat_group, player_name, stats, stat_order, parsed
          FROM gridiron_player_lines WHERE match_id = ${m.id}
         ORDER BY stat_group, player_name`,
  ]);

  return {
    id: m.id,
    slug: m.slug,
    leagueSlug: m.league_slug,
    status: m.status,
    kickoffAt: m.kickoff_at,
    seasonYear: m.season_year,
    seasonPhase: m.season_phase,
    week: m.week,
    homeScore: m.home_score,
    awayScore: m.away_score,
    lineScores: meta.line_scores ?? null,
    weekLabel: meta.apisports_week_label ?? null,
    venue: meta.venue ?? null,
    venueCity: meta.venue_city ?? null,
    teamBox: meta.team_box ?? null,
    home: { id: m.home_id, name: m.home_name, abbreviation: m.home_abbr },
    away: { id: m.away_id, name: m.away_name, abbreviation: m.away_abbr },
    events,
    lines,
  };
}

// ---------------------------------------------------------------------------
// Shaping for the page
// ---------------------------------------------------------------------------

/** Scoring plays grouped by quarter, in order. Empty array when there are none. */
export function scoringByQuarter(game) {
  const byQ = new Map();
  for (const e of game?.events ?? []) {
    if (!byQ.has(e.quarter)) byQ.set(e.quarter, []);
    byQ.get(e.quarter).push(e);
  }
  return [...byQ.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([quarter, plays]) => ({
      quarter,
      label: quarter > 4 ? (quarter === 5 ? 'OT' : `OT${quarter - 4}`) : `Q${quarter}`,
      plays,
    }));
}

/**
 * The four groups the mock puts on screen unprompted. Everything else the
 * provider sent sits behind one disclosure - present, one tap away, and not
 * competing with the passing line for the reader's first look.
 */
export const PRIMARY_GROUPS = ['passing', 'rushing', 'receiving', 'kicking'];

const SECONDARY_ORDER = ['defensive', 'interceptions', 'fumbles', 'kick_returns', 'punt_returns', 'punting'];

const GROUP_LABELS = {
  passing: 'PASSING', rushing: 'RUSHING', receiving: 'RECEIVING', kicking: 'KICKING',
  defensive: 'DEFENSE', interceptions: 'INTERCEPTIONS', fumbles: 'FUMBLES',
  kick_returns: 'KICK RETURNS', punt_returns: 'PUNT RETURNS', punting: 'PUNTING',
};

/**
 * The columns the design lock shows, per primary group, as [providerLabel,
 * heading] pairs in the mock's order.
 *
 * CURATED ONLY WHERE THE MOCK SPEAKS. The provider sends more than this -
 * passing also carries "sacks" and "two pt", receiving carries "targets" - and
 * the lock leaves them out. Any group NOT listed here renders every column the
 * provider sent, in payload order, because inventing a curation for a table
 * nobody designed would be guessing at what matters.
 */
const GROUP_COLUMNS = {
  passing: [['comp att', 'C/ATT'], ['yards', 'YDS'], ['average', 'AVG'],
    ['passing touch downs', 'TD'], ['interceptions', 'INT'], ['rating', 'RTG']],
  rushing: [['total rushes', 'ATT'], ['yards', 'YDS'], ['average', 'AVG'],
    ['rushing touch downs', 'TD'], ['longest rush', 'LONG']],
  receiving: [['total receptions', 'REC'], ['yards', 'YDS'], ['average', 'AVG'],
    ['receiving touch downs', 'TD'], ['longest reception', 'LONG']],
  kicking: [['field goals', 'FG'], ['long', 'LONG'], ['extra point', 'XP'], ['points', 'PTS']],
};

// An FPTS column belongs only where the number means something. The mock puts
// it on passing, rushing and receiving and nowhere else - not on kicking, whose
// total lib/fantasy/scoring.js states is short by design.
const FPTS_GROUPS = new Set(['passing', 'rushing', 'receiving']);

const upper = (s) => String(s ?? '').replace(/_/g, ' ').toUpperCase();

/**
 * The three formats the toggle offers, PPR first because it is the default.
 * '2qb' is deliberately absent: lib/fantasy/scoring.js explains at length that
 * 2QB describes a roster, not a scoring system, and offering it as a third
 * identical-to-PPR button would suggest otherwise.
 */
export const SCORING_FORMATS = ['ppr', 'half-ppr', 'standard'];

/**
 * One stat line's points in EVERY format, so the toggle is a client-side
 * lookup rather than a client-side calculation.
 *
 * This is the reason the scoring module never ships to the browser. The rules
 * live in one file, they run on the server, and the toggle picks between three
 * numbers that were all produced by them. A client that recomputed would be the
 * second implementation the brief rules out - and it would be the one users
 * actually see.
 */
export function pointsAllFormats(parsed) {
  const out = {};
  for (const f of SCORING_FORMATS) out[f] = fantasyPoints(parsed ?? {}, f);
  return out;
}

/**
 * Player lines for one team as render-ready tables.
 *
 * Rows carry points for all three formats and are sorted by the active one -
 * which, for the lock's data, reproduces its ordering (most yards first)
 * without a second rule to keep in step. Groups the scorer does not price keep
 * the provider's order, because the alternative is picking a column to rank by
 * and calling it the important one.
 */
export function linesByGroup(game, teamId, scoringFormat = 'ppr') {
  const byGroup = new Map();
  for (const l of game?.lines ?? []) {
    if (l.team_id !== teamId) continue;
    if (!byGroup.has(l.stat_group)) byGroup.set(l.stat_group, []);
    byGroup.get(l.stat_group).push(l);
  }

  const order = [...PRIMARY_GROUPS, ...SECONDARY_ORDER];
  const seen = new Set(order);
  // A group the provider invents next season lands at the end rather than
  // disappearing, so a new stat type shows up as an unstyled table instead of
  // as silence.
  const groups = [...order, ...[...byGroup.keys()].filter((g) => !seen.has(g)).sort()];

  return groups.filter((g) => byGroup.has(g)).map((group) => {
    const players = byGroup.get(group);
    const showFpts = FPTS_GROUPS.has(group);
    // stat_order, NOT Object.keys(stats) - see migration 062. The object came
    // back from jsonb with its keys re-sorted by the storage engine, so reading
    // them would print a defensive line as "FF, TFL, SACKS, QB HTS, TACKLES".
    const cols = GROUP_COLUMNS[group]
      ?? (players[0]?.stat_order ?? []).map((k) => [k, upper(k)]);

    const rows = players.map((p) => ({
      name: p.player_name,
      cells: cols.map(([key]) => p.stats?.[key] ?? ABSENT),
      pts: showFpts ? pointsAllFormats(p.parsed) : null,
    }));
    if (showFpts) {
      rows.sort((a, b) => b.pts[scoringFormat] - a.pts[scoringFormat]
        || a.name.localeCompare(b.name));
    }

    return {
      group,
      label: GROUP_LABELS[group] ?? upper(group),
      primary: PRIMARY_GROUPS.includes(group),
      headings: cols.map(([, h]) => h),
      showFpts,
      rows,
    };
  });
}

/**
 * The groups that enter the fantasy leaderboard. AN ALLOW-LIST, not a set of
 * exclusions, so a group the provider adds next season cannot silently start
 * scoring people.
 *
 * WHY THE OTHERS ARE OUT, each for its own reason:
 *   kicking       lib/fantasy/scoring.js says outright that it prices field
 *                 goals flat because the stat line carries makes, not
 *                 distances. A kicker's total therefore reads LOW, and putting
 *                 a known-short number in a ranked list presents it as
 *                 comparable when it is not.
 *   defensive     the same module's numbers for sacks, recoveries and defensive
 *                 touchdowns are DST components. Paying them to an individual
 *                 linebacker would be inventing an IDP format nobody chose, and
 *                 it would seat him in a table of skill players as though the
 *                 two totals meant the same thing.
 *   kick_returns  return touchdowns are named in scoring.js as a stated gap -
 *   punt_returns  they are not in its vocabulary at all, so a returner's line
 *                 would score zero and read as a bad game rather than an
 *                 unscored one.
 *   punting       not a fantasy position in any format the app supports.
 * The tables for all of them still render under PLAYER LINES. This is about
 * which numbers get ranked against each other, not what the page shows.
 */
const SCORED_GROUPS = new Set(['passing', 'rushing', 'receiving', 'fumbles']);

/**
 * FANTASY LEADERS across BOTH squads.
 *
 * ONE METHODOLOGY. Points come from lib/fantasy/scoring.js - the same function
 * the sim grades picks with - fed the `parsed` object the ingest boundary
 * produced. There is no second implementation to drift: if the sim's rules
 * change, this changes with them, including the stated limitations about
 * kickers and defences.
 *
 * A player appears once, with their groups MERGED: a quarterback who ran twice
 * is one line worth passing plus rushing, not two entries competing with each
 * other in the same table.
 */
export function fantasyLeaders(game, scoringFormat = 'ppr', limit = 5) {
  const byPlayer = new Map();
  for (const l of game?.lines ?? []) {
    if (!SCORED_GROUPS.has(l.stat_group)) continue;
    const key = `${l.team_id}|${l.player_name}`;
    if (!byPlayer.has(key)) {
      byPlayer.set(key, { teamId: l.team_id, name: l.player_name, parsed: {}, groups: [] });
    }
    const p = byPlayer.get(key);
    Object.assign(p.parsed, l.parsed ?? {});
    p.groups.push({ group: l.stat_group, stats: l.stats ?? {} });
  }

  // The prose line is format-independent - it is the stat line, not the score -
  // so it is built once and the three totals hang off it.
  const scored = [...byPlayer.values()]
    .map((p) => ({
      teamId: p.teamId,
      name: p.name,
      line: proseLine(p),
      pts: pointsAllFormats(p.parsed),
    }))
    .filter((p) => p.line !== '')
    .sort((a, b) => b.pts[scoringFormat] - a.pts[scoringFormat]
      || a.name.localeCompare(b.name));

  return scored.slice(0, limit);
}

/**
 * The combined line, in prose: "14/21, 203 yds, 2 TD · 3 att, 12 yds".
 *
 * Built from the PARSED numbers rather than the provider's display strings, so
 * a player's two groups read as one sentence instead of two fragments in
 * different formats.
 */
export function proseLine(p) {
  const s = p.parsed ?? {};
  const parts = [];
  if (s.attempts != null || s.passYds != null) {
    const bits = [];
    if (s.completions != null && s.attempts != null) bits.push(`${s.completions}/${s.attempts}`);
    if (s.passYds != null) bits.push(`${s.passYds} yds`);
    if (s.passTd) bits.push(`${s.passTd} TD`);
    if (s.int) bits.push(`${s.int} INT`);
    if (bits.length) parts.push(bits.join(', '));
  }
  if (s.rushYds != null || s.rushTd) {
    const bits = [];
    if (s.rushAtt != null) bits.push(`${s.rushAtt} att`);
    if (s.rushYds != null) bits.push(`${s.rushYds} yds`);
    if (s.rushTd) bits.push(s.rushTd === 1 ? 'TD' : `${s.rushTd} TD`);
    if (bits.length) parts.push(bits.join(', '));
  }
  if (s.rec != null || s.recYds != null) {
    const bits = [];
    if (s.rec != null) bits.push(`${s.rec} rec`);
    if (s.recYds != null) bits.push(`${s.recYds} yds`);
    if (s.recTd) bits.push(s.recTd === 1 ? 'TD' : `${s.recTd} TD`);
    if (bits.length) parts.push(bits.join(', '));
  }
  return parts.join(' · ');
}

/** Per-player fantasy points for the FPTS column inside a group table. */
export function pointsForLine(line, scoringFormat = 'ppr') {
  return fantasyPoints(line?.parsed ?? {}, scoringFormat);
}
