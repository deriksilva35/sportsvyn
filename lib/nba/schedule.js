// lib/nba/schedule.js - /nba/v1/games -> matches rows, and the re-sync that
// keeps them true. Shaping is PURE; the writer is idempotent and has a dry run.
//
// THE POLLER SEES ONLY OUR ROWS. A league with no matches rows is a league the
// live poller cannot see, whatever the feed says - this file is what makes the
// NBA visible to everything else (lib/mlb/schedule.js says the same for MLB).
//
// THE TIP IS NOT SETTLED UNTIL IT HAPPENS. The 20 Oct 2026 opener BOS @ DET is
// filed at 19:00Z (3pm ET) with `status` equal to that datetime - the shape of
// a placeholder. So kickoff_at is RE-WRITTEN on every re-sync where the feed
// moved it (changes[] names each move), and the live poller corrects it again
// on the day (kickoffOf). Anything that LOCKS on a tip must read the row's
// kickoff_at at the moment it decides - never a copy taken earlier.
//
// SLUG: nba-<filed day>-<away>-<home>, globally unique by the nba- prefix. A
// slug once written is a public URL and is kept unless the game's DAY or CLUBS
// change; a moved game takes the base slug for its new day, or -g2 if a row
// outside the batch already holds it. The NBA does not play doubleheaders, so
// -g2 is a collision guard, not a format.
//
// THE UPSERT KEYS ON bdl_game_id (the partial unique index
// idx_matches_bdl_game_id on (league_id, external_ids->>'bdl_game_id')), never
// on the slug.
//
// A LIVE GAME BELONGS TO THE POLLER. A row BDL calls in progress gets its
// clubs, slug and tip from here and nothing of its state - status, score and
// live_state are the poller's.

import { fromBdlNba } from './ingest.js';
// THE WRITE ORDER IS MLB's, unchanged: pure, sport-free, and already proven on
// the 25 Sep moved-game case (a slug one row vacates is another's target).
import { slugWriteOrder } from '../mlb/schedule.js';

const BDL = 'https://api.balldontlie.io';
const DAY = 86_400_000;
export const NBA_RESYNC_SOURCE = 'nba-schedule';
const isoDay = (t) => new Date(t).toISOString().slice(0, 10);
const lower = (v) => String(v ?? '').trim().toLowerCase();

async function bdl(path, { fetchImpl = fetch, key = process.env.BDL_API_KEY } = {}) {
  if (!key) throw new Error('BDL_API_KEY missing in env');
  return fetchImpl(`${BDL}${path}`, { headers: { Authorization: key } });
}

/** Walk a /nba/v1/games query's cursor. */
async function walk(query, opts = {}, maxCalls = 30) {
  const out = []; let cursor = null; let calls = 0;
  do {
    const res = await bdl(`/nba/v1/games?${query}&per_page=100${cursor ? `&cursor=${cursor}` : ''}`, opts);
    if (!res.ok) throw new Error(`BDL ${res.status} on /nba/v1/games`);
    const j = await res.json(); calls += 1;
    out.push(...(j?.data ?? []));
    cursor = j?.meta?.next_cursor ?? null;
  } while (cursor && calls < maxCalls);
  return { rows: out, calls, truncated: Boolean(cursor) };
}

/** Every game of a season (2026 = 2026-27). About 13 pages of 100. */
export function fetchNbaSeason(season, opts = {}) {
  return walk(`seasons[]=${encodeURIComponent(season)}`, opts, 40);
}

/** Every game filed on a day in [fromDay, toDay]. */
export async function fetchNbaWindow(fromDay, toDay, opts = {}) {
  const days = [];
  for (let t = Date.parse(`${fromDay}T00:00:00Z`); t <= Date.parse(`${toDay}T00:00:00Z`); t += DAY) days.push(isoDay(t));
  return walk(days.map((d) => `dates[]=${d}`).join('&'), opts);
}

/** One game by id: { row } when BDL has it, { gone: true } on a 404. Throws otherwise. */
export async function fetchNbaGame(id, opts = {}) {
  const res = await bdl(`/nba/v1/games/${encodeURIComponent(id)}`, opts);
  if (res.status === 404) return { gone: true };
  if (!res.ok) throw new Error(`BDL ${res.status} on /nba/v1/games/${id}`);
  return { row: (await res.json())?.data ?? null };
}

/** PURE. The day a game is filed under (the provider's `date`). */
export function gameDay(row) {
  const d = String(row?.date ?? '');
  return /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
}

