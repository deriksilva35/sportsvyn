// lib/rankings/publishNflPowerZ.js - one weekly edition of nfl-power-z.
//
// WHEN: after the regular-season week's last game - completedWeek(), the same
// "newest REG week with no non-final games" the Elo board is labelled with, so
// the Tuesday power-edition cron runs it after Monday night by construction.
// A re-run for the same week REPLACES that week's edition (editionSlotFor).
//
// WHAT: rankPowerZ() over this season's REG finals through that week - no other
// season, no carryover. Each entry keeps the full row in `inputs` (record, the
// components with adjPA RAW, the z-scores, power at full precision); `score` is
// power rounded to 2 places, which numeric(4,2) holds (power is in SDs, not
// 0-10). Movement is against the previous edition of THIS list.
//
// WHAT IT NEVER TOUCHES: nfl-power, and teams.current_power_rank/score/movement
// - the Elo board stays the published one until Derik says otherwise.

import { sql as defaultSql } from '../db.js';
import { rankPowerZ, METHODOLOGY_VERSION, WEIGHTS } from './nflPowerZ.js';
import { completedWeek, editionSlotFor, parseForWeek } from './publishGridironEdition.js';

export const LIST_SLUG = 'nfl-power-z';

/** This season's regular-season finals through `week`, with our team ids. */
export async function loadSeasonFinals(season, week, { sql = defaultSql } = {}) {
  return sql`
    SELECT m.week, h.id AS home_id, h.abbreviation AS home, a.id AS away_id, a.abbreviation AS away,
           m.home_score, m.away_score
      FROM matches m
      JOIN leagues l ON l.id = m.league_id AND l.slug = 'nfl'
      JOIN teams h ON h.id = m.home_team_id
      JOIN teams a ON a.id = m.away_team_id
     WHERE m.season_year = ${season} AND m.season_phase = 'REG' AND m.status = 'final'
       AND m.week <= ${week} AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
     ORDER BY m.week, m.kickoff_at, m.id`;
}

/** PURE. Movement against the previous edition's ranks: Map(team_id -> rank). */
export function withMovement(table, prevRankByTeam = new Map()) {
  return table.map((r) => {
    const prev = prevRankByTeam.get(r.teamId) ?? null;
    return { ...r, previousRank: prev, rankMovement: prev == null ? null : prev - r.rank,
      movementLabel: prev == null ? 'new' : prev > r.rank ? 'up' : prev < r.rank ? 'down' : 'hold' };
  });
}

/**
 * Publish (apply) or plan (dry run) this week's edition.
 * @returns { summary } - forWeek, games, teams, the top five, edition number/slot
 */
export async function publishNflPowerZ({ apply = false, sql = defaultSql, now = new Date(), forWeek = null } = {}) {
  const wk = forWeek ?? await completedWeek('nfl');
  if (wk.season == null || wk.week == null) return { summary: { ok: false, reason: 'no-completed-week' } };
  const games = await loadSeasonFinals(wk.season, wk.week, { sql });
  const idByAbbr = new Map();
  for (const g of games) { idByAbbr.set(g.home, g.home_id); idByAbbr.set(g.away, g.away_id); }
  const table = rankPowerZ(games).map((r) => ({ ...r, teamId: idByAbbr.get(r.team) }));

  const [list] = await sql`SELECT id FROM ranking_lists WHERE slug = ${LIST_SLUG} LIMIT 1`;
  if (!list) return { summary: { ok: false, reason: `no ranking_list '${LIST_SLUG}' (migration 115)` } };
  const eds = await sql`SELECT id, edition_number, published_at, notes, is_current FROM ranking_editions
                         WHERE ranking_list_id = ${list.id} ORDER BY edition_number DESC`;
  const current = eds.find((e) => e.is_current) ?? eds[0] ?? null;
  const prior = current ? { id: current.id, editionNumber: current.edition_number, publishedAt: current.published_at, forWeek: parseForWeek(current.notes) } : null;
  const slot = editionSlotFor({ prior, forWeek: wk, lastNumber: eds.length ? eds[0].edition_number : -1, now });
  // movement against the edition this one follows - the one before a replaced edition
  const baseline = slot.replaces ? eds.find((e) => e.edition_number < prior.editionNumber) : current;
  const prevRanks = baseline
    ? new Map((await sql`SELECT team_id, rank FROM ranking_entries WHERE ranking_edition_id = ${baseline.id}`).map((r) => [r.team_id, r.rank]))
    : new Map();
  const rows = withMovement(table, prevRanks);

  const summary = { ok: true, forWeek: wk, games: games.length, teams: rows.length, edition: slot.editionNumber, slot: slot.reason,
    top: rows.slice(0, 5).map((r) => `${r.rank} ${r.team} ${r.power.toFixed(3)}`) };
  if (!apply) return { summary: { ...summary, dryRun: true } };

  if (slot.replaces) await sql`DELETE FROM ranking_editions WHERE id = ${prior.id}`;
  const notes = JSON.stringify({ forWeek: wk, weights: WEIGHTS, games: games.length, source: 'lib/rankings/nflPowerZ.js' });
  const [ed] = await sql`
    INSERT INTO ranking_editions (ranking_list_id, edition_number, edition_label, methodology_version,
                                  editorial_weight, sites_weight, user_weight, status, is_current, published_at, notes)
    VALUES (${list.id}, ${slot.editionNumber}, ${`Week ${wk.week} · ${wk.season}`}, ${METHODOLOGY_VERSION},
            0, 0, 0, 'published', false, ${new Date(now).toISOString()}, ${notes})
    RETURNING id`;
  for (const r of rows) {
    await sql`
      INSERT INTO ranking_entries (ranking_edition_id, entity_type, team_id, rank, score, previous_rank, rank_movement, movement_label, inputs)
      VALUES (${ed.id}, 'team', ${r.teamId}, ${r.rank}, ${Math.round(r.power * 100) / 100}, ${r.previousRank}, ${r.rankMovement}, ${r.movementLabel},
              ${JSON.stringify({ team: r.team, record: r.record, games: r.games, skipped: r.skipped, components: r.components, z: r.z, power: r.power })}::jsonb)`;
  }
  await sql`UPDATE ranking_editions SET is_current = false, updated_at = now() WHERE ranking_list_id = ${list.id} AND id <> ${ed.id} AND is_current`;
  await sql`UPDATE ranking_editions SET is_current = true, updated_at = now() WHERE id = ${ed.id}`;
  return { summary: { ...summary, editionId: ed.id } };
}
