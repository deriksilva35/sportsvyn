// lib/rankings/nflPowerZReads.js - the current nfl-power-z edition, for the
// dark hub's Power tab - the NFL's SERVED board since tue-13 (the hidden
// ?tab=power-z it was reviewed on is gone). By slug, NOT by is_active: the list
// was created inactive (migration 115) and serving it wrote nothing to it.
import { sql as defaultSql } from '../db.js';

export async function getPowerZBoard({ sql = defaultSql } = {}) {
  const rows = await sql`
    SELECT ed.edition_number, ed.edition_label, ed.published_at,
           e.rank, e.rank_movement, e.movement_label, e.inputs,
           t.name, t.abbreviation, t.slug AS team_slug
      FROM ranking_entries e
      JOIN ranking_editions ed ON ed.id = e.ranking_edition_id AND ed.is_current AND ed.status = 'published'
      JOIN ranking_lists rl ON rl.id = ed.ranking_list_id AND rl.slug = 'nfl-power-z'
      JOIN teams t ON t.id = e.team_id
     ORDER BY e.rank`;
  if (!rows.length) return null;
  return {
    editionNumber: rows[0].edition_number, editionLabel: rows[0].edition_label, publishedAt: rows[0].published_at,
    rows: rows.map((r) => ({
      rank: r.rank, movement: r.rank_movement, movementLabel: r.movement_label,
      team: r.abbreviation, name: r.name, slug: r.team_slug,
      record: r.inputs?.record?.text ?? null,
      // the table shows adjPA NEGATED - higher is better - as the Mac's table does
      adjPF: r.inputs?.components?.adjPF ?? null,
      adjPAShown: r.inputs?.components?.adjPA == null ? null : -r.inputs.components.adjPA,
      win: r.inputs?.components?.win ?? null,
      qor: r.inputs?.components?.qorB ?? null,
      power: r.inputs?.power ?? null,
    })),
  };
}
