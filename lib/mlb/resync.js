// lib/mlb/resync.js - the MLB schedule, kept in step with BallDontLie.
//
// WHY IT EXISTS. Until 25 Sep 2026 the schedule was one manual import
// (scripts/mlb-schedule-import.mjs), and nothing BDL changed afterwards ever
// reached PROD. That night four doubleheader games were wrong: BAL @ NYY's
// game 1 was being played while we held it as Saturday's game, CHC @ BOS's
// game 1 had finished while we held it for Sunday, its game 2 had moved 1h40m
// earlier, and TOR @ BAL's 23 Sep makeup had never been ingested at all. The
// live poller cannot recover any of that - it polls only the rows whose
// kickoff WE hold as near - so a game filed on the wrong day is never seen.
//
// WHAT IT DOES. Asks BDL for a window of days (yesterday to a week ahead by
// default) and writes it through the SAME writer the imports use
// (lib/mlb/schedule.js writeMlbMatches): moved games get their new kickoff,
// new games are inserted, finals get their result, slugs stay stable. A row we
// hold in the window that BDL no longer lists is asked for by id; if BDL has
// moved it outside the window it is updated from that answer, and if BDL
// answers 404 it is CANCELLED - never deleted, since a board may hold it -
// and only if it has not been played.
//
// WHO OWNS A POSTSEASON ROW. This job owns its EXISTENCE and its TIME: when it
// is played, its status and its score - regular season and postseason alike,
// because BDL's dated query returns both. scripts/mlb-postseason-import.mjs
// owns its ROUND (stage) and what hangs off a round: the series boards and
// October's days. They cannot fight over a row:
//   - both write through writeMlbMatches, so a slug is stable whichever runs;
//   - this job never unsets a stage (COALESCE), and only ever sets one on an
//     unstaged postseason game from its own SERIES - a game between the same
//     two clubs in the same postseason already staged by the import. That is
//     how an if-necessary game BDL adds mid-series gets its round without the
//     import running. A game of a series the import has not placed stays
//     unstaged, which lib/mlb/series.js shows as a hole, never a wrong slot;
//   - status and score come from the same feed through the same statement,
//     so the two writing the same row write the same thing.
// The cron takes an advisory lock; the scripts are run by hand.

import { writeMlbMatches, gameDay } from './schedule.js';

const BDL = 'https://api.balldontlie.io';
const DAY = 86_400_000;
export const RESYNC_SOURCE = 'mlb-schedule';

/** The daily run's hour, UTC. 10:00Z is 6am in New York, before any lineup. */
export const DAILY_HOUR_UTC = 10;

const isoDay = (t) => new Date(t).toISOString().slice(0, 10);

/**
 * PURE. Should this hourly tick run the re-sync?
 *   postseason  every 2 hours (even UTC hours) - BDL adds and drops
 *               if-necessary games as series are decided
 *   otherwise   once a day at DAILY_HOUR_UTC, and once more on the hourly tick
 *               that falls 90-150 min before the day's first pitch
 */
export function resyncDue(now, { firstPitch = null, postseason = false } = {}) {
  const t = new Date(now);
  const h = t.getUTCHours();
  if (postseason) return h % 2 === 0 ? { run: true, why: 'postseason' } : { run: false, why: 'postseason-odd-hour' };
  if (h === DAILY_HOUR_UTC) return { run: true, why: 'daily' };
  if (firstPitch) {
    const lead = (new Date(firstPitch).getTime() - t.getTime()) / 60_000;
    if (lead > 90 && lead <= 150) return { run: true, why: 'pre-first-pitch' };
  }
  return { run: false, why: 'not-due' };
}

/** PURE. The American calendar day of an instant (the slate's day). */
export function etDay(t) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(t));
}

/** PURE. The first pitch of today's American slate, from a list of kickoffs. */
export function firstPitchOfDay(kickoffs = [], now = new Date()) {
  const today = etDay(now);
  const ts = kickoffs.map((k) => new Date(k).getTime()).filter((x) => Number.isFinite(x) && etDay(x) === today);
  return ts.length ? new Date(Math.min(...ts)) : null;
}

async function bdlJson(path, { key = process.env.BDL_API_KEY, fetchImpl = fetch } = {}) {
  if (!key) throw new Error('BDL_API_KEY missing in env');
  const res = await fetchImpl(`${BDL}${path}`, { headers: { Authorization: key } });
  return res;
}

/** Every BDL game dated in [fromDay, toDay] (UTC days), walking the cursor. */
export async function fetchMlbWindow(fromDay, toDay, opts = {}) {
  const days = [];
  // THE NEIGHBOURS ARE ASKED TOO (lib/mlb/probables.js has the same note):
  // BDL's dates[] is a calendar the provider owns, so the answer is cut to the
  // requested UTC days here rather than trusted to its filter.
  for (let t = Date.parse(`${fromDay}T00:00:00Z`) - DAY; t <= Date.parse(`${toDay}T00:00:00Z`) + DAY; t += DAY) days.push(isoDay(t));
  const q = days.map((d) => `dates[]=${d}`).join('&');
  const out = []; let cursor = null; let calls = 0;
  do {
    const res = await bdlJson(`/mlb/v1/games?${q}&per_page=100${cursor ? `&cursor=${cursor}` : ''}`, opts);
    if (!res.ok) throw new Error(`BDL ${res.status} on /mlb/v1/games`);
    const j = await res.json(); calls += 1;
    out.push(...(j?.data ?? []));
    cursor = j?.meta?.next_cursor ?? null;
  } while (cursor && calls < 20);
  const rows = out.filter((r) => { const d = gameDay(r); return d && d >= fromDay && d <= toDay; });
  return { rows, calls };
}

