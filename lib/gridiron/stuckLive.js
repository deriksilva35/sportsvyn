// lib/gridiron/stuckLive.js — the gridiron stuck-live net (tue-15).
//
// WHAT IT REPLACED. The old sweep (lib/stuckLiveSweep.js, run by the retired
// poll-live cron) forced a row final on TIME SINCE KICKOFF: 180 minutes, then
// 330 for gridiron. It forced 39 NFL preseason and 5 CFB rows, and the
// read-only audit of 30 Sep found them forced inside the range real games
// actually end in (preseason games we watched end ran 182-215 min; 37 of the
// 39 were forced at 181-203) and at least one - UNC @ TCU, forced 19:31Z,
// provider `completed` ~19:37Z - forced mid-game. Time is not evidence.
//
// THE RULE NOW. A live row is stuck only if BOTH:
//   1. the provider reports it FINAL, or the game has VANISHED from a feed
//      that answered (a successful fetch that no longer carries the id); and
//   2. we have not written the row for STALE_MIN minutes (updated_at).
// Time since kickoff never forces anything. A provider that says live, says
// scheduled, errors, or cannot be asked leaves the row alone - an unreachable
// provider is not evidence either, and a row left live is recoverable where a
// wrong FINAL is not.
//
// WHY IT EXISTS AT ALL. The live poller writes final itself whenever the
// provider does, so this only matters when the poller is not writing - down,
// or out of its window - or a second writer flapped the row back to live.
// cfb 20724 (Charleston Southern @ Georgia Southern) sat live ~22 hours after
// the poller had stamped it final. That is the case this catches.
//
// SOURCES: the poller's own, not API-Sports (retired with soccer, tue-14):
// BDL /nfl/v1/games by ET date for the NFL, CFBD /scoreboard for CFB.
// MLB is not here: it has the BDL poller and the hourly mlb-schedule import.

import { mapLiveStatus } from '../live/vocabulary.js';

export const STALE_MIN = 30;
export const NET_LEAGUES = Object.freeze(['nfl', 'cfb']);

const CFBD = 'https://apinext.collegefootballdata.com';
const BDL = 'https://api.balldontlie.io';

/**
 * PURE. 'force' or 'leave'.
 * @param providerStatus 'final' | 'live' | 'scheduled' | 'vanished' | 'unreachable' | other
 */
export function verdictFor({ providerStatus, lastWriteAt, now = new Date() }) {
  const staleMs = STALE_MIN * 60_000;
  const last = lastWriteAt == null ? null : new Date(lastWriteAt).getTime();
  const quiet = last != null && Number.isFinite(last) && now.getTime() - last >= staleMs;
  const over = providerStatus === 'final' || providerStatus === 'vanished';
  return over && quiet ? 'force' : 'leave';
}

/** The America/New_York calendar date of an instant - BDL files NFL games by it. */
export function etDate(iso) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(iso));
}

export async function fetchCfbScoreboard() {
  const key = process.env.CFBD_API_KEY;
  if (!key) throw new Error('CFBD_API_KEY missing in env');
  const res = await fetch(`${CFBD}/scoreboard`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`CFBD ${res.status} on /scoreboard`);
  return (await res.json()).map((r) => ({
    id: String(r?.id), status: mapLiveStatus('cfbd', r?.status),
    home: r?.homeTeam?.points ?? null, away: r?.awayTeam?.points ?? null,
  }));
}

export async function fetchNflDay(date) {
  const key = process.env.BDL_API_KEY;
  if (!key) throw new Error('BDL_API_KEY missing in env');
  const res = await fetch(`${BDL}/nfl/v1/games?dates[]=${date}&per_page=100`, { headers: { Authorization: key } });
  if (!res.ok) throw new Error(`BDL ${res.status} on /nfl/v1/games`);
  return ((await res.json())?.data ?? []).map((r) => ({
    id: String(r?.id), status: mapLiveStatus('bdl', r?.status_state),
    home: r?.home_team_score ?? null, away: r?.visitor_team_score ?? null,
  }));
}

/**
 * The provider's word on each candidate. One CFBD call per sweep, one BDL call
 * per distinct ET date. A fetch that throws makes every row it would have
 * answered 'unreachable' - never 'vanished'.
 */
export async function providerStatuses(candidates, { fetchCfb = fetchCfbScoreboard, fetchNfl = fetchNflDay } = {}) {
  const feeds = new Map();
  const feed = async (key, fn) => {
    if (!feeds.has(key)) feeds.set(key, await fn().then((rows) => ({ rows }), () => ({ rows: null })));
    return feeds.get(key).rows;
  };
  const out = new Map();
  for (const m of candidates) {
    const id = m.league_slug === 'cfb' ? m.external_ids?.cfbd_game_id : m.external_ids?.bdl_game_id;
    if (id == null) { out.set(m.id, { status: 'unreachable' }); continue; }
    const rows = m.league_slug === 'cfb'
      ? await feed('cfb', fetchCfb)
      : await feed(`nfl:${etDate(m.kickoff_at)}`, () => fetchNfl(etDate(m.kickoff_at)));
    if (rows == null) { out.set(m.id, { status: 'unreachable' }); continue; }
    const row = rows.find((r) => r.id === String(id));
    out.set(m.id, row ? { status: row.status ?? 'unknown', home: row.home, away: row.away } : { status: 'vanished' });
  }
  return out;
}

/**
 * The sweep. `sql` is the tagged-template client; fetchers are injectable.
 * The UPDATE re-checks both conditions in its WHERE, so a write that lands
 * between the read and the force wins.
 */
export async function sweepStuckGridiron(sql, { now = new Date(), fetchCfb, fetchNfl, log = () => {} } = {}) {
  const candidates = await sql`
    SELECT m.id, m.slug, m.kickoff_at, m.updated_at, m.external_ids, l.slug AS league_slug
      FROM matches m JOIN leagues l ON l.id = m.league_id
     WHERE m.status = 'live'
       AND l.slug = ANY(${[...NET_LEAGUES]})
       AND m.updated_at < ${now.toISOString()}::timestamptz - (${STALE_MIN} || ' minutes')::interval
     ORDER BY m.kickoff_at ASC`;
  const out = { candidates: candidates.length, forced: [], left: [] };
  if (!candidates.length) return out;
  const said = await providerStatuses(candidates, { fetchCfb, fetchNfl });
  for (const m of candidates) {
    const p = said.get(m.id) ?? { status: 'unreachable' };
    if (verdictFor({ providerStatus: p.status, lastWriteAt: m.updated_at, now }) !== 'force') {
      out.left.push({ slug: m.slug, provider: p.status });
      continue;
    }
    const home = p.status === 'final' && Number.isFinite(Number(p.home)) ? Number(p.home) : null;
    const away = p.status === 'final' && Number.isFinite(Number(p.away)) ? Number(p.away) : null;
    const done = await sql`
      UPDATE matches
         SET status = 'final',
             home_score = COALESCE(${home}, home_score),
             away_score = COALESCE(${away}, away_score),
             timer_forced_final_at = now(),
             metadata = COALESCE(metadata, '{}'::jsonb) || '{"live_state": null}'::jsonb,
             updated_at = now()
       WHERE id = ${m.id}
         AND status = 'live'
         AND updated_at < ${now.toISOString()}::timestamptz - (${STALE_MIN} || ' minutes')::interval
      RETURNING id`;
    if (done.length) {
      out.forced.push({ slug: m.slug, provider: p.status });
      log(`[stuck-live] ${m.league_slug} ${m.slug}: final (provider ${p.status}, quiet ${STALE_MIN}+ min)`);
    }
  }
  return out;
}
