// lib/gridiron/nflBroadcasts.js — NFL broadcast outlets into match_broadcasters.
//
// WHY ESPN AND NOT THE PROVIDERS WE ALREADY PAY. Measured, not assumed:
// BDL /nfl/v1/games carries no broadcast key on ANY of the 285 rows of a
// completed 2025 season - one key-shape, 23 columns, zero hits - and
// /nfl/v1/broadcasts is "Route not found" on four route shapes including with
// a valid historical id. nflverse schedules has 46 columns and none of them is
// a network. ESPN's public site API has it, so ESPN is where it comes from.
//
// THE TRAP AT THE OBVIOUS PATH. `summary.broadcasts` is an EMPTY ARRAY on
// every game. A reader that took the top-level key would ship a silent zero
// and look like it worked. The data lives at
// events[].competitions[0].broadcasts, and that is the only path this module
// reads.
//
// NO NFLVERSE HOP. The recon proved (week, home, away) reaches ESPN's own
// events 272/272 directly, so the nflverse detour buys an id we do not need.
// Both routes need the same alias map, which is the actual cost.
//
// UNDOCUMENTED AND UNVERSIONED. ESPN publishes no contract for this endpoint,
// sends no rate-limit header, and answers a bare GET with no key. Absence of a
// stated limit is not permission: the sweep is throttled by us because nobody
// else is throttling it.

import { sql } from '../db.js';

/**
 * THE ALIAS MAP, WRITTEN DOWN RATHER THAN DISCOVERED.
 *
 * ESPN and nflverse both say LA and WAS; we say LAR and WSH. A naive join on
 * (week, home, away) does not error on this - it silently drops the Rams and
 * the Commanders, roughly 34 games a season, and the sync reports a clean run
 * over a hole. Two clubs, both named here, exercised by their own test.
 */
export const TEAM_ALIAS = Object.freeze({ LA: 'LAR', WAS: 'WSH' });

/** ESPN's seasontype -> our season_phase. 1 is preseason and is out of scope. */
export const SEASON_TYPE = Object.freeze({ 2: 'REG', 3: 'POST' });

/** geoBroadcasts type.shortName -> our broadcaster_type CHECK vocabulary. */
const TYPE_MAP = { TV: 'tv', Streaming: 'streaming', Radio: 'radio' };

export const ourAbbr = (t) => TEAM_ALIAS[t] ?? t;

/**
 * One ESPN event -> the rows we would store.
 *
 * PRIMARY IS names[0], with no tie-break rule. The CFB arm needed one because
 * CFBD sends "CW" and "The CW Network" as two rows for one broadcast with no
 * stated order. ESPN states the order three times and agrees with itself: the
 * `broadcast` string is "ESPN/ABC", `names` is ["ESPN","ABC"], and
 * geoBroadcasts lists ESPN first. All nine simulcasts in 2026 are that pair.
 *
 * TYPE AND LOGO COME FROM geoBroadcasts, matched on media.shortName. names[]
 * carries order but not type; geoBroadcasts carries type and a logo URL but
 * its order is not the documented one. Each is read for what it actually says.
 */
