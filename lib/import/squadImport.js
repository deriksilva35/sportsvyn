// lib/import/squadImport.js — idempotent squad import from API-Sports.
//
// Given a Sportsvyn team_id + the team's API-Sports id, pulls the team's
// current squad and upserts each player into the players table keyed on
// players.external_ids->>'api_sports'.
//
// IDEMPOTENT BY DESIGN. Re-running on the same team is a no-op for player
// counts: existing players (matched by API-Sports id) are UPDATED in
// place; only genuinely-new players are inserted. The function NEVER
// deletes a player from the players table — a player who's been dropped
// from the squad in API-Sports keeps their players row but their
// current_team_id may be reassigned on a later import to a different
// team (handled below as a "transfer" warning, not a failure).
//
// IDENTITY KEY: players.external_ids->>'api_sports' (jsonb path).
// NO UNIQUE INDEX exists on this path — the upsert is done via a
// SELECT-then-INSERT/UPDATE pattern inside a sequential per-player
// loop. That's safe for a single-tenant import script (no concurrent
// writers) but would need a partial unique index before a
// many-concurrent-callers ship. Flagging here, not adding the index
// (no migrations this build).
//
// COLLISION GUARDS — three classes recorded in the result, NOT silently
// merged:
//   1. slug_collision    — generated slug matches a different player's
//                          existing slug. Disambiguates with api_id
//                          suffix on the new row's slug; logs both ids.
//   2. transfer          — incoming api_sports_id already maps to a
//                          player row whose current_team_id is set to
//                          a DIFFERENT team. We update current_team_id
//                          to the new team and warn.
//   3. hyphenated_surname — names containing a literal hyphen (e.g.
//                          "Gannon-Doak"). Slug preserves the hyphen
//                          (Gannon-Doak → gannon-doak); warning is
//                          recorded for visibility because the gloss
//                          grounding gate has known hyphen issues
//                          (#107 — separate from slug correctness).

import { sql } from '../db.js';
import { apiSports } from '../apiSports.js';

