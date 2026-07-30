// lib/gridiron/ingest.js — gridiron (NFL / College Football) ingest boundary.
//
// The ONLY sanctioned way sync code touches provider datetimes, statuses, and
// season phases for the gridiron feeds. Implements
// ~/scratch/sportsdata-spike/INGEST-UTILITIES-SPEC.md, adapted to the real
// provider shapes captured in ~/scratch/football-vendor-spike/ (BDL + CFBD).
//
// HARD RULES (review-enforced; also in CLAUDE.md):
//   - Raw `new Date(providerString)` on a provider datetime is FORBIDDEN outside
//     this module. Always route through toUtc(). SportsData strings are
//     US-Eastern local with NO offset ("2025-09-04T20:20:00") -> naive parsing
//     is 4-5h wrong. BDL/CFBD strings ARE already UTC ('...Z'), but still go
//     through toUtc() so the parsing boundary lives in exactly one place.
//   - Ad-hoc `AT TIME ZONE` SQL is FORBIDDEN outside easternLocalToUtc() below.
//
// DEPENDENCY FLAG (for the sync-module session): gridiron player rows written by
// the eventual sync code must satisfy whatever shape / FK user_player_follows
// (migration 041) expects. That table postdates the gridiron design, so its
// player_id FK target and any NOT NULL columns MUST be confirmed before wiring
// player upserts here.

import { sql } from '../db.js';

// Minimal structured logger. No logger util exists in-stack yet; keep the shape
// the spec calls for (log.error / log.info) so a real logger drops in later.
const log = {
  error: (...a) => console.error('[gridiron.ingest]', ...a),
  info: (...a) => console.info('[gridiron.ingest]', ...a),
};

// ---------------------------------------------------------------------------
// (d) Run-summary factory
// ---------------------------------------------------------------------------
// Every sync run reports these counters so "0 games ingested this week" reads as
// an intentional skip (Pro Bowl week) rather than a broken sync.
export function makeRunSummary() {
  return {
    ingested: 0,
    skippedByPhase: {},        // { OFF: n, STAR: n, ... }
    unknownStatus: 0,          // fail-loud mapStatus misses
    timeResolvedFromFallback: 0, // times sourced from a fallback payload
  };
}

// ---------------------------------------------------------------------------
// (a) toUtc — provider datetime -> ISO-8601 UTC string ('...Z') | null
// ---------------------------------------------------------------------------
// Appends 'Z' to a naive UTC instant; passes a zoned/offset string through.
function asUtcIso(s) {
  if (s == null) return null;
  const hasZone = /[zZ]$|[+-]\d\d:?\d\d$/.test(s);
  return new Date(hasZone ? s : `${s}Z`).toISOString();
}

// provider: 'bdl' | 'cfbd' | 'sportsdata'. Async because the sportsdata
// free-tier path resolves DST in Postgres. Throws on an unrecognized provider.
export async function toUtc(dateTimeStr, dateTimeUtcField, provider) {
  switch (provider) {
    case 'bdl':
    case 'cfbd':
    case 'oddsapi':
      // Spike-confirmed already-UTC ISO-8601 (BDL `date`, CFBD `startDate`:
      // "2025-09-05T00:20:00.000Z"; The Odds API `commence_time`:
      // "2026-09-05T00:20:00Z"). Offset-safe direct parse — routed here anyway so
      // the provider-datetime parsing boundary lives in exactly one place.
      return dateTimeStr == null ? null : new Date(dateTimeStr).toISOString();
    case 'sportsdata':
      // Paid-tier fast path: DateTimeUTC is already a UTC instant.
      if (dateTimeUtcField != null) return asUtcIso(dateTimeUtcField);
      // Free-tier path: naive ET-local -> UTC, DST-aware (Postgres). null here
      // means the caller must source the time from another payload before
      // insert (matches.kickoff_at is NOT NULL); never insert a placeholder.
      if (dateTimeStr == null) return null;
      return easternLocalToUtc(dateTimeStr);
    default:
      throw new Error(`toUtc: unrecognized provider '${provider}'`);
  }
}

// The single sanctioned ET-local -> UTC conversion. Naive ET string in, ISO-8601
// UTC out, DST resolved by Postgres' IANA tz database (house style: the codebase
// already uses AT TIME ZONE for PT). No JS timezone math anywhere. The double
// AT TIME ZONE ((naive AT NY) -> instant; (instant AT UTC) -> UTC wall time) plus
// to_char yields a deterministic '...Z' string with no driver type ambiguity.
export async function easternLocalToUtc(dateTimeStr) {
  if (dateTimeStr == null) return null;
  const rows = await sql`
    SELECT to_char(
             (${dateTimeStr}::timestamp AT TIME ZONE 'America/New_York') AT TIME ZONE 'UTC',
             'YYYY-MM-DD"T"HH24:MI:SS"Z"'
           ) AS utc`;
  return rows[0]?.utc ?? null;
}