/** One game by id: { row } when BDL has it, { gone: true } on a 404. Throws otherwise. */
export async function fetchMlbGame(id, opts = {}) {
  const res = await bdlJson(`/mlb/v1/games/${encodeURIComponent(id)}`, opts);
  if (res.status === 404) return { gone: true };
  if (!res.ok) throw new Error(`BDL ${res.status} on /mlb/v1/games/${id}`);
  return { row: (await res.json())?.data ?? null };
}

const pairKey = (a, b) => [String(a ?? '').toUpperCase(), String(b ?? '').toUpperCase()].sort().join('-');

/**
 * Re-sync [from, to] (UTC days; default yesterday .. +7). { dryRun } plans and
 * writes nothing. Returns what changed, for the run ledger and the operator.
 */
export async function resyncMlbSchedule(sql, { now = new Date(), from = null, to = null, dryRun = false, fetchImpl = fetch, key = process.env.BDL_API_KEY, log = () => {} } = {}) {
  const fromDay = from ?? isoDay(new Date(now).getTime() - DAY);
  const toDay = to ?? isoDay(new Date(now).getTime() + 7 * DAY);
  const opts = { fetchImpl, key };
  const [league] = await sql`SELECT id FROM leagues WHERE slug = 'mlb' LIMIT 1`;
  if (!league) return { ok: false, reason: 'no-league-row' };

  const { rows, calls: windowCalls } = await fetchMlbWindow(fromDay, toDay, opts);
  let calls = windowCalls;
  const seen = new Set(rows.map((r) => String(r.id)));

  // OURS IN THE WINDOW THAT BDL DID NOT LIST: moved out of it, or gone.
  const ours = await sql`
    SELECT m.id, m.slug, m.status, external_ids->>'bdl_game_id' AS bdl
      FROM matches m
     WHERE m.league_id = ${league.id}
       AND m.kickoff_at >= ${`${fromDay}T00:00:00Z`}::timestamptz
       AND m.kickoff_at <  ${`${toDay}T00:00:00Z`}::timestamptz + interval '1 day'
       AND jsonb_exists(m.external_ids, 'bdl_game_id')`;
  const cancelled = []; const unlisted = [];
  for (const o of ours) {
    if (seen.has(String(o.bdl))) continue;
    const r = await fetchMlbGame(o.bdl, opts); calls += 1;
    if (r.row) { rows.push(r.row); seen.add(String(o.bdl)); unlisted.push({ id: o.id, bdl: o.bdl, moved: gameDay(r.row) }); continue; }
    if (!r.gone) continue;
    // NEVER A PLAYED GAME, AND NEVER A DELETE. A 404 on a final is a provider
    // problem, not a cancellation; a board may point at any of these rows.
    if (!['scheduled', 'postponed'].includes(o.status)) { unlisted.push({ id: o.id, bdl: o.bdl, gone: true, kept: o.status }); continue; }
    cancelled.push({ id: o.id, bdl: o.bdl, slug: o.slug, statusFrom: o.status });
    if (!dryRun) await sql`UPDATE matches SET status = 'cancelled', updated_at = now() WHERE id = ${o.id} AND status IN ('scheduled', 'postponed')`;
  }

  // AN UNSTAGED POSTSEASON GAME TAKES ITS SERIES' ROUND, and nothing else does.
  const stageByGameId = new Map();
  const post = rows.filter((r) => r?.postseason === true || /post/i.test(String(r?.season_type ?? '')));
  if (post.length) {
    const staged = await sql`
      SELECT m.season_year, m.stage, h.abbreviation AS home, a.abbreviation AS away
        FROM matches m
        JOIN teams h ON h.id = m.home_team_id JOIN teams a ON a.id = m.away_team_id
       WHERE m.league_id = ${league.id} AND m.season_phase = 'POST' AND m.stage IS NOT NULL`;
    const stageOf = new Map();
    for (const s of staged) stageOf.set(`${s.season_year}:${pairKey(s.away, s.home)}`, s.stage);
    for (const r of post) {
      const st = stageOf.get(`${r.season}:${pairKey(r.away_team?.abbreviation, r.home_team?.abbreviation)}`);
      if (st) stageByGameId.set(String(r.id), st);
    }
  }

  const res = await writeMlbMatches(sql, league.id, rows, stageByGameId, { dryRun });
  const summary = {
    ok: res.refused.length === 0, from: fromDay, to: toDay, calls, fetched: rows.length,
    inserted: res.inserted, updated: res.updated, refused: res.refused, unmapped: res.unmapped,
    changes: res.changes, cancelled, unlisted, stagedFromSeries: stageByGameId.size, dryRun,
  };
  log(`[mlb-schedule] ${fromDay}..${toDay} fetched ${rows.length} | changes ${res.changes.length} | cancelled ${cancelled.length} | refused ${res.refused.length}`);
  return summary;
}
