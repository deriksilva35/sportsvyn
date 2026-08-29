// lib/gridiron/broadcasts.js — CFB broadcast outlets into match_broadcasters.
//
// WHERE THIS CAME FROM, AND WHAT IT IS NOT. The CFBD /games payload the sync
// already reads carries NO tv field - 34 keys on a live row, none of them an
// outlet. The outlet lives on a SIBLING endpoint, /games/media, on the same
// provider and the same key we already hold. This is not a new provider; it is
// a second read against one we already pay for.
//
// THE JOIN IS THE ID WE ALREADY STORE. /games/media returns the same integer
// `id` as /games, which the sync writes to external_ids.cfbd_game_id. No name
// matching, no kickoff-time matching, no fuzzy anything - the two payloads
// agree on a primary key, so the join is exact or it is nothing.
//
// THE VOCABULARY IS COUNTED, NOT ASSUMED. 1,204 media rows across the whole
// 2026 season carry exactly two mediaType values: 'tv' (364) and 'web' (840).
// Zero rows have a null or empty outlet. An UNKNOWN mediaType is SKIPPED and
// counted, never coerced into one of ours: broadcaster_type carries a CHECK
// constraint, and a coerced value would fail the whole sync run over one row
// the provider added after we last looked.

import { sql } from '../db.js';

/** CFBD's mediaType -> our broadcaster_type. Anything else is not ours to map. */
const TYPE_MAP = { tv: 'tv', web: 'streaming' };

/**
 * ONE PRIMARY PER MATCH, CHOSEN THE SAME WAY EVERY TIME.
 *
 * 013 carries a partial unique index allowing a single is_primary row per
 * (match, country), so the choice cannot be "whichever row arrived first" - a
 * re-sync in a different order would flip it, and the flip would be visible on
 * the card. TV outranks streaming because the question is "where do I watch
 * this"; within a tier the SHORTEST name wins, then alphabetical.
 *
 * The short-name rule is not cosmetic. 31 games this season carry two tv rows
 * that are the same broadcast under two names - "CW" and "The CW Network" -
 * and a card has room for one. The on-air brand is the shorter string.
 */
export function rank(a, b) {
  const tier = (m) => (m.broadcaster_type === 'tv' ? 0 : 1);
  return tier(a) - tier(b)
    || a.broadcaster_name.length - b.broadcaster_name.length
    || a.broadcaster_name.localeCompare(b.broadcaster_name);
}

/**
 * Provider rows for ONE game -> the rows we would store, ordered, exactly one
 * of them primary. Pure: no database, no clock, no network.
 */
export function toBroadcasterRows(mediaRows, { unknownTypes } = {}) {
  const rows = [];
  for (const m of mediaRows ?? []) {
    const type = TYPE_MAP[m.mediaType];
    if (!type) { unknownTypes?.push(m.mediaType); continue; }
    const name = typeof m.outlet === 'string' ? m.outlet.trim() : '';
    if (!name) continue;
    // A PROVIDER CAN REPEAT A NAME across mediaTypes; the table's uniqueness is
    // (match, country, name), so a duplicate name here would collide with
    // itself inside a single write. First occurrence wins, ranked afterwards.
    if (rows.some((r) => r.broadcaster_name === name)) continue;
    rows.push({ broadcaster_name: name, broadcaster_type: type });
  }
  rows.sort(rank);
  return rows.map((r, i) => ({ ...r, is_primary: i === 0, display_order: i + 1 }));
}

/**
 * THE NETWORK A CARD SHOWS. One string or null - never a guess, never a join
 * of everything we hold. The card has room for the primary and nothing else.
 */
export function primaryOutlet(rows) {
  const p = (rows ?? []).find((r) => r.is_primary);
  return p ? p.broadcaster_name : null;
}

/**
 * Sync CFB broadcast outlets for a season.
 *
 * IDEMPOTENT, AND THE COUNTERS SAY WHICH KIND OF WRITE HAPPENED. `xmax = 0`
 * distinguishes an INSERT from an ON CONFLICT UPDATE, so a second run on an
 * unchanged slate reports 0 inserted and N updated rather than reporting
 * nothing and leaving "did it run?" unanswerable.
 *
 * PRIMARY IS CLEARED BEFORE IT IS SET, per match. The partial unique index
 * rejects a second primary, so a match whose primary outlet CHANGES between
 * runs would fail on the way in if the old flag were still standing.
 */
export async function syncCfbBroadcasts(leagueId, seasonYear, { fetchMedia }) {
  const summary = {
    providerRows: 0, gamesWithMedia: 0, matchedGames: 0, unmatchedGames: 0,
    inserted: 0, updated: 0, unknownMediaTypes: [], primaryChanged: 0,
  };

  const media = [];
  for (const st of ['regular', 'postseason']) {
    const page = await fetchMedia(seasonYear, st);
    if (Array.isArray(page)) media.push(...page);
  }
  summary.providerRows = media.length;

  const byGame = new Map();
  for (const m of media) {
    const key = String(m.id);
    if (!byGame.has(key)) byGame.set(key, []);
    byGame.get(key).push(m);
  }
  summary.gamesWithMedia = byGame.size;
  if (byGame.size === 0) return summary;

  // THE MATCH IDS WE ACTUALLY HOLD. A media row for a game we never ingested
  // (an FCS-only matchup the games sync skips by policy) has nowhere to go,
  // and is counted rather than silently dropped.
  const ids = [...byGame.keys()];
  const matches = await sql`
    SELECT id, external_ids->>'cfbd_game_id' AS cfbd_id
      FROM matches
     WHERE league_id = ${leagueId}
       AND season_year = ${seasonYear}
       AND external_ids->>'cfbd_game_id' = ANY(${ids})`;
  const matchByCfbd = new Map(matches.map((m) => [m.cfbd_id, m.id]));

  for (const [cfbdId, mediaRows] of byGame) {
    const matchId = matchByCfbd.get(cfbdId);
    if (!matchId) { summary.unmatchedGames += 1; continue; }
    const rows = toBroadcasterRows(mediaRows, { unknownTypes: summary.unknownMediaTypes });
    if (rows.length === 0) continue;
    summary.matchedGames += 1;

    const cleared = await sql`
      UPDATE match_broadcasters SET is_primary = false, updated_at = now()
       WHERE match_id = ${matchId} AND country_code = 'US' AND is_primary = true
         AND broadcaster_name IS DISTINCT FROM ${rows[0].broadcaster_name}
      RETURNING id`;
    summary.primaryChanged += cleared.length;

    for (const r of rows) {
      const [w] = await sql`
        INSERT INTO match_broadcasters
          (match_id, country_code, broadcaster_name, broadcaster_type,
           is_primary, display_order, language_code, data_provider_synced_at)
        VALUES (${matchId}, 'US', ${r.broadcaster_name}, ${r.broadcaster_type},
                ${r.is_primary}, ${r.display_order}, 'en', now())
        ON CONFLICT (match_id, country_code, broadcaster_name) DO UPDATE
           SET broadcaster_type = EXCLUDED.broadcaster_type,
               is_primary = EXCLUDED.is_primary,
               display_order = EXCLUDED.display_order,
               data_provider_synced_at = EXCLUDED.data_provider_synced_at,
               updated_at = now()
        RETURNING (xmax = 0) AS inserted`;
      if (w?.inserted) summary.inserted += 1; else summary.updated += 1;
    }
  }
  summary.unknownMediaTypes = [...new Set(summary.unknownMediaTypes)];
  return summary;
}