const slugOf = (day, away, home, n = 1) => `nba-${day}-${away}-${home}${n > 1 ? `-g${n}` : ''}`;

/** PURE. `nba-<day>-<away>-<home>[-g<n>]` -> its parts, or null. */
export function parseNbaSlug(slug) {
  const m = /^nba-(\d{4}-\d{2}-\d{2})-([a-z0-9]+)-([a-z0-9]+?)(?:-g(\d+))?$/.exec(String(slug ?? ''));
  return m ? { day: m[1], away: m[2], home: m[3], n: m[4] ? Number(m[4]) : 1 } : null;
}

/**
 * PURE. The slug each row of a batch is written with.
 *   existingByBdl  Map(bdl id -> slug held now)
 *   takenElsewhere Set(slug) held by rows outside the batch
 * Keepers (day and clubs unchanged) first; then new or moved rows take the
 * first free of base, -g2, ... in tip order, then id.
 */
export function planNbaSlugs(rows = [], existingByBdl = new Map(), takenElsewhere = new Set()) {
  const out = new Map(); const used = new Set(takenElsewhere); const fresh = [];
  for (const r of rows) {
    const day = gameDay(r); const away = lower(r?.visitor_team?.abbreviation); const home = lower(r?.home_team?.abbreviation);
    if (!day || !away || !home || r?.id == null) continue;
    const cur = existingByBdl.get(String(r.id)) ?? null;
    const p = parseNbaSlug(cur);
    if (p && p.day === day && p.away === away && p.home === home && !used.has(cur)) { out.set(String(r.id), cur); used.add(cur); }
    else fresh.push({ r, day, away, home });
  }
  fresh.sort((a, b) => (Date.parse(a.r.datetime ?? '') - Date.parse(b.r.datetime ?? '')) || (Number(a.r.id) - Number(b.r.id)));
  for (const { r, day, away, home } of fresh) {
    let n = 1;
    while (used.has(slugOf(day, away, home, n))) n += 1;
    const s = slugOf(day, away, home, n);
    out.set(String(r.id), s); used.add(s);
  }
  return out;
}

/**
 * PURE. One row -> the columns matches holds, or null when it cannot be
 * written whole (an unresolved club, no tip, no phase, an unmapped status).
 */
export function shapeNbaMatch(row, slug, teamIdByBdl = new Map(), unmapped = []) {
  const n = fromBdlNba(row, unmapped);
  const homeTeamId = teamIdByBdl.get(String(row?.home_team?.id)) ?? null;
  const awayTeamId = teamIdByBdl.get(String(row?.visitor_team?.id)) ?? null;
  const kick = Date.parse(n.kickoffAt ?? '');
  if (!slug || !homeTeamId || !awayTeamId || !Number.isFinite(kick) || n.seasonPhase == null || n.status == null) return null;
  return {
    slug, homeTeamId, awayTeamId,
    kickoffAt: new Date(kick).toISOString(),
    status: n.status,
    homeScore: n.homeScore, awayScore: n.awayScore,
    seasonYear: n.seasonYear,
    seasonPhase: n.seasonPhase,
    // NO WEEKS in this sport: every week-grouping reader is football-shaped
    // and must find nothing here.
    week: null,
    // THE NBA CUP stage rides metadata; null on every ordinary game.
    metadata: { ist_stage: n.istStage },
    externalIds: { bdl_game_id: String(row.id) },
  };
}

/**
 * Upsert a batch. Returns { inserted, updated, refused, unmapped, changes }.
 * changes names every row whose slug, tip or status moved, for the operator -
 * a moved tip is exactly the 20 Oct placeholder resolving.
 */
