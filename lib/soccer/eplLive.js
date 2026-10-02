// lib/soccer/eplLive.js - the Premier League's live poller (thu-24).
//
// EPL-ONLY, AND THAT IS THE POINT. The retired /api/cron/poll-live polled every
// live or near-kickoff row in ANY league that carried an api_sports id, and ran
// a stuck-live sweep over every non-MLB league that force-finaled rows on time
// since kickoff - the sweep that once finaled MLB games mid-inning. Nothing
// here can see a row whose league is not 'epl': every query names it.
//
// ONE REQUEST A TICK. /fixtures?ids=a-b-c returns each fixture WITH its events,
// statistics, lineups and players embedded (measured 1 Oct on matchweek 5: all
// ten fixtures, everything, in one call). So a whole Saturday afternoon costs
// one request a minute, and the full-time player stats ride in the same payload.
//
// WHAT IS WRITTEN, per fixture, only when something changed:
//   - matches.status / home_score / away_score;
//   - metadata.live_state - FLAT, {elapsed, extra, period}, NULL unless live,
//     the key the EPL match page and the scoreboards already read;
//   - metadata.epl_live - FLAT, owned by this module and replaced whole:
//     goals [{minute, extra, side, player, assist, kind: goal|own|penalty}],
//     reds [{minute, extra, side, player}], halftime, fullTimeAt, wroteAt;
//   - match_events / match_statistics through the existing atoms (the match
//     page's timeline and stat rows), only when the events signature moved.
// Both keys go in with jsonb_set on a value checked to be an OBJECT - never an
// object || onto something unconfirmed (CLAUDE.md, the 14 Aug and 15 Aug laws).
//
// THE STUCK RULE IS ITS OWN, AND NEVER TIME SINCE KICKOFF. A row this poller
// holds as live becomes final only when (a) the provider says it is final, or
// (b) a SUCCESSFUL response no longer carries the fixture AND nothing has been
// written for it in STUCK_QUIET_MIN. A long first half, a suspension, a
// stoppage-time marathon: none of them is "stuck", because the provider is
// still answering for the fixture.
//
// PLAYER STATS. At full time (status final, any path - this poller or the
// daily fixture sync), through the EPL importer that has matched squads since
// matchweek one (lib/soccer/playerStatsImport.js), fed from the embedded
// players when the tick has them. Then ONCE MORE ~24h after full time, diffed
// against what was stored: every changed value is logged and summarised, and
// handed to RESETTLE_HOOKS - EPL Weekly 5 registers its re-settle there
// (lib/eplWeekly5/settle.js, registered by the epl-live route).

import { isDailyCapTripped, tripDailyCap } from '../cronCircuitBreaker.js';
import { DailyCapError } from '../apiSports.js';
import { syncMatchEvents } from '../events.js';
import { syncMatchStatistics } from '../statistics.js';
import { importEplPlayerStats } from './playerStatsImport.js';
import { mapFixtureStatus } from './epl.js';
import { soccerLiveState } from './liveChip.js';
import { writeLiveLines } from './liveLines.js';

export const WINDOW_BEFORE_MIN = 15;   // armed this long before kickoff
export const WINDOW_AFTER_MIN = 150;   // ~2.5h: 90' + stoppage + half time + slack
export const STUCK_QUIET_MIN = 30;
export const FT_RETRY_MIN = 10;        // a full-time stats try that found nothing waits this long
export const RESYNC_AFTER_H = 24;
export const FT_FALLBACK_MIN = 115;    // kickoff -> full time, when the poller never saw the whistle
export const MAX_IDS = 20;             // the provider's ids= limit

/** Called with { matchId, slug, changes } when the +24h re-sync finds a changed value. */
export const RESETTLE_HOOKS = [];

// ---------------------------------------------------------------------------
// PURE
// ---------------------------------------------------------------------------

const sideOf = (teamId, f) => (teamId === f.teams?.home?.id ? 'home' : teamId === f.teams?.away?.id ? 'away' : null);
const shootout = (e) => /penalty shootout/i.test(e?.comments ?? '');

/** Goals that stand. Missed penalties are not goals; a VAR-cancelled goal is
 *  already gone from the provider's feed. An own goal's `team` is the side it
 *  counts FOR (measured: Martínez's own goal, 20 Sep, carries Fulham). */
