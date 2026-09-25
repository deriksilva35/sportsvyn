// lib/mlb/schedule.js - /mlb/v1/games -> matches rows. The shaping is PURE.
//
// NOTHING DOWNSTREAM EXISTS WITHOUT THESE ROWS. The live poller scopes by OUR
// table, not by the provider's payload - "we enumerate the rows WE hold as
// live-or-imminent and look each up" - so a league with no matches rows is a
// league the poller cannot see, whatever the feed says. This is the file that
// makes MLB visible to everything else.
//
// THE SLUG HAS NO WEEK IN IT, because baseball has none: 162 games over six
// months, identified by the day they are played. mlb-2026-09-22-tb-nyy. And
// matches.slug is GLOBALLY unique - not per league - so the mlb- prefix is
// load-bearing rather than decorative.
//
// DOUBLEHEADERS ARE REAL AND THE DATE IS NOT ENOUGH. The same two clubs play
// twice on one day several times a season, and today's own slate has one:
// TB @ NYY at 17:05Z and again at 23:05Z. The second game takes a -g2 suffix,
// decided by kickoff order within the pair so the same game gets the same slug
// on every re-import. Without it the second game silently collides with the
// first on a unique index and the import fails a row it will never explain.
//
// A SLUG, ONCE WRITTEN, IS NOT RE-DERIVED (planSlugs). It is a public URL.
// The first version re-computed every slug from the batch on every write,
// which is harmless on a day imported once and wrong the day the provider
// MOVES a game: on 25 Sep 2026 BDL moved BAL @ NYY's Saturday game into
// Friday as a doubleheader game 1. Re-derived, Friday's existing row - already
// on readers' screens - would have been renamed -g2, and the moved game would
// have tried to take the base slug while that row still held it: a unique
// violation half way through a batch, which depends on the order BDL happens
// to list the games in. So an existing row keeps its slug unless its DAY or
// its CLUBS changed; a moved or new game takes the next free suffix for its
// day and pair. "-g2" therefore means "the second row filed under that day",
// which is the second game except when a makeup game arrives after the first
// was filed.
//
// THE UPSERT IS KEYED ON bdl_game_id, NOT ON THE SLUG. PROD has a partial
// unique index on (league_id, external_ids->>'bdl_game_id') for exactly this,
// and the provider's id is the only thing about a game that cannot change - a
// postponement moves the date, which moves the slug.

import { fromBdlMlb } from './ingest.js';

const BDL = 'https://api.balldontlie.io';

/** One day's slate. */
export async function fetchMlbDay(dateIso) {
  const key = process.env.BDL_API_KEY;
  if (!key) throw new Error('BDL_API_KEY missing in env');
  const res = await fetch(`${BDL}/mlb/v1/games?dates[]=${encodeURIComponent(dateIso)}&per_page=100`,
    { headers: { Authorization: key } });
  if (!res.ok) throw new Error(`BDL ${res.status} on /mlb/v1/games`);
  const j = await res.json();
  return j?.data ?? [];
}

/** The postseason bracket for a season, once it exists. */
export async function fetchMlbPostseason(season) {
  const key = process.env.BDL_API_KEY;
  if (!key) throw new Error('BDL_API_KEY missing in env');
  const res = await fetch(`${BDL}/mlb/v1/games?postseason=true&seasons[]=${season}&per_page=100`,
    { headers: { Authorization: key } });
  if (!res.ok) throw new Error(`BDL ${res.status} on /mlb/v1/games`);
  const j = await res.json();
  return j?.data ?? [];
}

const lower = (v) => String(v ?? '').trim().toLowerCase();

/** PURE. The ET-ish calendar day a game belongs to, from its UTC kickoff.
 *  NOT a timezone conversion - the provider already states the date it files a
 *  game under, and the slug takes that rather than re-deriving one. */
export function gameDay(row) {
  const d = String(row?.date ?? '');
  return /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
}

/**
 * PURE. Slugs for a whole slate, doubleheaders disambiguated.
 * Takes the WHOLE day so the -g2 decision can see both games; a per-row
 * function could not, and would either always or never add a suffix.
 */
export function slugsFor(rows = []) {
  const byPair = new Map();
  for (const r of rows) {
    const day = gameDay(r);
    const away = lower(r?.away_team?.abbreviation);
    const home = lower(r?.home_team?.abbreviation);
    if (!day || !away || !home || r?.id == null) continue;
    const pair = `${day}:${away}:${home}`;
    if (!byPair.has(pair)) byPair.set(pair, []);
    byPair.get(pair).push(r);
  }
  const out = new Map();
  for (const [pair, games] of byPair) {
    // ORDERED BY KICKOFF, THEN BY ID. Two games at the same stated time is not
    // a shape this feed has, but a stable tiebreak means a re-import cannot
    // swap which game is -g2.
    games.sort((a, b) => (new Date(a.date) - new Date(b.date)) || (Number(a.id) - Number(b.id)));
    const [day, away, home] = pair.split(':');
    games.forEach((g, i) => {
      out.set(String(g.id), `mlb-${day}-${away}-${home}${i ? `-g${i + 1}` : ''}`);
    });
  }
  return out;
}