export async function writeNbaMatches(sql, leagueId, rows, { dryRun = false } = {}) {
  const teams = await sql`
    SELECT id, external_ids->>'bdl_team_id' AS pid FROM teams
     WHERE league_id = ${leagueId} AND jsonb_exists(external_ids, 'bdl_team_id')`;
  const teamIdByBdl = new Map(teams.map((t) => [t.pid, t.id]));
  const list = (rows ?? []).filter((r) => r?.id != null);
  const ids = list.map((r) => String(r.id));
  const existingRows = ids.length ? await sql`
    SELECT id, slug, status, kickoff_at, external_ids->>'bdl_game_id' AS bdl FROM matches
     WHERE league_id = ${leagueId} AND external_ids->>'bdl_game_id' = ANY(${ids})` : [];
  const existing = new Map(existingRows.map((e) => [String(e.bdl), e]));
  const prefixes = [...new Set(list.map((r) => {
    const d = gameDay(r); const a = lower(r?.visitor_team?.abbreviation); const h = lower(r?.home_team?.abbreviation);
    return d && a && h ? `nba-${d}-${a}-${h}` : null;
  }).filter(Boolean))];
  const held = prefixes.length ? await sql`
    SELECT slug, external_ids->>'bdl_game_id' AS bdl FROM matches WHERE slug LIKE ANY(${prefixes.map((p) => `${p}%`)})` : [];
  const inBatch = new Set(ids);
  const takenElsewhere = new Set(held.filter((h) => !inBatch.has(String(h.bdl))).map((h) => h.slug));
  const plan = planNbaSlugs(list, new Map([...existing].map(([b, e]) => [b, e.slug])), takenElsewhere);

  const unmapped = []; const refused = []; const changes = [];
  let inserted = 0; let updated = 0;
  for (const r of list) if (!plan.has(String(r.id))) refused.push({ id: r.id, slug: null });
  const byId = new Map(list.map((r) => [String(r.id), r]));
  const current = new Map([...existing].map(([b, e]) => [b, e.slug]));
  const steps = slugWriteOrder(new Map(ids.filter((b) => plan.has(b)).map((b) => [b, plan.get(b)])), current);
  for (const step of steps) {
    const bdlId = step.bdl;
    const row = byId.get(bdlId);
    if (step.temp) {
      if (!dryRun) await sql`UPDATE matches SET slug = ${step.slug} WHERE id = ${existing.get(bdlId).id}`;
      continue;
    }
    const g = shapeNbaMatch(row, step.slug, teamIdByBdl, unmapped);
    if (!g) { refused.push({ id: row.id, slug: step.slug }); continue; }
    const prev = existing.get(bdlId) ?? null;
    const ext = JSON.stringify(g.externalIds);
    const meta = JSON.stringify(g.metadata);
    const liveOnFeed = g.status === 'live';
    if (prev) {
      const kickFrom = new Date(prev.kickoff_at).toISOString();
      const statusTo = liveOnFeed ? prev.status : g.status;
      if (prev.slug !== g.slug || kickFrom !== g.kickoffAt || prev.status !== statusTo) {
        changes.push({ id: prev.id, bdl: bdlId, action: 'update', slugFrom: prev.slug, slugTo: g.slug,
          kickoffFrom: kickFrom, kickoffTo: g.kickoffAt, statusFrom: prev.status, statusTo, liveOnFeed });
      }
      if (dryRun) { updated += 1; continue; }
      if (liveOnFeed || prev.status === 'live') {
        // THE POLLER'S ROW: clubs, slug and tip only. A game we hold as live
        // keeps its state even if the feed has already flipped it - the poller
        // writes the final, with its push and final_seen_at.
        await sql`
          UPDATE matches SET slug = ${g.slug}, home_team_id = ${g.homeTeamId}, away_team_id = ${g.awayTeamId},
                 kickoff_at = ${g.kickoffAt}, season_year = ${g.seasonYear}, season_phase = ${g.seasonPhase},
                 metadata = COALESCE(metadata, '{}'::jsonb) || ${meta}::jsonb,
                 external_ids = matches.external_ids || ${ext}::jsonb,
                 data_provider_synced_at = now(), updated_at = now()
           WHERE id = ${prev.id}`;
      } else {
        await sql`
          UPDATE matches SET slug = ${g.slug}, home_team_id = ${g.homeTeamId}, away_team_id = ${g.awayTeamId},
                 kickoff_at = ${g.kickoffAt}, status = ${g.status},
                 home_score = CASE WHEN ${g.status} = 'scheduled' THEN NULL
                                   ELSE COALESCE(${g.homeScore}::int, matches.home_score) END,
                 away_score = CASE WHEN ${g.status} = 'scheduled' THEN NULL
                                   ELSE COALESCE(${g.awayScore}::int, matches.away_score) END,
                 season_year = ${g.seasonYear}, season_phase = ${g.seasonPhase},
                 -- ist_stage is top-level, so one level of || is the right depth.
                 metadata = COALESCE(metadata, '{}'::jsonb) || ${meta}::jsonb,
                 external_ids = matches.external_ids || ${ext}::jsonb,
                 data_provider_synced_at = now(), updated_at = now()
           WHERE id = ${prev.id}`;
      }
      updated += 1;
    } else {
      changes.push({ id: null, bdl: bdlId, action: 'insert', slugFrom: null, slugTo: g.slug,
        kickoffFrom: null, kickoffTo: g.kickoffAt, statusFrom: null, statusTo: g.status, liveOnFeed });
      if (dryRun) { inserted += 1; continue; }
      await sql`
        INSERT INTO matches (league_id, slug, home_team_id, away_team_id, kickoff_at, status,
                             home_score, away_score, season_year, season_phase, week,
                             metadata, external_ids, data_provider_synced_at, created_at, updated_at)
        VALUES (${leagueId}, ${g.slug}, ${g.homeTeamId}, ${g.awayTeamId}, ${g.kickoffAt}, ${g.status},
                ${g.status === 'scheduled' ? null : g.homeScore}, ${g.status === 'scheduled' ? null : g.awayScore},
                ${g.seasonYear}, ${g.seasonPhase}, ${g.week},
                ${meta}::jsonb, ${ext}::jsonb, now(), now(), now())`;
      inserted += 1;
    }
  }
  return { inserted, updated, refused, unmapped, changes };
}