export function goalsOf(f) {
  return (f.events ?? [])
    .filter((e) => e.type === 'Goal' && !/missed/i.test(e.detail ?? '') && !shootout(e))
    .map((e) => ({
      minute: e.time?.elapsed ?? null,
      extra: e.time?.extra ?? null,
      side: sideOf(e.team?.id, f),
      player: e.player?.name ?? null,
      assist: e.assist?.name ?? null,
      kind: /own goal/i.test(e.detail ?? '') ? 'own' : /penalty/i.test(e.detail ?? '') ? 'penalty' : 'goal',
    }));
}

/** Sendings-off: a straight red, or a second yellow (the provider sends the
 *  second yellow AND a 'Red Card' for it - one dismissal, counted once). */
export function redsOf(f) {
  const out = [];
  const seen = new Set();
  for (const e of f.events ?? []) {
    if (e.type !== 'Card' || !/red card|second yellow/i.test(e.detail ?? '')) continue;
    const key = `${e.player?.id ?? e.player?.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ minute: e.time?.elapsed ?? null, extra: e.time?.extra ?? null, side: sideOf(e.team?.id, f), player: e.player?.name ?? null });
  }
  return out;
}

/** Moves whenever the timeline does: count, and the last event's identity. */
export function eventsSig(f) {
  const ev = f.events ?? [];
  const last = ev[ev.length - 1];
  return `${ev.length}:${last ? `${last.time?.elapsed}+${last.time?.extra ?? 0}:${last.type}:${last.detail}:${last.player?.id ?? ''}` : ''}`;
}

/** The provider's fixture -> what this poller writes. */
export function liveFromFixture(f) {
  const short = f.fixture?.status?.short ?? null;
  const status = mapFixtureStatus(short);
  const ht = f.score?.halftime;
  return {
    status,
    statusShort: short,
    homeScore: f.goals?.home ?? null,
    awayScore: f.goals?.away ?? null,
    liveState: soccerLiveState(status, f.fixture?.status),
    goals: goalsOf(f),
    reds: redsOf(f),
    halftime: ht && ht.home != null && ht.away != null ? { home: ht.home, away: ht.away } : null,
    sig: eventsSig(f),
  };
}

const asObj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/** Key-order-free JSON: jsonb stores keys shortest-first, so a value read back
 *  never stringifies like the one written. */
const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));

/** Did anything a reader can see move? */
export function changed(row, next) {
  const md = asObj(row.metadata);
  const el = asObj(md.epl_live);
  return row.status !== next.status
    || (row.home_score ?? null) !== next.homeScore || (row.away_score ?? null) !== next.awayScore
    || stable(md.live_state ?? null) !== stable(next.liveState)
    || el.sig !== next.sig
    || stable(el.halftime ?? null) !== stable(next.halftime);
}

/**
 * THE STUCK RULE. For a row held as live: final when the provider says so, or
 * when a successful response no longer carries it and nothing was written for
 * STUCK_QUIET_MIN. Returns 'final' | null. Never consults kickoff_at.
 */
export function stuckVerdict({ row, fixture, responseOk, now }) {
  if (row.status !== 'live' || !responseOk) return null;
  if (fixture) return null; // the provider answers for it; its own status rules
  const wrote = asObj(asObj(row.metadata).epl_live).wroteAt;
  const quietMin = wrote ? (new Date(now) - new Date(wrote)) / 60000 : Infinity;
  return quietMin >= STUCK_QUIET_MIN ? 'final' : null;
}

/** When the whistle went: seen by this poller, else kickoff + FT_FALLBACK_MIN. */
export function fullTimeOf(row) {
  const seen = asObj(asObj(row.metadata).epl_live).fullTimeAt;
  return seen ? new Date(seen) : new Date(new Date(row.kickoff_at).getTime() + FT_FALLBACK_MIN * 60000);
}

const STAT_COLS = ['team_id', 'started', 'minutes_played', 'goals', 'assists', 'shots', 'shots_on_target',
  'passes_attempted', 'key_passes', 'tackles', 'interceptions', 'blocks', 'duels_won', 'duels_total',
  'saves', 'goals_conceded', 'yellow_cards', 'red_cards', 'fouls_committed', 'fouls_drawn', 'match_rating',
  // EPL Weekly 5's (migration 121): a correction to any of these re-settles.
  'penalties_saved', 'penalties_missed', 'own_goals', 'conceded_on_pitch'];
export const STAT_COLUMNS = Object.freeze(STAT_COLS);

/** Before/after player rows -> ['<player_id> goals 0->1', ...]. Numbers compare as numbers. */
export function diffStats(before, after) {
  const norm = (v) => (v == null ? null : typeof v === 'boolean' ? v : Number(v));
  const b = new Map(before.map((r) => [String(r.player_id), r]));
  const out = [];
  for (const r of after) {
    const prev = b.get(String(r.player_id));
    if (!prev) { out.push(`${r.player_id} new row`); continue; }
    for (const c of STAT_COLS) {
      if (norm(prev[c]) !== norm(r[c])) out.push(`${r.player_id} ${c} ${prev[c]}->${r[c]}`);
    }
  }
  const a = new Set(after.map((r) => String(r.player_id)));
  for (const r of before) if (!a.has(String(r.player_id))) out.push(`${r.player_id} row gone`);
  return out;
}

// ---------------------------------------------------------------------------
// READS
// ---------------------------------------------------------------------------

const iso = (d) => new Date(d).toISOString();

/** EPL rows in the live window: held live, or scheduled within the window. */
export async function windowRows(sql, now = new Date()) {
  return sql`
    SELECT m.id, m.slug, m.status, m.kickoff_at, m.home_score, m.away_score, m.metadata,
           m.external_ids->>'api_sports' AS fixture
      FROM matches m JOIN leagues l ON l.id = m.league_id
     WHERE l.slug = 'epl' AND m.external_ids->>'api_sports' IS NOT NULL
       AND (m.status = 'live'
            OR (m.status = 'scheduled'
                AND m.kickoff_at >= ${iso(now)}::timestamptz - (${WINDOW_AFTER_MIN} * interval '1 minute')
                AND m.kickoff_at <= ${iso(now)}::timestamptz + (${WINDOW_BEFORE_MIN} * interval '1 minute')))
     ORDER BY m.kickoff_at, m.id
     LIMIT ${MAX_IDS}`;
}

/** Finals in the last 72h whose full-time stats are not in yet (and not tried in FT_RETRY_MIN). */
export async function ftPending(sql, now = new Date()) {
  return sql`
    SELECT m.id, m.slug, m.kickoff_at, m.metadata, m.external_ids->>'api_sports' AS fixture
      FROM matches m JOIN leagues l ON l.id = m.league_id
     WHERE l.slug = 'epl' AND m.status = 'final' AND m.external_ids->>'api_sports' IS NOT NULL
       AND m.kickoff_at >= ${iso(now)}::timestamptz - interval '72 hours'
       AND m.kickoff_at <= ${iso(now)}::timestamptz
       AND (m.metadata->'epl_stats'->>'ftSyncAt') IS NULL
       AND ((m.metadata->'epl_stats'->>'ftTryAt') IS NULL
            OR (m.metadata->'epl_stats'->>'ftTryAt')::timestamptz
               <= ${iso(now)}::timestamptz - (${FT_RETRY_MIN} * interval '1 minute'))
     ORDER BY m.kickoff_at LIMIT ${MAX_IDS}`;
}

/** Finals whose full-time stats are in and whose +24h re-sync is due. */
export async function resyncDue(sql, now = new Date()) {
  const rows = await sql`
    SELECT m.id, m.slug, m.kickoff_at, m.metadata, m.external_ids->>'api_sports' AS fixture
      FROM matches m JOIN leagues l ON l.id = m.league_id
     WHERE l.slug = 'epl' AND m.status = 'final'
       AND (m.metadata->'epl_stats'->>'ftSyncAt') IS NOT NULL
       AND (m.metadata->'epl_stats'->>'resyncAt') IS NULL
       AND m.kickoff_at >= ${iso(now)}::timestamptz - interval '7 days'
     ORDER BY m.kickoff_at LIMIT ${MAX_IDS}`;
  return rows.filter((r) => fullTimeOf(r).getTime() + RESYNC_AFTER_H * 3600000 <= new Date(now).getTime());
}

/** Is there anything for a tick to do? The route asks before it records anything. */
export async function eplWindowOpen(sql, now = new Date()) {
  const [rows, pending, due] = await Promise.all([windowRows(sql, now), ftPending(sql, now), resyncDue(sql, now)]);
  return rows.length + pending.length + due.length > 0;
}

// ---------------------------------------------------------------------------
// WRITES
// ---------------------------------------------------------------------------

/** Replace flat top-level metadata keys, one jsonb_set each, on a base forced
 *  to an object first - never an || onto an unconfirmed shape. */
const META_KEYS = new Set(['live_state', 'epl_live', 'epl_stats']);
async function setMetaKeys(sql, id, keys) {
  for (const [k, v] of Object.entries(keys)) {
    if (!META_KEYS.has(k)) throw new Error(`eplLive: refusing metadata key ${k}`);
    await sql`
      UPDATE matches SET metadata = jsonb_set(
               CASE WHEN jsonb_typeof(metadata) = 'object' THEN metadata ELSE '{}'::jsonb END,
               ARRAY[${k}]::text[], ${JSON.stringify(v ?? null)}::jsonb, true)
       WHERE id = ${id}`;
  }
}

/** One fixture's write: the row, then its two flat keys. A final never goes back to live. */
async function writeLive(sql, row, next, now, { forcedFinal = false } = {}) {
  const prevEl = asObj(asObj(row.metadata).epl_live);
  const becameFinal = next.status === 'final' && row.status !== 'final';
  const eplLive = {
    goals: next.goals,
    reds: next.reds,
    halftime: next.halftime,
    sig: next.sig,
    period: next.statusShort,
    wroteAt: iso(now),
    fullTimeAt: prevEl.fullTimeAt ?? (next.status === 'final' ? iso(now) : null),
    ...(forcedFinal || prevEl.forcedFinal ? { forcedFinal: true } : {}),
  };
  const r = await sql`
    UPDATE matches SET status = ${next.status}, home_score = ${next.homeScore}, away_score = ${next.awayScore},
           data_provider_synced_at = now(), updated_at = now()
     WHERE id = ${row.id} AND (status <> 'final' OR ${next.status} = 'final')
    RETURNING id`;
  if (!r.length) return { skipped: 'final stays final' };
  await setMetaKeys(sql, row.id, { live_state: next.liveState, epl_live: eplLive });
  return { wrote: true, becameFinal };
}

// ---------------------------------------------------------------------------
// THE TICK
// ---------------------------------------------------------------------------

async function statsSnapshot(sql, matchId) {
  return sql.query(
    `SELECT player_id, ${STAT_COLS.join(', ')} FROM player_match_stats WHERE match_id = $1 ORDER BY player_id`,
    [matchId]);
}

/**
 * One tick. Injectable: `client` (fixturesByIds), `importStats`
 * (importEplPlayerStats-shaped), `atoms` ({ events, statistics }), `breaker`
 * ({ isTripped, trip }) and `now` - the replay drives all of them.
 */
export async function runEplLive({
  sql,
  client,
  importStats = importEplPlayerStats,
  atoms = { events: syncMatchEvents, statistics: syncMatchStatistics },
  breaker = { isTripped: isDailyCapTripped, trip: tripDailyCap },
  snapshot = null,
  // EPL Weekly 5's in-play lines (lib/soccer/liveLines.js). Injectable; a
  // failure here is an error line in the summary, never a lost tick.
  liveLines = writeLiveLines,
  now = new Date(),
} = {}) {
  const [rows, pending, due] = await Promise.all([windowRows(sql, now), ftPending(sql, now), resyncDue(sql, now)]);
  if (!rows.length && !pending.length && !due.length) return { decision: 'outside-window' };

  const summary = { window: rows.length, polled: 0, wrote: 0, final: [], forced: [], ft: [], resync: [], errors: [] };
  if (await breaker.isTripped()) return { ...summary, decision: 'breaker-tripped' };

  // ---- live ----------------------------------------------------------------
  const embedded = new Map(); // fixture id -> players payload, from this tick
  if (rows.length) {
    let resp = null; let responseOk = false;
    try {
      resp = await client.fixturesByIds(rows.map((r) => r.fixture));
      responseOk = Array.isArray(resp);
    } catch (e) {
      if (e instanceof DailyCapError || e?.name === 'DailyCapError') {
        await breaker.trip({ reason: 'detected_in_epl_live' });
        return { ...summary, decision: 'daily-cap' };
      }
      summary.errors.push(String(e?.message ?? e).slice(0, 200));
    }
    summary.polled = responseOk ? resp.length : 0;
    const byFx = new Map((resp ?? []).map((f) => [String(f.fixture?.id), f]));
    for (const row of rows) {
      const f = byFx.get(String(row.fixture)) ?? null;
      try {
        if (f) {
          // THE WHOLE FIXTURE rides along (players AND events), so the
          // full-time import can walk the on-pitch windows (EPL Weekly 5).
          if (Array.isArray(f.players) && f.players.length) embedded.set(String(row.fixture), f);
          const next = liveFromFixture(f);
          if (!changed(row, next)) continue;
          const w = await writeLive(sql, row, next, now);
          if (!w.wrote) continue;
          summary.wrote += 1;
          if (w.becameFinal) summary.final.push(row.slug);
          if (asObj(asObj(row.metadata).epl_live).sig !== next.sig && (f.events ?? []).length) {
            await atoms.events(row.id, f.events, { homeTeamApiId: f.teams?.home?.id, awayTeamApiId: f.teams?.away?.id, fixtureApiId: Number(row.fixture) });
          }
          if (Array.isArray(f.statistics) && f.statistics.length >= 2) {
            await atoms.statistics(row.id, f.statistics, { homeTeamApiId: f.teams?.home?.id, awayTeamApiId: f.teams?.away?.id, fixtureApiId: Number(row.fixture) });
          }
          if (liveLines && Array.isArray(f.players) && f.players.length) {
            try { await liveLines(sql, row.id, f); } catch (e) { summary.errors.push(`lines ${row.slug}: ${String(e?.message ?? e).slice(0, 120)}`); }
          }
        } else if (stuckVerdict({ row, fixture: f, responseOk, now }) === 'final') {
          const prev = asObj(asObj(row.metadata).epl_live);
          await writeLive(sql, row, {
            status: 'final', statusShort: 'FT', homeScore: row.home_score, awayScore: row.away_score, liveState: null,
            goals: prev.goals ?? [], reds: prev.reds ?? [], halftime: prev.halftime ?? null, sig: prev.sig ?? null,
          }, now, { forcedFinal: true });
          summary.forced.push(row.slug);
          console.log(`[epl-live] ${row.slug} forced final: absent from a good response, quiet ${STUCK_QUIET_MIN}+ min`);
        }
      } catch (e) {
        summary.errors.push(`${row.slug}: ${String(e?.message ?? e).slice(0, 160)}`);
      }
    }
  }

  // ---- full-time player stats ----------------------------------------------
  const ftRows = await ftPending(sql, now); // re-read: this tick may have finaled some
  for (const m of ftRows) {
    const players = embedded.get(String(m.fixture));
    const fetchPlayers = players ? async () => ({ teams: players.players, fixture: players, budget: null }) : undefined;
    try {
      const r = await importStats(sql, { matchIds: [m.id], ...(fetchPlayers ? { fetchPlayers } : {}) });
      const rowsIn = (r.inserted ?? 0) + (r.updated ?? 0);
      const prevStats = asObj(asObj(m.metadata).epl_stats);
      await setMetaKeys(sql, m.id, {
        epl_stats: rowsIn > 0
          ? { ...prevStats, ftSyncAt: iso(now), ftRows: rowsIn, ftUnmatched: r.unmatchedPlayers ?? 0, ftTryAt: iso(now) }
          : { ...prevStats, ftTryAt: iso(now) },
      });
      summary.ft.push({ slug: m.slug, rows: rowsIn, from: players ? 'tick' : 'fetch' });
    } catch (e) {
      if (e instanceof DailyCapError || e?.name === 'DailyCapError') { await breaker.trip({ reason: 'detected_in_epl_live' }); break; }
      summary.errors.push(`ft ${m.slug}: ${String(e?.message ?? e).slice(0, 160)}`);
    }
  }

  // ---- the +24h re-sync, diffed ---------------------------------------------
  for (const m of due) {
    try {
      const snap = snapshot ?? ((id) => statsSnapshot(sql, id));
      const before = await snap(m.id);
      await importStats(sql, { matchIds: [m.id] });
      const after = await snap(m.id);
      const changes = diffStats(before, after);
      const prevStats = asObj(asObj(m.metadata).epl_stats);
      await setMetaKeys(sql, m.id, {
        epl_stats: { ...prevStats, resyncAt: iso(now), resyncChanged: changes.length, resyncSample: changes.slice(0, 12) },
      });
      summary.resync.push({ slug: m.slug, changed: changes.length });
      if (changes.length) {
        console.log(`[epl-live] ${m.slug} +24h re-sync: ${changes.length} changed - ${changes.slice(0, 12).join('; ')}`);
        for (const hook of RESETTLE_HOOKS) {
          try { await hook({ matchId: m.id, slug: m.slug, changes }); } catch (e) { summary.errors.push(`hook ${m.slug}: ${String(e?.message ?? e).slice(0, 120)}`); }
        }
      }
    } catch (e) {
      summary.errors.push(`resync ${m.slug}: ${String(e?.message ?? e).slice(0, 160)}`);
    }
  }

  return { ...summary, decision: 'ran' };
}