export function toBroadcasterRows(event, { unknownTypes } = {}) {
  const comp = event?.competitions?.[0];
  const names = [];
  for (const b of comp?.broadcasts ?? []) {
    for (const n of b?.names ?? []) {
      const name = typeof n === 'string' ? n.trim() : '';
      if (name && !names.includes(name)) names.push(name);
    }
  }
  if (!names.length) return [];

  const geo = new Map();
  for (const g of comp?.geoBroadcasts ?? []) {
    const key = g?.media?.shortName;
    if (key && !geo.has(key)) geo.set(key, g);
  }

  const rows = [];
  for (const name of names) {
    const g = geo.get(name);
    const short = g?.type?.shortName;
    // A GAME WITH NO geoBroadcasts ROW still has a name, and a name is the
    // thing the card shows. Default to 'tv' only when ESPN told us nothing;
    // an UNRECOGNISED type is skipped and counted, because broadcaster_type
    // carries a CHECK and a coerced value fails the whole run over one row.
    let type = 'tv';
    if (short != null) {
      if (!TYPE_MAP[short]) { unknownTypes?.push(short); continue; }
      type = TYPE_MAP[short];
    }
    const logo = typeof g?.media?.logo === 'string' && g.media.logo ? g.media.logo : null;
    rows.push({ broadcaster_name: name, broadcaster_type: type, channel_logo_url: logo });
  }
  // PRIMARY AND ORDER ARE STAMPED AFTER THE SKIPS, not during. If the first
  // name were the one dropped for an unknown type, stamping as we went would
  // leave the survivors with no primary at all - and the partial unique index
  // wants exactly one, not zero.
  return rows.map((r, i) => ({ ...r, is_primary: i === 0, display_order: i + 1 }));
}

/**
 * The composite that reaches one of our matches, with the alias applied on
 * ESPN's side. Returns null when either club is missing rather than building a
 * key that could collide with another half-known game.
 */
export function joinKey(event, phase, week) {
  const sides = event?.competitions?.[0]?.competitors ?? [];
  const home = sides.find((s) => s.homeAway === 'home')?.team?.abbreviation;
  const away = sides.find((s) => s.homeAway === 'away')?.team?.abbreviation;
  if (!home || !away) return null;
  return `${phase}|${week}|${ourAbbr(home)}|${ourAbbr(away)}`;
}

/**
 * A FULLY-BLANK WEEK IS NOT AUTOMATICALLY A FAILURE.
 *
 * NFL flex scheduling leaves weeks 16-18 unassigned until deep into the
 * season: measured on the 2026 board, weeks 1-15 are 100% covered, 16 and 17
 * are 75%, and week 18 is ZERO. Alarming on that would train us to ignore the
 * alarm by December.
 *
 * So the guard is about TIME, not week number: a week whose first kickoff is
 * inside the window and which came back with nothing is worth a look. A week
 * still months away is allowed to be empty, because it IS empty.
 */
export function shouldAlertOnBlank(week, { now, windowDays = 10 } = {}) {
  if (week.networks > 0) return false;
  if (week.games === 0) return false;
  if (!week.firstKickoff) return false;
  const days = (new Date(week.firstKickoff).getTime() - new Date(now).getTime()) / 86400000;
  return days <= windowDays;
}

/**
 * Sync NFL broadcast outlets for a season.
 *
 * SELF-THROTTLED. ESPN sends no ratelimit header and served 25 concurrent
 * requests without complaint; that is not permission, it is silence. The sweep
 * is serial with a pause between calls, which costs about three seconds for a
 * whole season and cannot be mistaken for abuse.
 *
 * ERROR BODIES ARE NOT LOGGED. A 404 from this endpoint returns an internal
 * ESPN hostname in its body. The status and the path we asked for are the
 * whole of what we record.
 */