/** PURE. Is this hourly tick due? Always - one or two calls, and a placeholder tip must not wait a day. */
export function nbaResyncWindow(now = new Date()) {
  return { from: isoDay(new Date(now).getTime() - DAY), to: isoDay(new Date(now).getTime() + 14 * DAY) };
}

/**
 * Re-sync [from, to] (filed days; default yesterday .. +14). Games of ours in
 * the window that BDL no longer lists are looked up one by one: moved (the
 * row comes back with its new day) or gone (scheduled -> cancelled; a played
 * game is never touched).
 */
export async function resyncNbaSchedule(sql, { now = new Date(), from = null, to = null, dryRun = false, fetchImpl = fetch, key = process.env.BDL_API_KEY, log = () => {} } = {}) {
  const w = nbaResyncWindow(now);
  const fromDay = from ?? w.from; const toDay = to ?? w.to;
  const opts = { fetchImpl, key };
  const [league] = await sql`SELECT id FROM leagues WHERE slug = 'nba' LIMIT 1`;
  if (!league) return { ok: false, reason: 'no-league-row' };
  const { rows, calls: windowCalls } = await fetchNbaWindow(fromDay, toDay, opts);
  let calls = windowCalls;
  const seen = new Set(rows.map((r) => String(r.id)));
  const ours = await sql`
    SELECT m.id, m.slug, m.status, external_ids->>'bdl_game_id' AS bdl FROM matches m
     WHERE m.league_id = ${league.id}
       AND m.kickoff_at >= ${`${fromDay}T00:00:00Z`}::timestamptz
       AND m.kickoff_at <  ${`${toDay}T00:00:00Z`}::timestamptz + interval '2 days'
       AND jsonb_exists(m.external_ids, 'bdl_game_id')`;
  const cancelled = []; const unlisted = [];
  for (const o of ours) {
    if (seen.has(String(o.bdl))) continue;
    const r = await fetchNbaGame(o.bdl, opts); calls += 1;
    if (r.row) { rows.push(r.row); seen.add(String(o.bdl)); unlisted.push({ id: o.id, bdl: o.bdl, moved: gameDay(r.row) }); continue; }
    if (!r.gone) continue;
    if (!['scheduled', 'postponed'].includes(o.status)) { unlisted.push({ id: o.id, bdl: o.bdl, gone: true, kept: o.status }); continue; }
    cancelled.push({ id: o.id, bdl: o.bdl, slug: o.slug, statusFrom: o.status });
    if (!dryRun) await sql`UPDATE matches SET status = 'cancelled', updated_at = now() WHERE id = ${o.id} AND status IN ('scheduled', 'postponed')`;
  }
  const res = await writeNbaMatches(sql, league.id, rows, { dryRun });
  const summary = {
    ok: res.refused.length === 0, from: fromDay, to: toDay, calls, fetched: rows.length,
    inserted: res.inserted, updated: res.updated, refused: res.refused, unmapped: res.unmapped,
    changes: res.changes, cancelled, unlisted, dryRun,
  };
  log(`[nba-schedule] ${fromDay}..${toDay} fetched ${rows.length} | changes ${res.changes.length} | cancelled ${cancelled.length} | refused ${res.refused.length}`);
  return summary;
}
