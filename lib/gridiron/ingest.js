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
    case 'apisports':
      // API-Sports american-football gives game.date as
      //   { timezone: "UTC", date: "2026-08-13", time: "23:00", timestamp: 1786604400 }
      // The TIMESTAMP is authoritative and the only field routed here. The
      // date/time pair is not: a 2024 Hall of Fame row carried time "00:00"
      // with a correct timestamp, so composing the string would have silently
      // moved that kickoff to midnight. Epoch seconds, not milliseconds.
      if (dateTimeStr == null) return null;
      if (!Number.isFinite(Number(dateTimeStr))) {
        throw new Error(`toUtc(apisports): expected epoch seconds, got ${JSON.stringify(dateTimeStr)}`);
      }
      return new Date(Number(dateTimeStr) * 1000).toISOString();
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
  // API-Sports american-football. Unlike BDL this product has a real, small
  // status vocabulary, confirmed across two full seasons of /games (2024: 335
  // rows, 2026: 328 rows).
  //
  // THE TRAP IS 'Final/OT'. On 16 of 2024's games status.short is NULL and only
  // status.long carries "Final/OT" - so an ingest that switched on `short`
  // would drop every overtime game on the floor, silently, and only in the
  // games most likely to matter. mapStatus() resolves short ?? long for this
  // provider, and BOTH spellings are keyed here.
  'apisports:nfl': {
    ns: 'scheduled',
    'not started': 'scheduled',
    ft: 'final',
    finished: 'final',
    'final/ot': 'final',
    aot: 'final',            // 'After Over Time' short form
    'after over time': 'final',
    q1: 'live',
    q2: 'live',
    q3: 'live',
    q4: 'live',
    ot: 'live',
    ht: 'live',
    'halftime': 'live',
    'in play': 'live',
    pst: 'postponed',
    postponed: 'postponed',
    canc: 'cancelled',
    cancelled: 'cancelled',
    // NOTE ON THE LIVE TOKENS. Q1-Q4 / OT / HT are this product's documented
    // in-play shorts and are keyed ahead of first contact, unlike the BDL block
    // above which deliberately refuses to guess. The difference is evidence:
    // BDL's in-game spellings have never been observed at all, whereas these
    // come from the provider's published status list for THIS product. If a
    // token still arrives unmapped, the fail-loud path below reports it rather
    // than mapping it wrong - which is the property worth keeping either way.
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

  // API-Sports passes the whole status OBJECT { short, long, timer }, because
  // `short` alone is not sufficient: it is NULL on overtime finals, where only
  // long ("Final/OT") identifies the game. Resolve short, then fall back to
  // long, then hand the result to the table. A caller passing a bare string
  // still works - String(rawStatus) covers it.
  if (provider === 'apisports' && rawStatus && typeof rawStatus === 'object') {
    const token = rawStatus.short ?? rawStatus.long ?? null;
    if (token == null) {
      log.error('mapStatus: apisports status has neither short nor long', { rawStatus });
      if (runSummary) runSummary.unknownStatus += 1;
      return null;
    }
    return mapStatus(provider, sport, token, runSummary);
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

// ---------------------------------------------------------------------------
// (e) apiSportsPhaseAndWeek — API-Sports stage + week -> (season_phase, week)
// ---------------------------------------------------------------------------
// This product carries the phase as a PROSE STAGE and the week as a PROSE
// STRING, neither of which our columns take: matches.season_phase is
// REG|PRE|POST and matches.week is an integer. The full vocabulary, confirmed
// across two complete seasons of /games (2024: 335 rows, 2026: 328):
//
//   Pre Season     :: Hall of Fame Weekend | Week 1..3
//   Regular Season :: Week 1..18
//   Post Season    :: Wild Card | Divisional Round | Conference Championships
//                     | Pro Bowl | Super Bowl
//
// TWO THINGS THAT WOULD GO WRONG QUIETLY.
//
// 1. THE PRO BOWL IS STAGED AS "Post Season". Mapped naively it becomes a POST
//    game and lands in team records, so a team's postseason count picks up an
//    all-star exhibition. It is returned as phase 'STAR', which skipRule
//    already drops loudly and counts - the same treatment the SportsData feed's
//    all-star rows get. 2024 carried exactly one.
//
// 2. THE POSTSEASON WEEK NUMBERS ARE NOT 1,2,3,4. PROD's existing NFL POST rows
//    (written by the other feed) use the NFL's own numbering: Wild Card 1,
//    Divisional 2, Conference 3, Pro Bowl 4, SUPER BOWL 5. Week 4 is skipped in
//    the data precisely because the Pro Bowl occupies it. Numbering the Super
//    Bowl 4 here would give the same game two different week values depending
//    on which provider imported it - invisible until someone joined on it.
//
// Hall of Fame Weekend is week 0: it precedes preseason Week 1 and needs a
// number, and 0 is the only one that sorts correctly ahead of it.
const APISPORTS_STAGE = {
  'pre season': 'PRE',
  'regular season': 'REG',
  'post season': 'POST',
};

const APISPORTS_POST_WEEK = {
  'wild card': 1,
  'divisional round': 2,
  'conference championships': 3,
  'pro bowl': 4,          // STAR - skipped, numbered only for completeness
  'super bowl': 5,
};

const HALL_OF_FAME_WEEK = 0;

export function apiSportsPhaseAndWeek(stage, week, runSummary) {
  const s = String(stage ?? '').trim().toLowerCase();
  const w = String(week ?? '').trim();
  const wl = w.toLowerCase();
  const phase = APISPORTS_STAGE[s] ?? null;

  if (phase == null) {
    log.error('apiSportsPhaseAndWeek: unrecognized stage', { stage, week });
    if (runSummary) runSummary.unknownStatus += 1;
    return { phase: null, week: null, label: w || null };
  }

  // The Pro Bowl is an all-star game wearing a postseason label.
  if (wl === 'pro bowl') return { phase: 'STAR', week: APISPORTS_POST_WEEK[wl], label: w };

  if (phase === 'POST') {
    const n = APISPORTS_POST_WEEK[wl];
    if (n == null) {
      log.error('apiSportsPhaseAndWeek: unrecognized postseason round', { stage, week });
      if (runSummary) runSummary.unknownStatus += 1;
      return { phase, week: null, label: w };
    }
    return { phase, week: n, label: w };
  }

  if (phase === 'PRE' && /hall of fame/.test(wl)) {
    return { phase, week: HALL_OF_FAME_WEEK, label: w };
  }

  const m = wl.match(/^week\s+(\d+)$/);
  if (m) return { phase, week: Number(m[1]), label: w };

  log.error('apiSportsPhaseAndWeek: unrecognized week label', { stage, week });
  if (runSummary) runSummary.unknownStatus += 1;
  return { phase, week: null, label: w || null };
}

export function skipRule(seasonPhase, runSummary) {
  const phase = String(seasonPhase ?? '').trim().toUpperCase();
  if (STORED_PHASES.has(phase)) return { skip: false, phase };
  log.info('skipRule: skipping non-storable season phase', { seasonPhase, phase });
  if (runSummary) {
    runSummary.skippedByPhase[phase] = (runSummary.skippedByPhase[phase] || 0) + 1;
  }
  return { skip: true, phase, reason: `season phase ${phase || '(empty)'} not stored` };
}