export async function syncNflBroadcasts(leagueId, seasonYear, {
  fetchWeek, weeks = 18, postWeeks = 5, sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  throttleMs = 150,
} = {}) {
  const summary = {
    weeksFetched: 0, weeksFailed: 0, events: 0, matchedGames: 0, unmatchedGames: 0,
    gamesWithNoBroadcast: 0, inserted: 0, updated: 0, primaryChanged: 0,
    unknownTypes: [], byWeek: [],
  };

  const matches = await sql`
    SELECT m.id, m.week, m.season_phase, m.kickoff_at,
           h.abbreviation AS home, a.abbreviation AS away
      FROM matches m
      LEFT JOIN teams h ON h.id = m.home_team_id
      LEFT JOIN teams a ON a.id = m.away_team_id
     WHERE m.league_id = ${leagueId} AND m.season_year = ${seasonYear}
       AND m.season_phase = ANY(ARRAY['REG', 'POST'])`;
  const index = new Map();
  for (const m of matches) {
    if (!m.home || !m.away) continue;
    index.set(`${m.season_phase}|${m.week}|${m.home}|${m.away}`, m);
  }

  for (const [seasontype, phase] of Object.entries(SEASON_TYPE)) {
    const last = phase === 'REG' ? weeks : postWeeks;
    for (let w = 1; w <= last; w += 1) {
      let events;
      try {
        events = await fetchWeek(seasonYear, Number(seasontype), w);
        summary.weeksFetched += 1;
      } catch (e) {
        // NAME THE REQUEST, NOT THE RESPONSE.
        summary.weeksFailed += 1;
        console.warn(`[nfl-broadcasts] ${phase} week ${w} fetch failed: ${e?.message ?? 'unknown'}`);
        continue;
      }
      let networks = 0; let firstKickoff = null;
      for (const ev of events ?? []) {
        summary.events += 1;
        if (ev?.date && (!firstKickoff || ev.date < firstKickoff)) firstKickoff = ev.date;
        const key = joinKey(ev, phase, w);
        const match = key ? index.get(key) : null;
        if (!match) { summary.unmatchedGames += 1; continue; }
        summary.matchedGames += 1;
        const rows = toBroadcasterRows(ev, { unknownTypes: summary.unknownTypes });
        if (!rows.length) { summary.gamesWithNoBroadcast += 1; continue; }
        networks += 1;
        await writeRows(match.id, rows, summary);
      }
      summary.byWeek.push({ phase, week: w, games: (events ?? []).length, networks, firstKickoff });
      if (throttleMs) await sleep(throttleMs);
    }
  }
  summary.unknownTypes = [...new Set(summary.unknownTypes)];
  return summary;
}

/**
 * The write, identical in shape to the CFB arm because the constraints are the
 * same table's. Clear the old primary first - the partial unique index rejects
 * a second one, so a game whose primary MOVES would fail on the way in.
 */
async function writeRows(matchId, rows, summary) {
  const cleared = await sql`
    UPDATE match_broadcasters SET is_primary = false, updated_at = now()
     WHERE match_id = ${matchId} AND country_code = 'US' AND is_primary = true
       AND broadcaster_name IS DISTINCT FROM ${rows[0].broadcaster_name}
    RETURNING id`;
  summary.primaryChanged += cleared.length;

  for (const r of rows) {
    const [w] = await sql`
      INSERT INTO match_broadcasters
        (match_id, country_code, broadcaster_name, broadcaster_type, channel_logo_url,
         is_primary, display_order, language_code, data_provider_synced_at)
      VALUES (${matchId}, 'US', ${r.broadcaster_name}, ${r.broadcaster_type}, ${r.channel_logo_url},
              ${r.is_primary}, ${r.display_order}, 'en', now())
      ON CONFLICT (match_id, country_code, broadcaster_name) DO UPDATE
         SET broadcaster_type = EXCLUDED.broadcaster_type,
             channel_logo_url = EXCLUDED.channel_logo_url,
             is_primary = EXCLUDED.is_primary,
             display_order = EXCLUDED.display_order,
             data_provider_synced_at = EXCLUDED.data_provider_synced_at,
             updated_at = now()
      RETURNING (xmax = 0) AS inserted`;
    if (w?.inserted) summary.inserted += 1; else summary.updated += 1;
  }
}

/** The scoreboard fetcher. Injected, so the module itself reads no env and no network in tests. */
export function espnScoreboardFetcher({ base = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl' } = {}) {
  return async (year, seasontype, week) => {
    const path = `/scoreboard?dates=${year}&seasontype=${seasontype}&week=${week}`;
    const res = await fetch(`${base}${path}`);
    // THE STATUS AND THE PATH, NEVER THE BODY: ESPN's 404 payload names an
    // internal host (sports.core.api.espn.pvt) and that does not belong in our
    // logs or our alerts.
    if (!res.ok) throw new Error(`ESPN ${res.status} on ${path}`);
    const json = await res.json();
    return json?.events ?? [];
  };
}