/** PURE. `mlb-<day>-<away>-<home>[-g<n>]` -> its parts, or null. */
export function parseMlbSlug(slug) {
  const m = /^mlb-(\d{4}-\d{2}-\d{2})-([a-z0-9]+)-([a-z0-9]+?)(?:-g(\d+))?$/.exec(String(slug ?? ''));
  return m ? { day: m[1], away: m[2], home: m[3], n: m[4] ? Number(m[4]) : 1 } : null;
}

const slugOf = (day, away, home, n) => `mlb-${day}-${away}-${home}${n > 1 ? `-g${n}` : ''}`;

/**
 * PURE. The slug each row of a batch is WRITTEN with.
 *
 *   existingByBdl  Map(bdl id -> { slug }) - the rows we already hold
 *   takenElsewhere Set(slug) - slugs held by rows NOT in this batch
 *
 * An existing row whose day and clubs still match its slug KEEPS it. Every
 * other row - new, or moved to another day - takes the first free of base,
 * -g2, -g3 ... for its day and pair, in kickoff order (then id), so the plan is
 * the same whatever order the provider lists the games in. A moved row's old
 * slug is released for the rest of the batch.
 */
export function planSlugs(rows = [], existingByBdl = new Map(), takenElsewhere = new Set()) {
  const out = new Map();
  const groups = new Map();
  for (const r of rows) {
    const day = gameDay(r);
    const away = lower(r?.away_team?.abbreviation);
    const home = lower(r?.home_team?.abbreviation);
    if (!day || !away || !home || r?.id == null) continue;
    const k = `${day}:${away}:${home}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const used = new Set(takenElsewhere);
  const fresh = [];
  for (const [k, games] of groups) {
    const [day, away, home] = k.split(':');
    games.sort((a, b) => (new Date(a.date) - new Date(b.date)) || (Number(a.id) - Number(b.id)));
    for (const g of games) {
      const cur = existingByBdl.get(String(g.id))?.slug ?? null;
      const p = parseMlbSlug(cur);
      if (p && p.day === day && p.away === away && p.home === home) { out.set(String(g.id), cur); used.add(cur); }
      else fresh.push({ g, day, away, home });
    }
  }
  // keepers first, across the whole batch, so a newcomer can never take a
  // slug a keeper in another group is about to be confirmed in
  fresh.sort((a, b) => (new Date(a.g.date) - new Date(b.g.date)) || (Number(a.g.id) - Number(b.g.id)));
  for (const { g, day, away, home } of fresh) {
    let n = 1;
    while (used.has(slugOf(day, away, home, n))) n += 1;
    const s = slugOf(day, away, home, n);
    out.set(String(g.id), s); used.add(s);
  }
  return out;
}

/**
 * PURE. The order to write a batch's slug changes in, so no statement ever
 * asks for a slug another row still holds (matches.slug is globally unique and
 * checked per row). A row goes after the row vacating its target; a cycle - two
 * rows swapping - is broken by parking one on a temporary slug first.
 *
 *   plan     Map(bdl id -> target slug)
 *   current  Map(bdl id -> slug held now), existing rows only
 * Returns [{ bdl, slug, temp }] covering every planned row once as temp=false.
 */
export function slugWriteOrder(plan = new Map(), current = new Map()) {
  const held = new Map();                                  // slug -> bdl holding it now
  for (const [b, s] of current) if (s) held.set(s, b);
  const pending = [...plan.keys()];
  const out = [];
  while (pending.length) {
    const i = pending.findIndex((b) => {
      const h = held.get(plan.get(b));
      return h == null || h === b;
    });
    if (i >= 0) {
      const b = pending.splice(i, 1)[0];
      const prev = current.get(b);
      if (prev && held.get(prev) === b) held.delete(prev);
      held.set(plan.get(b), b);
      current = new Map(current).set(b, plan.get(b));
      out.push({ bdl: b, slug: plan.get(b), temp: false });
      continue;
    }
    // a cycle: park the first pending row that holds a slug
    const b = pending.find((x) => current.get(x));
    const tmp = `${current.get(b)}-moving-${b}`;
    held.delete(current.get(b)); held.set(tmp, b);
    current = new Map(current).set(b, tmp);
    out.push({ bdl: b, slug: tmp, temp: true });
  }
  return out;
}

/**
 * PURE. One row -> the columns matches holds.
 * @param teamIdByBdl Map(bdl_team_id -> our team id)
 */
export function shapeMlbMatch(row, slug, teamIdByBdl = new Map(), unmapped = {}, stage = null) {
  const n = fromBdlMlb(row, unmapped);
  const homeTeamId = teamIdByBdl.get(String(row?.home_team?.id)) ?? null;
  const awayTeamId = teamIdByBdl.get(String(row?.away_team?.id)) ?? null;
  // A GAME WITH A SIDE WE CANNOT RESOLVE IS NOT WRITTEN. Both team ids are
  // NOT NULL on this table for every existing league's rows, and a half-joined
  // match renders as a blank team on every surface that reads it.
  if (!slug || !homeTeamId || !awayTeamId || !row?.date || n.seasonPhase == null) return null;
  return {
    slug,
    homeTeamId,
    awayTeamId,
    kickoffAt: row.date,
    status: n.status,
    homeScore: n.homeScore,
    awayScore: n.awayScore,
    seasonYear: row.season == null ? null : Number(row.season),
    seasonPhase: n.seasonPhase,
    // BASEBALL HAS NO WEEKS. Null rather than a derived week number: every
    // reader that groups by week is football-shaped and must find nothing
    // here rather than something it can misuse.
    week: null,
    // THE ROUND, AND ONLY WHEN SOMEBODY KNOWS IT. Null on every regular-season
    // row and on any postseason row whose stage could not be established -
    // lib/mlb/series.js scopes on `stage IS NOT NULL` precisely so an unplaced
    // game is ABSENT from the bracket rather than grouped under a blank round.
    // The provider we import games from does not carry it; lib/mlb/postseason.js
    // is where it comes from.
    stage: stage ?? null,
    venue: n.venue,
    metadata: {
      line_score: n.lineScore,
      scoring_plays: n.scoringPlays,
      ...(n.liveState ? { live_state: n.liveState } : {}),
    },
    externalIds: { bdl_game_id: String(row.id) },
  };
}

/**
 * Upsert one slate. Follows lib/gridiron/sync.js's lookup-then-write shape.
 *
 * THE LIVE GAME BELONGS TO THE POLLER. A row BDL calls in progress gets its
 * slug, kickoff, clubs and stage from here and NOTHING of its state: status,
 * score and live_state are the poller's, written every 30 s with the runners
 * and the count this feed's /games row does not carry. A batch writer landing
 * in the middle of an inning would put back a thinner state for a poll.
 *
 * Returns { inserted, updated, refused, unmapped, changes } - changes is one
 * entry per row whose slug, kickoff or status moved, for the operator.
 * { dryRun: true } plans the same batch and writes nothing.
 */
export async function writeMlbMatches(sql, leagueId, rows, stageByGameId = new Map(), { dryRun = false } = {}) {
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

  // EVERY SLUG THIS BATCH COULD WANT, held by a row outside it.
  const prefixes = [...new Set(list.map((r) => {
    const d = gameDay(r); const a = lower(r?.away_team?.abbreviation); const h = lower(r?.home_team?.abbreviation);
    return d && a && h ? `mlb-${d}-${a}-${h}` : null;
  }).filter(Boolean))];
  const heldRows = prefixes.length ? await sql`
    SELECT slug, external_ids->>'bdl_game_id' AS bdl FROM matches
     WHERE slug LIKE ANY(${prefixes.map((p) => `${p}%`)})` : [];
  const inBatch = new Set(ids);
  const takenElsewhere = new Set(heldRows.filter((h) => !inBatch.has(String(h.bdl))).map((h) => h.slug));

  const plan = planSlugs(list, new Map([...existing].map(([b, e]) => [b, { slug: e.slug }])), takenElsewhere);
  const current = new Map([...existing].map(([b, e]) => [b, e.slug]));
  const order = slugWriteOrder(new Map(ids.filter((b) => plan.has(b)).map((b) => [b, plan.get(b)])), current);
  const byId = new Map(list.map((r) => [String(r.id), r]));

  const unmapped = {};
  let inserted = 0; let updated = 0; const refused = []; const changes = [];
  for (const r of list) if (!plan.has(String(r.id))) refused.push({ id: r.id, slug: null });

  for (const step of order) {
    const row = byId.get(step.bdl);
    const prev = existing.get(step.bdl) ?? null;
    if (step.temp) {
      if (!dryRun) await sql`UPDATE matches SET slug = ${step.slug} WHERE id = ${prev.id}`;
      continue;
    }
    const g = shapeMlbMatch(row, step.slug, teamIdByBdl, unmapped, stageByGameId.get(step.bdl) ?? null);
    if (!g) { refused.push({ id: row?.id ?? null, slug: step.slug }); continue; }
    const ext = JSON.stringify(g.externalIds);
    const liveOnFeed = g.status === 'live';
    if (prev) {
      const kickFrom = new Date(prev.kickoff_at).toISOString();
      const kickTo = new Date(g.kickoffAt).toISOString();
      const statusTo = liveOnFeed ? prev.status : g.status;
      if (prev.slug !== g.slug || kickFrom !== kickTo || prev.status !== statusTo) {
        changes.push({ id: prev.id, bdl: step.bdl, action: 'update', slugFrom: prev.slug, slugTo: g.slug,
          kickoffFrom: kickFrom, kickoffTo: kickTo, statusFrom: prev.status, statusTo, liveOnFeed });
      }
      if (dryRun) { updated += 1; continue; }
      if (liveOnFeed) {
        await sql`
          UPDATE matches SET
            slug = ${g.slug}, home_team_id = ${g.homeTeamId}, away_team_id = ${g.awayTeamId},
            kickoff_at = ${g.kickoffAt}, season_year = ${g.seasonYear}, season_phase = ${g.seasonPhase},
            venue = ${g.venue}, stage = COALESCE(${g.stage}::text, matches.stage),
            external_ids = matches.external_ids || ${ext}::jsonb,
            data_provider_synced_at = now(), updated_at = now()
          WHERE id = ${prev.id}`;
        updated += 1;
        continue;
      }
      await sql`
        UPDATE matches SET
          slug = ${g.slug}, home_team_id = ${g.homeTeamId}, away_team_id = ${g.awayTeamId},
          kickoff_at = ${g.kickoffAt}, status = ${g.status},
          -- THE SAME GATE THE OTHER LEAGUES USE: a scheduled row's 0-0 is not
          -- a score, so it may only null; a live or final row's score wins,
          -- and a null from the provider preserves what we hold.
          home_score = CASE WHEN ${g.status} = 'scheduled' THEN NULL
                            ELSE COALESCE(${g.homeScore}::int, matches.home_score) END,
          away_score = CASE WHEN ${g.status} = 'scheduled' THEN NULL
                            ELSE COALESCE(${g.awayScore}::int, matches.away_score) END,
          season_year = ${g.seasonYear}, season_phase = ${g.seasonPhase}, venue = ${g.venue},
          -- A STAGE IS NEVER UNSET BY A LATER IMPORT THAT DOES NOT KNOW IT.
          -- The regular-season importer passes no stage map at all and reruns
          -- daily over a window that will, in October, contain postseason
          -- games; COALESCE is what stops it wiping the round off every one of
          -- them and emptying the bracket.
          stage = COALESCE(${g.stage}::text, matches.stage),
          -- ONE LEVEL DEEP IS ALL THIS NEEDS AND ALL IT GETS. Every key written
          -- here is top-level (line_score, scoring_plays, live_state), so a
          -- shallow merge replaces each wholesale, which is what a snapshot
          -- wants. A nested merge would be the trap the house rule names.
          metadata = COALESCE(matches.metadata, '{}'::jsonb)
                     || ${JSON.stringify(g.metadata)}::jsonb
                     || CASE WHEN ${g.status} = 'live' THEN '{}'::jsonb
                             ELSE '{"live_state": null}'::jsonb END,
          external_ids = matches.external_ids || ${ext}::jsonb,
          data_provider_synced_at = now(), updated_at = now()
        WHERE id = ${prev.id}`;
      updated += 1;
    } else {
      changes.push({ id: null, bdl: step.bdl, action: 'insert', slugFrom: null, slugTo: g.slug,
        kickoffFrom: null, kickoffTo: new Date(g.kickoffAt).toISOString(), statusFrom: null, statusTo: g.status, liveOnFeed });
      if (dryRun) { inserted += 1; continue; }
      await sql`
        INSERT INTO matches (league_id, slug, home_team_id, away_team_id, kickoff_at, status,
                             home_score, away_score, season_year, season_phase, week, stage, venue,
                             metadata, external_ids, data_provider_synced_at, created_at, updated_at)
        VALUES (${leagueId}, ${g.slug}, ${g.homeTeamId}, ${g.awayTeamId}, ${g.kickoffAt}, ${g.status},
                ${g.status === 'scheduled' ? null : g.homeScore}, ${g.status === 'scheduled' ? null : g.awayScore},
                ${g.seasonYear}, ${g.seasonPhase}, ${g.week}, ${g.stage}, ${g.venue},
                ${JSON.stringify(g.metadata)}::jsonb, ${ext}::jsonb, now(), now(), now())`;
      inserted += 1;
    }
  }
  return { inserted, updated, refused, unmapped, changes };
}