// Strip accents, lowercase, hyphenate. Preserves intrinsic hyphens in
// names like "Gannon-Doak" (the hyphen is in the kept-character set).
// Apostrophes are stripped — "O'Brien" → "obrien" (standard slug
// convention; lossy for the apostrophe but never collides on a real
// name with the apostrophe variant retained).
export function slugify(name) {
  return String(name ?? '')
    .normalize('NFD')                       // split combining diacritics
    .replace(/[̀-ͯ]/g, '')        // strip diacritic marks (NFD combining range)
    .replace(/['‘’]/g, '')        // strip ASCII + curly apostrophes
    .toLowerCase()
    .replace(/[^a-z0-9-\s]/g, ' ')          // anything that isn't [a-z0-9-\s] → space
    .trim()
    .replace(/\s+/g, '-')                   // collapse internal whitespace → hyphen
    .replace(/-+/g, '-')                    // collapse multi-hyphens
    .replace(/^-|-$/g, '');                 // trim leading/trailing hyphens
}

// API-Sports returns 'Goalkeeper' | 'Defender' | 'Midfielder' | 'Attacker'.
// Normalize to a tight 4-bucket enum so the indexed players.position
// column has predictable values. The raw API string is preserved in
// metadata.raw_position so editorial / display can show the original.
export function normalizePosition(raw) {
  if (!raw) return null;
  const r = String(raw).toLowerCase();
  if (r.startsWith('goal'))     return 'GK';
  if (r.startsWith('defend'))   return 'DEF';
  if (r.startsWith('midfield')) return 'MID';
  if (r.startsWith('attack') || r.startsWith('forward')) return 'ATT';
  return null;
}

// =============================================================================
// Main entry: import a single team's squad.
// =============================================================================
export async function importSquadForTeam({ teamId, apiSportsTeamId }) {
  const startedAt = new Date();

  const resp = await apiSports.squad(apiSportsTeamId);
  if (!Array.isArray(resp) || resp.length === 0 || !resp[0]) {
    return {
      ok: false,
      error: 'no_squad_response',
      teamId,
      apiSportsTeamId,
      startedAt,
      finishedAt: new Date(),
    };
  }
  const squad = resp[0];
  const players = Array.isArray(squad.players) ? squad.players : [];

  const result = {
    ok: true,
    teamId,
    apiSportsTeamId,
    teamName: squad.team?.name,
    apiCount: players.length,
    inserted: 0,
    updated: 0,
    skippedCollision: 0,
    collisions: [],
    warnings: [],
    perPlayer: [],
    startedAt,
  };

  for (const p of players) {
    const apiPlayerId = String(p.id);
    const name = p.name ?? null;
    const position = normalizePosition(p.position);

    // 1. Look up by stable API id.
    const existing = await sql`
      SELECT id, slug, full_name, current_team_id
        FROM players
       WHERE external_ids->>'api_sports' = ${apiPlayerId}
       LIMIT 1
    `;

    // Hyphenated-surname surface — logged, never blocking.
    if (name && name.includes('-')) {
      result.warnings.push({
        kind: 'hyphenated_surname',
        player: name,
        api_id: apiPlayerId,
      });
    }

    if (existing.length > 0) {
      const e = existing[0];

      // Transfer surface — same player, different team than current_team_id.
      if (e.current_team_id != null && e.current_team_id !== teamId) {
        result.warnings.push({
          kind: 'transfer',
          player: name,
          api_id: apiPlayerId,
          from_team_id: e.current_team_id,
          to_team_id: teamId,
        });
      }

      await sql`
        UPDATE players
           SET full_name        = ${name},
               known_as         = ${name},
               position         = ${position},
               current_team_id  = ${teamId},
               current_team_jersey_number = ${p.number ?? null},
               photo_url_source = ${p.photo ?? null},
               metadata = jsonb_set(
                 jsonb_set(
                   COALESCE(metadata, '{}'::jsonb),
                   '{raw_position}', to_jsonb(${p.position ?? null}::text), true
                 ),
                 '{imported_age}', to_jsonb(${p.age ?? null}::int), true
               ),
               data_provider_synced_at = now(),
               updated_at = now()
         WHERE id = ${e.id}
      `;
      result.updated++;
      result.perPlayer.push({
        api_id: apiPlayerId,
        name,
        action: 'updated',
        player_id: e.id,
      });
      continue;
    }

    // 2. Not found by api id — new insert. Check slug collision first.
    const baseSlug = slugify(name);
    if (!baseSlug) {
      result.collisions.push({
        kind: 'unslugifiable',
        api_id: apiPlayerId,
        name,
      });
      result.skippedCollision++;
      continue;
    }

    const slugClash = await sql`
      SELECT id, external_ids->>'api_sports' AS api_id, full_name
        FROM players
       WHERE slug = ${baseSlug}
       LIMIT 1
    `;

    let finalSlug = baseSlug;
    if (slugClash.length > 0) {
      finalSlug = `${baseSlug}-${apiPlayerId}`;
      result.collisions.push({
        kind: 'slug_collision',
        attempted_slug: baseSlug,
        resolved_slug: finalSlug,
        new_api_id: apiPlayerId,
        new_name: name,
        existing_player_id: slugClash[0].id,
        existing_api_id: slugClash[0].api_id,
        existing_name: slugClash[0].full_name,
      });
    }

    await sql`
      INSERT INTO players (
        slug, full_name, known_as, position, current_team_id,
        current_team_jersey_number, photo_url_source,
        external_ids, metadata, data_provider_synced_at
      ) VALUES (
        ${finalSlug},
        ${name},
        ${name},
        ${position},
        ${teamId},
        ${p.number ?? null},
        ${p.photo ?? null},
        ${JSON.stringify({ api_sports: apiPlayerId })}::jsonb,
        ${JSON.stringify({
          source: 'api-sports',
          raw_position: p.position ?? null,
          imported_age: p.age ?? null,
        })}::jsonb,
        now()
      )
    `;
    result.inserted++;
    result.perPlayer.push({
      api_id: apiPlayerId,
      name,
      action: 'inserted',
      slug: finalSlug,
    });
  }

  result.finishedAt = new Date();
  return result;
}