// ---------------------------------------------------------------------------
// (b) mapStatus — (provider, sport, rawStatus) -> our status | null (skip)
// ---------------------------------------------------------------------------
// matches.status CHECK: scheduled | live | final | postponed | cancelled.
// Keyed per (provider, sport): the spike found the status vocabulary differs by
// product (NFL 'Final'/'Final/OT', MLB 'STATUS_*', CFBD a `completed` boolean).
// Unknown token -> log.error + runSummary.unknownStatus++ + return null (caller
// skips the status write; a prior status is left intact). NEVER store an unmapped
// status; any unknownStatus > 0 is the signal to add the token here.
const STATUS_MAP = {
  'bdl:nfl': {
    final: 'final',
    'final/ot': 'final',
    // Late-season flex games (weeks 16-18) whose kickoff slot the NFL has not yet
    // assigned carry status "TBD" (with a midnight-ET placeholder date); still a
    // not-yet-played game -> scheduled. A later sync upserts the real kickoff once
    // the slot is flexed. Confirmed via BDL probe: all 24 unmapped 2026 games.
    tbd: 'scheduled',
    // Not-yet-played games with an assigned slot carry the KICKOFF DATETIME as
    // their status string (e.g. "9/9 - 8:20 PM EDT"), one distinct value per game
    // — handled by the datetime pattern in mapStatus() below, not a table key.
    // UNVERIFIED in-game tokens — exact spelling still unconfirmed:
    //   'in progress' -> 'live'        (token may be 'InProgress' / 'In Progress')
    //   'postponed'   -> 'postponed'
    //   'canceled'    -> 'cancelled'
    // Settled reality on WHEN these get confirmed: BDL carries no preseason, so
    // the mid-August preseason weekend this note originally pointed at cannot
    // confirm anything. First live NFL data is Week 1 (Thu Sep 10). We do NOT
    // guess the spellings ahead of it: mapStatus's unknown-token path already
    // fails loud (log.error + runSummary.unknownStatus++ + skip the status write,
    // leaving the prior status intact), and maybeAlert emails on unknownStatus > 0.
    // So the first live tick self-reports the real token and we add it here from
    // evidence. Adding a speculative key would defeat that alert — a wrong guess
    // maps silently instead of shouting.
  },
  // Spike residue, currently UNEXERCISED: nothing in the app ingests MLB — no
  // poller, no league row, no caller passes sport 'mlb'. The "confirm on the
  // Jul 17+ live poll" this block used to promise never happened because that poll
  // does not exist. Kept as the recorded vocabulary from the BDL spike so a future
  // MLB slice starts from evidence rather than re-probing; 'status_in_progress' ->
  // 'live' remains the unverified third token. Same fail-loud contract applies if
  // MLB is ever wired: an unknown token alerts rather than guesses.
  'bdl:mlb': {
    status_scheduled: 'scheduled',
    status_final: 'final',
  },
};

export function mapStatus(provider, sport, rawStatus, runSummary) {
  // CFBD exposes no status string; games carry a `completed` boolean (+ start
  // time). Derive: completed true -> final; false + started -> live; false +
  // future/TBD -> scheduled. (Spike payload fields: completed, startDate ISO-Z,
  // startTimeTBD.)
  //
  // CFB is therefore UNAFFECTED by the unverified-token question above: there is no
  // provider status vocabulary to get wrong, so nothing here waits on a live
  // weekend. The Aug 29 CFB opener needs no status work; only the NFL Week 1 tick
  // (Sep 10) can teach us BDL's in-game spellings.
  if (provider === 'cfbd' && sport === 'cfb') {
    const g = rawStatus ?? {};
    if (g.completed === true) return 'final';
    if (g.completed === false) {
      if (g.startTimeTBD) return 'scheduled';
      if (g.startDate != null && new Date(g.startDate).getTime() <= Date.now()) return 'live';
      return 'scheduled';
    }
    log.error('mapStatus: unrecognized CFBD status shape', { rawStatus });
    if (runSummary) runSummary.unknownStatus += 1;
    return null;
  }

  // BDL NFL uses the kickoff datetime string as the status of a not-yet-played
  // game (e.g. "9/9 - 8:20 PM EDT") — one distinct value per game, so it can't be
  // a table key. Treat that pattern as scheduled. Final/Final-OT still map via the
  // table; any OTHER token (in-game / other) stays fail-loud below.
  if (provider === 'bdl' && sport === 'nfl' && /\d+\/\d+ - .*(AM|PM)/i.test(String(rawStatus ?? ''))) {
    return 'scheduled';
  }

  const table = STATUS_MAP[`${provider}:${sport}`];
  if (!table) {
    log.error('mapStatus: no status table for provider/sport', { provider, sport });
    if (runSummary) runSummary.unknownStatus += 1;
    return null;
  }
  const norm = String(rawStatus ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  const hit = table[norm];
  if (hit) return hit;
  log.error('mapStatus: UNKNOWN status token', { provider, sport, raw: rawStatus });
  if (runSummary) runSummary.unknownStatus += 1;
  return null;
}

// ---------------------------------------------------------------------------
// (c) skipRule — season-phase gate
// ---------------------------------------------------------------------------
// REG/PRE/POST are stored; OFF/STAR (offseason / Pro Bowl / all-star) are a
// LOUD, COUNTED skip (never a silent drop, never a sync failure). matches
// .season_phase CHECK only allows REG|PRE|POST, so a STAR row must be dropped
// before insert, visibly.
const STORED_PHASES = new Set(['REG', 'PRE', 'POST']);

export function skipRule(seasonPhase, runSummary) {
  const phase = String(seasonPhase ?? '').trim().toUpperCase();
  if (STORED_PHASES.has(phase)) return { skip: false, phase };
  log.info('skipRule: skipping non-storable season phase', { seasonPhase, phase });
  if (runSummary) {
    runSummary.skippedByPhase[phase] = (runSummary.skippedByPhase[phase] || 0) + 1;
  }
  return { skip: true, phase, reason: `season phase ${phase || '(empty)'} not stored` };
}
