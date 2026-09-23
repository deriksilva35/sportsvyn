// services/live-poller/poll.mjs — one poll of one league. The only file here
// that talks to a provider, and it is deliberately thin: every decision it
// makes was made in a pure module under lib/live/ and can be tested without a
// network, a clock or a database.

import { mapLiveStatus, liveState, parseBdlProse } from '../../lib/live/vocabulary.js';
import { writeLive, scoreChanged } from '../../lib/live/write.js';
import { toScoreRow } from '../../lib/live/scoreEvent.js';
import { fromBdlMlb } from '../../lib/mlb/ingest.js';
import { mlbDetailOf, writeMlbDetail, writeMlbGamePk, writeMlbLineups, writeMlbProbables, lineupDue } from '../../lib/mlb/detail.js';
import { fetchScheduleByMatch, fetchGameFeed, pickByKickoff, matchKey, statsApiEnabled } from '../../lib/mlb/statsapi.js';

import { emit } from '../../lib/wire/emit.js';
import { transitionsFor } from '../../lib/push/transitions.js';
import { dispatch } from '../../lib/push/dispatch.js';
import { scoreKindLabel } from '../../lib/push/payload.js';
import { onScore, onTick, flush as flushFold, FOLD_WINDOW_MS } from '../../lib/push/scoreFold.js';
import { scoringPlayFor } from '../../lib/push/scoringPlayRead.js';
import { activityEventFor, pushLiveActivities } from '../../lib/push/liveActivityStore.js';
import { stateFromMatch, liveLine } from '../../lib/push/liveActivityState.js';
import { playsFor } from '../../lib/gridiron/playsImport.js';

const CFBD = 'https://apinext.collegefootballdata.com';
const BDL = 'https://api.balldontlie.io';

// LAST SCORE KIND, PER TEAM, PER MATCH - in-memory, one process's worth.
// A restart loses it, which only matters for the very next delta-of-2 for a
// team right after that restart (it will read as a safety rather than a
// two-point conversion if the touchdown it followed happened before the
// restart) - a small, honest, documented edge, not a reason to persist this
// to the database for a courtesy notification's own copy.
const lastScoreKind = new Map();
// HELD TOUCHDOWNS, keyed `${matchId}:${team}`. In-process and deliberately so:
// a hold is at most FOLD_WINDOW_MS old, and a restart inside that window loses
// nothing a reader would notice - the six went unsent, and the next delta on
// that team sends the current scoreline anyway. Persisting it would be a
// durable store for ninety seconds of state.
const pendingScore = new Map();
// THE LAST LINE PUT ON A LOCK SCREEN, per match. In-process, like the two
// above, and for the same reason: it is the memory of what a CARD already
// says, and a restart's cost is one redundant push per live game on the first
// tick after it - which re-syncs a card rather than corrupting one. A column
// for it would be a migration for a courtesy's own copy.
//
// IT IS WHY THIS RELAY OWES A RESTART: the map is the rule.
const lastLaLine = new Map();

// THE COALESCING WINDOW (LA-CADENCE). A card carrying the clock and the last
// play changes on almost every snap, and the previous rule pushed on every one
// of them: 14 of 20 pushes on one CFB game landed 35 seconds or less after the
// one before. A lock screen does not need the clock to the second, and a phone
// has a budget for these.
//
// SO THE TRIGGERS SPLIT IN TWO. A SCORE OR A PERIOD CHANGE IS NEWS and goes out
// at once, as it always did; a FINAL likewise. The CLOCK and the LAST PLAY are
// texture: they coalesce, at most one push per Activity per window, and the
// push carries the line as it stands when it fires rather than the line that
// first went stale.
//
// AN IMMEDIATE PUSH RESETS NOTHING. The window belongs to the texture, so a
// score landing 30 seconds into it does not buy the next two minutes of silence
// - the coalesced push still fires on its own schedule with whatever the clock
// says then. Only a coalesced push restarts the window, which is what makes the
// rate a ceiling on texture rather than on news.
//
// PER MATCH IS PER ACTIVITY. The rider runs once per match per tick and
// pushLiveActivities fans one push out to every Activity on that match, so a
// ceiling of one push per match per window IS one per Activity per window.
export const LA_COALESCE_MS = 120_000;
const lastLaPushAt = new Map();

// THE HOURLY LEDGER, per Activity. The push count lived nowhere: live_activities
// carries updated_at and nothing else, so "how many pushes did this card take"
// could only be answered by grepping the journal, and only as far back as the
// journal goes. This keeps the timestamps in memory and the summary states the
// count, which is the number this relay is judged on.
const laPushLog = new Map();

export function recordLaPushes(ids, now = Date.now(), windowMs = 3_600_000) {
  for (const id of ids ?? []) {
    const hits = laPushLog.get(id) ?? [];
    hits.push(now);
    laPushLog.set(id, hits);
  }
  // Prune every tracked Activity, not only the ones just pushed: a card that
  // has gone quiet must age out of the ledger rather than sit at its last count
  // forever, and an ended one must not leak.
  for (const [id, hits] of laPushLog) {
    const live = hits.filter((t) => now - t < windowMs);
    if (live.length) laPushLog.set(id, live); else laPushLog.delete(id);
  }
  return Object.fromEntries((ids ?? []).map((id) => [id, (laPushLog.get(id) ?? []).length]));
}

/** Pushes in the last hour, per Activity - for the tick summary. */
export function laPushesPerHour(now = Date.now(), windowMs = 3_600_000) {
  const out = {};
  for (const [id, hits] of laPushLog) {
    const n = hits.filter((t) => now - t < windowMs).length;
    if (n) out[id] = n;
  }
  return out;
}

/** Test seam: the poller is a long-lived process, a test is not. */
export function _resetLaCadence() {
  lastLaLine.clear(); lastLaPushAt.clear(); laPushLog.clear();
}

// ---------------------------------------------------------------------------
// Fetchers. ONE CALL PER POLL PER LEAGUE, which is the number the whole quota
// argument rests on.
// ---------------------------------------------------------------------------

export function cfbdScoreboard({ classification = null } = {}) {
  return async () => {
    const key = process.env.CFBD_API_KEY;
    if (!key) throw new Error('CFBD_API_KEY missing in env');
    const q = classification ? `?classification=${classification}` : '';
    const res = await fetch(`${CFBD}/scoreboard${q}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new Error(`CFBD ${res.status} on /scoreboard${q}`);
    return { rows: await res.json(), calls: 1 };
  };
}

// DATES[], NOT SEASONS[]. The season query pages the whole schedule at 100 a
// page - three calls to learn about twelve games - and every page after the
// first is spent on games that finished in September. One day is one call and
// no cursor. Measured 1 Sep 2026: 12 rows, next_cursor undefined.
export function bdlDay(dateIso) {
  return async () => {
    const key = process.env.BDL_API_KEY;
    if (!key) throw new Error('BDL_API_KEY missing in env');
    const res = await fetch(`${BDL}/nfl/v1/games?dates[]=${dateIso}&per_page=100`,
      { headers: { Authorization: key } });
    if (!res.ok) throw new Error(`BDL ${res.status} on /nfl/v1/games`);
    const j = await res.json();
    return { rows: j?.data ?? [], calls: 1 };
  };
}

/**
 * ONE DAY OF MLB. Same route family as bdlDay, a different sport in the path -
 * and it is a SEPARATE function rather than a parameter on that one because
 * bdlDay's caller passes no sport and never will: adding one would change the
 * NFL's call site to say something it has never needed to say.
 *
 * ONE CALL FOR THE WHOLE SLATE, like the NFL. The per-game cost in this sport
 * is the PLAYS route, which takes a singular game_id - see mlbPlaysFor below.
 */
export function mlbDay(dateIso) {
  return async () => {
    const key = process.env.BDL_API_KEY;
    if (!key) throw new Error('BDL_API_KEY missing in env');
    const res = await fetch(`${BDL}/mlb/v1/games?dates[]=${dateIso}&per_page=100`,
      { headers: { Authorization: key } });
    if (!res.ok) throw new Error(`BDL ${res.status} on /mlb/v1/games`);
    const j = await res.json();
    return { rows: j?.data ?? [], calls: 1 };
  };
}

/**
 * THE NEWEST PLAY OF ONE LIVE GAME, which is where the outs and the count
 * live - /games carries neither. One call per live game per poll, which is
 * what the cadence is sized against: a fifteen-game slate is fifteen calls
 * against a 600/minute key.
 *
 * NEVER THROWS. The count is an enrichment on top of a scoreline that is
 * already correct without it; a plays route that 500s must not cost the poll
 * its scores.
 */
export async function mlbNewestPlay(gameId) {
  try {
    const key = process.env.BDL_API_KEY;
    if (!key) return null;
    // per_page=1 with no cursor returns the OLDEST play, so the newest is
    // reached by walking the cursor - which is a call per 100 plays and far
    // too expensive per poll. The whole game is one page at per_page=100 only
    // for the first 100 plays, so this asks for the largest page the route
    // allows and takes the highest `order` it sees.
    const res = await fetch(`${BDL}/mlb/v1/plays?game_id=${gameId}&per_page=100`,
      { headers: { Authorization: key } });
    if (!res.ok) return null;
    const j = await res.json();
    let best = null;
    for (const r of j?.data ?? []) {
      if (r?.order == null) continue;
      if (!best || Number(r.order) > Number(best.order)) best = r;
    }
    return best;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Normalisers. Provider row -> the four things we own. PURE-ish: no db.
// ---------------------------------------------------------------------------

export function fromCfbd(row, unmapped) {
  const status = mapLiveStatus('cfbd', row?.status, unmapped);
  return {
    providerId: row?.id == null ? null : String(row.id),
    status,
    homeScore: Number.isFinite(Number(row?.homeTeam?.points)) ? Number(row.homeTeam.points) : null,
    awayScore: Number.isFinite(Number(row?.awayTeam?.points)) ? Number(row.awayTeam.points) : null,
    liveState: liveState(row?.period, row?.clock),
  };
}

export function fromBdl(row, unmapped) {
  // status_state IS THE MACHINE FIELD. `status` on this feed is prose - the
  // kickoff rendered as "9/13 - 1:00 PM EDT" before the game, one distinct
  // value per row - so it cannot be a table key and is not read here.
  const status = mapLiveStatus('bdl', row?.status_state, unmapped);
  return {
    providerId: row?.id == null ? null : String(row.id),
    status,
    homeScore: Number.isFinite(Number(row?.home_team_score)) ? Number(row.home_team_score) : null,
    awayScore: Number.isFinite(Number(row?.visitor_team_score)) ? Number(row.visitor_team_score) : null,
    // BDL SENDS NO PERIOD OR CLOCK FIELD - but the prose `status` carries
    // both once the game is on ("7:30 - 4th", "halftime"; measured 9 Sep
    // 2026, the NE-SEA opener). parseBdlProse reads it; null when it does
    // not parse, and the headline builder drops the qualifier whole.
    liveState: status === 'live' ? parseBdlProse(row?.status) : null,
  };
}

/**
 * MLB. Delegates the field names to lib/mlb/ingest.js, which is where the
 * "runs live in home_team_data, not in home_team_score" knowledge belongs -
 * this file should not learn a second sport's vocabulary.
 *
 * THE PLAY IS OPTIONAL AND THE SCORE DOES NOT DEPEND ON IT. With a play the
 * live state carries outs and the count; without one it carries the inning and
 * the half and nothing else, which is an honest partial state rather than a
 * missing one.
 */
export function fromMlb(row, unmapped, extra = null) {
  const n = fromBdlMlb(row, unmapped, { play: extra?.play ?? null, live: extra?.live ?? null });
  return {
    providerId: n.providerId,
    status: n.status,
    homeScore: n.homeScore,
    awayScore: n.awayScore,
    liveState: n.liveState,
  };
}

/**
 * THE MLB LEAGUE'S `detail` HOOK. Pure, and named here beside fromMlb so the
 * registry in index.mjs stays a list of facts about a league rather than a
 * place where parsing happens.
 */
export function mlbDetail(row) {
  return mlbDetailOf(row);
}

// ---------------------------------------------------------------------------
// THE SECOND PROVIDER, AND THE ID WE DO NOT HOLD.
// ---------------------------------------------------------------------------

/**
 * ONE SCHEDULE FETCH PER DAY PER PROCESS WINDOW, not one per game per poll.
 * Resolving a gamePk means asking statsapi for the whole day; sixteen live
 * games would otherwise mean sixteen identical fetches every thirty seconds.
 *
 * THE TTL IS LONG BECAUSE THE ANSWER DOES NOT MOVE. A day's game list is set
 * the previous evening; only a suspended game rescheduled mid-slate would
 * change it, and that resolves on the next window rather than never, because
 * the cache is keyed by day and the process restarts nightly anyway.
 */
const SCHED_TTL_MS = 15 * 60 * 1000;
const schedCache = new Map();

export function _resetMlbScheduleCache() { schedCache.clear(); }

async function scheduleFor(dateIso, now = Date.now()) {
  const hit = schedCache.get(dateIso);
  if (hit && now - hit.at < SCHED_TTL_MS) return { byKey: hit.byKey, calls: 0 };
  const byKey = await fetchScheduleByMatch(dateIso);
  schedCache.set(dateIso, { at: now, byKey });
  return { byKey, calls: 1 };
}

/**
 * OUR ROW -> statsapi's gamePk, resolved once and then STORED on the row.
 *
 * THE KEY IS THE AMERICAN CALENDAR DAY, not the UTC one. statsapi's
 * officialDate is ET, and a 01:45Z first pitch is the previous evening's game
 * in every sense a reader has. toLocaleDateString with the ET zone is the one
 * conversion here and it is a DISPLAY-CALENDAR question, not a provider
 * datetime parse - lib/gridiron/ingest.js's boundary is about turning a
 * provider's wall-clock string into an instant, and this turns an instant we
 * already hold into the day it falls on.
 */
export function etDay(iso) {
  const t = iso == null ? NaN : new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export async function resolveMlbGamePk(m, sql, { log = () => {} } = {}) {
  const held = m?.external_ids?.statsapi_game_pk ?? null;
  if (held) return { gamePk: String(held), calls: 0 };
  const day = etDay(m?.kickoff_at);
  const key = matchKey(m?.away_abbr, m?.home_abbr, day);
  if (!key) return { gamePk: null, calls: 0 };
  const { byKey, calls } = await scheduleFor(day);
  // A DOUBLEHEADER WE CANNOT SEPARATE IS REFUSED, not guessed - putting one
  // game's runners on the other game's diamond is worse than no diamond.
  const pick = pickByKickoff(byKey.get(key) ?? [], m?.kickoff_at);
  if (!pick) { log(`[mlb] no statsapi match for ${m?.slug} (${key})`); return { gamePk: null, calls }; }
  // STORED SO THIS HAPPENS ONCE. Its failure costs a re-resolve next poll and
  // nothing else, so it cannot be allowed to cost the enrichment.
  try { await writeMlbGamePk(sql, m.id, pick.gamePk); } catch { /* re-resolves */ }
  return { gamePk: pick.gamePk, calls };
}

/**
 * THE PROBABLE STARTERS OFF THE DAY SCHEDULE - the SAME fetch resolveMlbGamePk
 * consults, memoised for fifteen minutes, so this is one call a day and usually
 * zero.
 *
 * THE SCHEDULE LEADS THE FEED AND THIS WAS MEASURED, not assumed. At 23:57Z on
 * 2026-09-22, SD @ LAD (gamePk 823897, Pre-Game):
 *
 *   /v1/schedule?hydrate=probablePitcher  -> away Michael King, home Brock Stewart
 *   /v1.1/game/823897/feed/live           -> probablePitchers: { away } only
 *
 * The feed had not caught up to the home announcement. Reading only the feed -
 * which is free, because the lineups come from it - would have left the Dodgers
 * reading "starter not announced" while their starter was public on the other
 * endpoint. So the two are MERGED per side, schedule first, and the free read
 * stays as the fallback rather than as the answer.
 */
async function mlbScheduleProbables(m, { now = new Date() } = {}) {
  const day = etDay(m?.kickoff_at);
  const key = matchKey(m?.away_abbr, m?.home_abbr, day);
  if (!key) return { probables: null, calls: 0 };
  const { byKey, calls } = await scheduleFor(day, new Date(now).getTime());
  const pick = pickByKickoff(byKey.get(key) ?? [], m?.kickoff_at);
  return { probables: pick?.probables ?? null, calls };
}

/** PURE. Two partial answers about the same game, side by side. */
export function mergeProbables(primary, fallback) {
  const side = (k) => primary?.[k] ?? fallback?.[k] ?? null;
  const away = side('away'); const home = side('home');
  if (!away && !home) return null;
  return { away, home };
}

/**
 * THE MLB `enrich` HOOK: the newest play from BDL (outs and the count) and the
 * game feed from statsapi (runners, the batter, the pitcher).
 *
 * THE FLAG GATES THE SECOND PROVIDER AND NOTHING ELSE. With MLB_STATSAPI off
 * the play still arrives, the card still shows the half and the outs, and the
 * diamond is simply ABSENT - which is the whole contract lib/mlb/strip.js is
 * built on.
 *
 * NEVER THROWS. Both halves are enrichments on top of a scoreline that is
 * already correct without either.
 */
export async function mlbEnrich(row, m, sql, { log = () => {}, live: isLive = true, now = new Date() } = {}) {
  let calls = 0;
  // THE PLAY IS A LIVE-ONLY CALL. Asking /plays about a game that has not
  // started spends a call to be told there are none.
  const play = isLive ? await mlbNewestPlay(row?.id) : null;
  if (play) calls += 1;
  if (!statsApiEnabled(process.env)) return { play, live: null, lineups: null, calls };

  // THE PRE-KICK PASS ASKS FOR ONE THING AND ON A CADENCE. A live game's feed
  // is fetched anyway (the diamond), and the batting orders are on that same
  // document, so a live lineup costs nothing; a scheduled game's costs a fetch,
  // and lineupDue() is what keeps that from being every game every thirty
  // seconds. See lib/mlb/detail.js.
  if (!isLive && !lineupDue({ kickoff_at: m?.kickoff_at, lineups: m?.before_lineups ?? null }, { now })) {
    return { play, live: null, lineups: null, probables: null, calls };
  }

  let live = null; let lineups = null; let probables = null;
  try {
    const r = await resolveMlbGamePk(m, sql, { log });
    calls += r.calls;
    if (r.gamePk) {
      const feed = await fetchGameFeed(r.gamePk);
      calls += feed.calls;
      live = feed.live;
      lineups = feed.lineups;
      // THE STARTERS RIDE THE SAME DOCUMENT AS THE CARD, so refreshing them
      // costs nothing and happens on exactly lineupDue's cadence. A starter
      // announced at 4pm used to reach the picker only on the next daily pool
      // build - which is tomorrow - so "starter not announced" was a permanent
      // state for the day it mattered on.
      probables = feed.probables;
      // AND THE DAY SCHEDULE ON TOP OF IT, which leads the feed - see
      // mlbScheduleProbables(). Pre-kick only: once a game is live its starter
      // is a matter of record and the card has stopped asking.
      if (!isLive) {
        try {
          const sp = await mlbScheduleProbables(m, { now });
          calls += sp.calls;
          probables = mergeProbables(sp.probables, probables);
        } catch { /* the feed's answer stands */ }
      }
      // NOT POSTED IS A READING TOO, and it must be written. Without a
      // fetchedAt stamp on a game whose card is not up yet, lineupDue() reads
      // "never asked" forever and asks again on every single poll.
      if (!lineups && feed.calls) lineups = { away: null, home: null };
    }
  } catch (e) { log(`[mlb] statsapi enrich failed for ${m?.slug}: ${e.message}`); }
  return { play, live, lineups, probables, calls };
}

/**
 * WHAT A GIVEN STATUS ENTITLES US TO WRITE.
 *
 * CFBD SENDS points: 0 FOR A GAME THAT HAS NOT KICKED OFF - not null, zero.
 * Caught by the dry run against the real payload: every scheduled row came back
 * "0-0", and because COALESCE treats 0 as a value the poller would have written
 * it, put 0-0 on the scoreboard for unplayed games, and emitted a Wire event
 * reading "ECU 0, ALA 0" for a game three days away - deduped on those numbers
 * and therefore uncorrectable.
 *
 * So a scheduled row contributes its STATUS and nothing else. The scores go to
 * null, which COALESCE preserves, so an existing value is untouched and an
 * absent one stays absent. This is the same gate syncCfbLiveScores calls "the
 * one gate that matters", stated once here rather than per provider.
 */
export function scopeToStatus(upd) {
  if (upd.status === 'live' || upd.status === 'final') return upd;
  return { ...upd, homeScore: null, awayScore: null, liveState: null };
}

// ---------------------------------------------------------------------------
// One poll.
// ---------------------------------------------------------------------------

/**
 * SCOPED BY OUR OWN TABLE, NOT BY THE PAYLOAD. We enumerate the rows WE hold as
 * live-or-imminent and look each up in the provider's, rather than walking 99
 * scoreboard entries and writing whatever they claim. The blast radius is
 * exactly "games this league already has in flight" and cannot grow if the
 * provider starts returning more.
 */
/**
 * THE LOST-FINAL SWEEP (defect 2).
 *
 * A final only ever fired from transitionsFor(), which needs to SEE the
 * status flip live. The candidate query below selects status IN ('live',
 * 'scheduled') - so once anything else marks a match final (a batch resync,
 * a manual fix, a restart across the whistle) the poller never looks at it
 * again and the final push is lost permanently. On 5 Sep that cost 20707 its
 * ONLY eligible alert: sixteen score events correctly suppressed by
 * final_only, and then nothing.
 *
 * final_seen_at IS THE LEDGER, and it already existed - written whenever the
 * poller does observe a final. A row that is final with no final_seen_at is
 * exactly "went final and we never told anyone", which is the condition this
 * sweeps.
 *
 * SCOPED TO THE SAME WINDOW AS THE POLL, deliberately. Without that bound
 * this would fire for every unseen final in history the first time it ran.
 * A days-old final is not news and must never be pushed - the backfill for
 * those is a one-off stamp of final_seen_at, not a notification.
 *
 * STAMPED EVEN WHEN NOTHING SENDS. An empty audience still means "we have
 * now handled this final", or the sweep retries it every thirty seconds
 * forever.
 */
/**
 * ONE MATCH SHAPE FOR EVERY PUSH, from a poll row (home_abbr / home_short_name
 * / home_name and the away triplet) plus whatever the poll just wrote. Both
 * the score path and the lost-final path build through here, so the team
 * objects that let pushPayload fall back to short_name / name (105 of 243
 * CFB teams have no abbreviation - Florida A&M at Miami, 10 Sep, lost five
 * score pushes to a score path that passed abbreviations only) cannot be
 * dropped from one path again.
 */
export function matchForPush(m, after = {}) {
  return {
    ...m, ...after,
    homeAbbr: m.home_abbr, awayAbbr: m.away_abbr, leagueSlug: m.league_slug,
    home: { abbreviation: m.home_abbr, short_name: m.home_short_name, name: m.home_name },
    away: { abbreviation: m.away_abbr, short_name: m.away_short_name, name: m.away_name },
  };
}

/**
 * IS ANY LOCK SCREEN LISTENING TO THIS GAME? The cheap indexed question
 * (live_activities_live_idx), asked before the expensive one.
 *
 * The rider used to build its state unconditionally because the state was six
 * fields off the row it already had. The live line needs the play feed, which
 * is a read per match per tick, and a Sunday with forty live games and no
 * Activities running must not pay forty table scans for a card nobody has.
 */
async function liveActivityCount(sql, matchId) {
  const [r] = await sql`
    SELECT count(*)::int AS n FROM live_activities
     WHERE match_id = ${Number(matchId)} AND ended_at IS NULL AND revoked_at IS NULL`;
  return r?.n ?? 0;
}

/**
 * THE LIVE LINE FOR ONE MATCH, through the readers the game page uses.
 *
 * The abbreviations come from the poll row itself (m.home_abbr / m.away_abbr),
 * which is where the rider already gets them for the scoreline - no second
 * teams query for three letters this function was handed.
 */
async function laLineFor(sql, m) {
  const plays = await playsFor(m.id);
  return liveLine({
    plays,
    homeTeamId: m.home_team_id,
    teamAbbr: new Map([[m.home_team_id, m.home_abbr], [m.away_team_id, m.away_abbr]]),
  });
}

export async function sweepLostFinals(sql, { league, now = new Date(), dispatchFn, log = () => {} }) {
  const out = { considered: 0, emitted: 0, stamped: 0 };
  const rows = await sql`
    SELECT m.id, m.slug, m.status, m.home_score, m.away_score,
           m.league_id, m.home_team_id, m.away_team_id, m.kickoff_at,
           l.slug AS league_slug,
           h.abbreviation AS home_abbr, a.abbreviation AS away_abbr,
           h.short_name AS home_short_name, a.short_name AS away_short_name,
           h.name AS home_name, a.name AS away_name
      FROM matches m
      JOIN leagues l ON l.id = m.league_id AND l.slug = ${league}
      LEFT JOIN teams h ON h.id = m.home_team_id
      LEFT JOIN teams a ON a.id = m.away_team_id
     WHERE m.status = 'final'
       AND (m.metadata->'detail'->>'final_seen_at') IS NULL
       AND m.kickoff_at BETWEEN ${now.toISOString()}::timestamptz - interval '8 hours'
                            AND ${now.toISOString()}::timestamptz + interval '30 minutes'`;
  out.considered = rows.length;
  for (const m of rows) {
    const match = matchForPush(m);
    try {
      if (dispatchFn) {
        await dispatchFn(sql, {
          match, event: 'final',
          state: { homeScore: m.home_score, awayScore: m.away_score },
        });
        out.emitted += 1;
      }
    } catch (e) {
      log(`[${league}] lost-final dispatch failed match=${m.id}: ${String(e?.message ?? e).slice(0, 100)}`);
    }
    // NESTED MERGE WRITTEN OUT EXPLICITLY - `metadata || jsonb` is a SHALLOW
    // merge and would replace the whole `detail` object, taking every sibling
    // key with it. See CLAUDE.md.
    await sql`
      UPDATE matches
         SET metadata = metadata || jsonb_build_object('detail',
               COALESCE(metadata->'detail', '{}'::jsonb)
                 || jsonb_build_object('final_seen_at', ${new Date().toISOString()}::text))
       WHERE id = ${m.id}`;
    out.stamped += 1;
    log(`[${league}] lost final swept match=${m.id}`);
  }
  return out;
}

export async function pollOnce(sql, {
  league, providerKey, fetcher, normalise, enrich = null, detail = null,
  enrichScheduled = false, futureMinutes = 30,
  now = new Date(), dryRun = false, push = true, log = () => {},
}) {
  const out = {
    league, considered: 0, matched: 0, unmatched: 0, written: 0, detail: 0, lineups: 0, probables: 0,
    scoreChanges: 0, finals: 0, events: 0, calls: 0, unmapped: [],
    latencies: [], wouldWrite: [], pushes: [], pushErrors: [], pushAuthFailure: false,
    liveActivities: [],
  };

  const candidates = await sql`
    SELECT m.id, m.slug, m.status, m.home_score, m.away_score,
           m.league_id, m.home_team_id, m.away_team_id, m.kickoff_at,
           -- THE BEFORE live_state, WHICH THIS QUERY DID NOT SELECT UNTIL NOW.
           -- transitionsFor's quarter rule needs the period we held BEFORE this
           -- poll; without it the call below passed live_state: null every time
           -- and 'quarter' could never fire - not for a Live Activity, and not
           -- for the quarter ALERTS readers have been able to switch on since
           -- the alerts sheet shipped. One column, and the rule works as
           -- written.
           m.metadata->'live_state' AS before_live_state,
           -- THE HELD BATTING ORDERS, so the pre-kick pass can throttle on
           -- their own fetchedAt instead of on a counter in a process's head
           -- that a restart resets.
           m.metadata->'lineups' AS before_lineups,
           m.external_ids->>${providerKey} AS pid,
           -- THE WHOLE OBJECT, not one key: an enrichment may hold a second
           -- provider's id for the same game (MLB's statsapi_game_pk), and a
           -- per-league column in a shared query is how that gets forgotten.
           m.external_ids AS external_ids,
           l.slug AS league_slug,
           h.abbreviation AS home_abbr, a.abbreviation AS away_abbr,
           -- THE FALLBACK CHAIN NEEDS MORE THAN THE ABBR COLUMN (defect 1).
           -- 105 of 243 CFB teams have no abbreviation - see
           -- lib/live/teamAbbr.js for the order these are tried in.
           h.short_name AS home_short_name, a.short_name AS away_short_name,
           h.name AS home_name, a.name AS away_name,
           (m.metadata->'detail'->>'final_seen_at') AS final_seen_at
      FROM matches m
      JOIN leagues l ON l.id = m.league_id AND l.slug = ${league}
      LEFT JOIN teams h ON h.id = m.home_team_id
      LEFT JOIN teams a ON a.id = m.away_team_id
     WHERE m.status IN ('live', 'scheduled')
       -- THIRTY MINUTES AHEAD WAS THE WHOLE FUTURE, and it made lineupDue's
       -- four-hour window unreachable: a batting order goes up two or three
       -- hours before first pitch, and no game that far out was ever a
       -- CANDIDATE, so the pre-kick pass could only ever see games about to
       -- start. Caught by a game two hours away whose metadata.lineups was
       -- still null an hour after the pass shipped.
       --
       -- IT IS PER LEAGUE AND DEFAULTS TO THE OLD VALUE. Both football leagues
       -- keep their 30 minutes exactly - widening their blast radius to buy
       -- baseball a lineup would be a trade nobody asked for.
       AND m.kickoff_at BETWEEN ${now.toISOString()}::timestamptz - interval '8 hours'
                            AND ${now.toISOString()}::timestamptz
                                + make_interval(mins => ${Number(futureMinutes) || 30})`;
  out.considered = candidates.length;
  if (!candidates.length) return out;

  const fetchedAt = Date.now();
  const { rows, calls } = await fetcher();
  out.calls = calls ?? 1;
  const byId = new Map((rows ?? []).map((r) => [String(r?.id), r]));

  const events = [];
  for (const m of candidates) {
    const row = m.pid == null ? null : byId.get(String(m.pid));
    if (!row) { out.unmatched += 1; continue; }
    out.matched += 1;
    // THE ENRICHMENT IS PER LEAGUE AND PER LIVE GAME, and it is awaited only
    // for a row the provider already calls live. A league without one - both
    // football leagues - never enters this branch and its loop is unchanged.
    //
    // ONE EXTRA CALL PER LIVE GAME, NOT PER CANDIDATE. `candidates` includes
    // games that have not started; asking /plays about a scheduled game would
    // spend a call to be told there are none.
    let extra = null;
    const liveRow = String(row?.status_state ?? '') === 'in_progress';
    if (enrich && (liveRow || enrichScheduled)) {
      // THE CANDIDATE GOES WITH THE ROW. An enrichment may need to know which
      // of OUR games this is - the MLB one does, to find the same game in a
      // second provider whose ids we do not hold - and handing it `m` is what
      // keeps that lookup out of this loop.
      //
      // A SCHEDULED ROW IS ENRICHED ONLY WHERE THE LEAGUE ASKED FOR IT. MLB
      // does, for one reason: the posted batting order is the whole pool of
      // bats both October and The Run offer, and it goes up BEFORE first pitch.
      // An enrichment that only ran on live games could never see it while it
      // still mattered.
      extra = await enrich(row, m, sql, { log, live: liveRow, now });
      if (extra?.calls) out.calls += extra.calls;
    }

    // THE BATTING ORDERS ARE WRITTEN BEFORE THE SCORELINE AND INDEPENDENTLY OF
    // IT. writeLive returns null when nothing about the score changed - which
    // is every pre-kick poll - so a lineup write hung off its result would
    // never land on the one kind of row that has a lineup and no score.
    if (extra?.lineups && !dryRun) {
      try {
        if (await writeMlbLineups(sql, m.id, extra.lineups, { at: now })) out.lineups += 1;
      } catch (e) { log(`[${league}] lineup write failed match=${m.id}: ${e.message}`); }
    }
    // THE PROBABLES, on the same pass and the same reasoning: a pre-kick row
    // writes its starters whether or not its score moved. Its own writer and
    // its own top-level key, so it cannot touch the lineups beside it.
    if (extra?.probables && !dryRun) {
      try {
        if (await writeMlbProbables(sql, m.id, extra.probables)) out.probables += 1;
      } catch (e) { log(`[${league}] probables write failed match=${m.id}: ${e.message}`); }
    }
    const raw = normalise(row, out.unmapped, extra);
    // AN UNREADABLE STATUS WRITES NOTHING AT ALL. Not the score either: a
    // status we cannot map is not evidence that anything else on the row is
    // safe to believe.
    if (raw.status == null) continue;
    const upd = scopeToStatus(raw);

    if (dryRun) {
      out.wouldWrite.push({
        slug: m.slug, from: m.status, to: upd.status,
        score: `${m.away_score ?? '-'}-${m.home_score ?? '-'} -> ${upd.awayScore ?? '-'}-${upd.homeScore ?? '-'}`,
        liveState: upd.liveState,
      });
      continue;
    }

    const after = await writeLive(sql, m.id, upd);
    if (!after) continue;
    out.written += 1;

    // THE SECOND WRITER, and it is second on purpose. writeLive owns status,
    // the scores and live_state and is forbidden the rest (lib/live/write.js);
    // the line score and the scoring summary are ON the row we already hold,
    // so refusing to write them here would mean fetching the identical row a
    // second time from a second job. lib/mlb/detail.js is that writer: its own
    // statement, its own keys, and it cannot touch a score.
    //
    // ITS FAILURE IS CONTAINED, like the push rider's below. A missing line
    // score is a thinner card; losing the scoreline the board depends on to
    // get one is not a trade worth making.
    if (detail) {
      try {
        const d = detail(row);
        if (d && await writeMlbDetail(sql, m.id, d)) out.detail += 1;
      } catch (e) { log(`[${league}] detail write failed match=${m.id}: ${e.message}`); }
    }
    if (after.status === 'final' && m.status !== 'final') out.finals += 1;

    // THE PUSH RIDER. It is handed the transition this poll just made and asks
    // no provider anything - the loop that noticed is the loop that sends,
    // which is the whole reason an alert can be a minute old instead of five.
    //
    // ITS FAILURE IS CONTAINED. A notification is a courtesy on top of a
    // scoreboard; losing one must never cost the write that the board, the
    // Wire and the settle all depend on.
    if (!dryRun && push) {
      const evs = transitionsFor(
        { ...m, live_state: m.before_live_state ?? null },
        { ...after, live_state: upd.liveState },
      );
      for (const t of evs) {
        try {
          // pushPayload() (lib/push/payload.js) destructures camelCase
          // homeAbbr/awayAbbr/leagueSlug - the query above selects them
          // snake_case (home_abbr/away_abbr/league_slug, the naming every
          // other column in this file uses). Without this mapping every
          // real dispatch() call hit pushPayload()'s `if (!homeAbbr ||
          // !awayAbbr || !leagueSlug...) return null` guard and bailed
          // before ever reaching the per-device send loop - silently, with
          // no log line, no error, and no push_sends row - independent of
          // and on top of the audienceFor() bug fixed alongside this one.
          const match = matchForPush(m, after);
          // ONE TOUCHDOWN, ONE NOTIFICATION (lib/push/scoreFold.js). A score
          // may HOLD here rather than send - for at most ninety seconds, and
          // only a bare six with no play row to read. Everything else, and
          // every other event, goes straight through.
          //
          // ANYTHING THAT IS NOT A SCORE FLUSHES THE HOLD FIRST. A reader must
          // never be told the game ended and then told about a touchdown from
          // before the whistle.
          const sendOne = async (event, state) => {
            const r = await dispatch(sql, { match, event, state, log });
            out.pushes.push({ event, sent: r.sent, skipped: r.skipped, failed: r.failed });
            if (r.authFailure) out.pushAuthFailure = true;
          };

          if (t.event !== 'score') {
            for (const side of ['home', 'away']) {
              const k = `${m.id}:${side}`;
              const held0 = pendingScore.get(k) ?? null;
              // THE LOOKUP IS RE-RUN WHEN THE HOLD RESOLVES, not only when it
              // started. A held six usually has no play row yet - the plays
              // cron writes every ~120s against a 30s score poller - so the
              // scorer very often arrives during the hold.
              const freshPlay = held0
                ? await scoringPlayFor(sql, m.id, { homeScore: held0.state?.homeScore, awayScore: held0.state?.awayScore }).catch(() => null)
                : null;
              const { pending: p2, emit: held } = flushFold(held0, { play: freshPlay });
              if (p2) pendingScore.set(k, p2); else pendingScore.delete(k);
              for (const e of held) {
                const abbr = side === 'home' ? m.home_abbr : m.away_abbr;
                await sendOne('score', {
                  ...e.state,
                  scoreKind: e.kind ? `${abbr} ${e.kind}` : null,
                  scorer: e.scorer ?? null,
                  credit: e.credit ?? null,
                });
              }
            }
            await sendOne(t.event, { ...t.state, scoreKind: null, scorer: null });
            continue;
          }

          const { homeDelta, awayDelta } = t.state;
          const team = homeDelta && !awayDelta ? 'home' : (!homeDelta && awayDelta ? 'away' : null);
          const delta = team === 'home' ? homeDelta : team === 'away' ? awayDelta : null;
          if (!team || !delta) {
            // TWO TEAMS IN ONE POLL HAS NO SINGLE HONEST KIND TO NAME, and no
            // single team to fold against either. It goes as it always did.
            await sendOne('score', { ...t.state, scoreKind: null, scorer: null });
            continue;
          }

          const key = `${m.id}:${team}`;
          const teamAbbr = team === 'home' ? m.home_abbr : m.away_abbr;
          // THE ENRICHMENT, NEVER THE DEPENDENCY. A null here - the play row
          // has not landed, or the lookup threw - costs the scorer's name and
          // nothing else.
          const play = await scoringPlayFor(sql, m.id, { homeScore: after.home_score, awayScore: after.away_score });
          const { pending: nextPending, emit } = onScore(
            pendingScore.get(key) ?? null,
            { delta, state: t.state, play, now: Date.now() },
          );
          // THE MATCH RIDES THE HOLD. The timeout sweep below runs outside
          // this loop and has no other way back to the row it must send about.
          if (nextPending) pendingScore.set(key, { ...nextPending, match, teamAbbr });
          else pendingScore.delete(key);
          for (const e of emit) {
            // .endsWith, not ===, because the stored value is the full
            // "TEAM touchdown" prefix, not the bare kind word.
            const priorWasTouchdown = Boolean(lastScoreKind.get(key)?.endsWith('touchdown'));
            // THE PLAY WINS WHERE IT SPOKE; the delta keeps the floor. The
            // fallback is only ever reached when no play row named the kind,
            // which is also the only path that leaves e.folded false.
            const scoreKind = e.kind
              ? `${teamAbbr} ${e.kind}`
              : scoreKindLabel(delta, { priorWasTouchdown, teamAbbr });
            if (scoreKind) lastScoreKind.set(key, scoreKind);
            await sendOne('score', { ...e.state, scoreKind, scorer: e.scorer ?? null, credit: e.credit ?? null });
          }
        } catch (e) { out.pushErrors.push(String(e?.message ?? e).slice(0, 120)); }
      }

      // ---- THE LIVE ACTIVITY RIDER (relay 4) -----------------------------
      // ONE PUSH PER POLL AT MOST, on the transitions the Part C ruling names.
      // It rides the SAME transition list the alerts ride rather than asking
      // the row a second question, so "worth a push" has one definition.
      //
      // THE CONTENT STATE COMES FROM THE AFTER ROW, NOT FROM THE EVENT. The
      // quarter event deliberately carries the period the game LEFT
      // (lib/push/transitions.js sets state.period to the before value, so an
      // alert can say "End of Q1"), and a card built from that would show Q1
      // at the moment the game entered Q2 - and would look right in any test
      // that only checks a push went out. The event decides WHETHER to push;
      // the row decides WHAT.
      //
      // ITS FAILURE IS CONTAINED, like the alert rider above it: a lock-screen
      // card is a courtesy on top of a scoreboard, and losing one must never
      // cost the write the board, the Wire and the settle depend on.
      // THE TRIGGER IS THE CARD'S OWN CONTENT NOW (LIVE ACTIVITY - THE LIVE
      // LINE relay), not the alert transitions. A card carrying possession,
      // the down and the last play goes stale on a play that scores nothing
      // and ends no quarter - which is most plays - so "worth a push" is no
      // longer "worth an alert". It fires on a change to the PERIOD, the
      // CLOCK, the SCORE or the LAST PLAY.
      //
      // THE FINAL STILL WINS AND STILL ENDS. activityEventFor keeps that
      // ruling: a poll that sees the last score and the whistle together
      // sends one 'end' carrying the final score.
      //
      // COALESCED TO ONE PUSH PER ACTIVITY PER TICK, structurally: this rider
      // runs once per match per tick and pushLiveActivities sends one push per
      // Activity. Five changes inside one tick are one push of the state as it
      // stands at the end of it, which is also the only state worth showing.
      //
      // THE PLAYS ARE READ ONLY WHEN SOMETHING IS LISTENING. playsFor() is a
      // table scan per match; a live Sunday with no Activities running must
      // not pay for it, so the count comes first and it is the cheap indexed
      // one.
      const laFinal = activityEventFor(evs) === 'end';
      const laListeners = await liveActivityCount(sql, m.id).catch(() => 0);
      let laEvent = null;
      let laState = null;
      if (laListeners > 0) {
        const line = await laLineFor(sql, m).catch(() => ({ possession: '', situation: '', lastPlay: '' }));
        laState = stateFromMatch({
          // ALL THREE SOURCES, because the candidate row has all three and
          // abbrOf resolves in order. Passing the abbreviation alone made the
          // card disagree with the same game's Scores row.
          away: { abbreviation: m.away_abbr, short_name: m.away_short_name, name: m.away_name },
          home: { abbreviation: m.home_abbr, short_name: m.home_short_name, name: m.home_name },
          awayScore: after.away_score,
          homeScore: after.home_score,
          liveState: upd.liveState,
          // THE TENTH FIELD, off the candidate row this rider already holds.
          // It never changes, so it is deliberately absent from the trigger
          // key below - a card does not move because its kickoff is still
          // the same kickoff.
          kickoffAt: m.kickoff_at,
        }, line);
        // THE KEY IS EXACTLY THE FOUR THE RELAY NAMES. possession and
        // situation ride along on the card but do not trigger it: they cannot
        // change without the snap changing, and making them triggers would
        // spend a push on a card that reads identically.
        //
        // NOW IN TWO HALVES (LA-CADENCE). NEWS is the score and the period and
        // goes out at once; TEXTURE is the clock and the last play and waits
        // for the window. Both are still compared against what the card
        // already says, so nothing pushes on a line that has not moved.
        const news = [laState.period, laState.awayScore, laState.homeScore].join('\u0001');
        const full = [news, laState.clock, laState.lastPlay].join('\u0001');
        const prev = lastLaLine.get(m.id);
        // THE TICK'S OWN CLOCK, not Date.now(). pollOnce already takes `now`
        // and every other time-sensitive branch in this function reads it, so
        // the window is measured against the same instant the rest of the poll
        // is - and a test can drive two minutes without waiting two minutes.
        const nowMs = new Date(now).getTime();
        if (laFinal) {
          // A FINAL PUSHES IMMEDIATELY AND ALWAYS. It is the last thing the
          // card will ever say and the event that ends it; a window that could
          // delay it would leave a dead card on a lock screen for two minutes.
          laEvent = 'end';
        } else if (!prev) {
          // FIRST SIGHT OF THIS MATCH - after a restart, or the first tick a
          // card exists. One push to sync the card is the documented cost.
          //
          // AND IT OPENS THE TEXTURE WINDOW. This push carried the clock and
          // the last play, so the card is current; without starting the window
          // here the very next snap would push again seconds later, which is
          // the burst the window exists to stop.
          laEvent = 'update';
          lastLaPushAt.set(m.id, nowMs);
        } else if (prev.news !== news) {
          laEvent = 'update';
        } else if (prev.full !== full && nowMs - (lastLaPushAt.get(m.id) ?? 0) >= LA_COALESCE_MS) {
          // TEXTURE, AND THE WINDOW HAS ELAPSED. laState is read fresh every
          // tick, so this carries the LATEST line - not the one that first
          // went stale.
          laEvent = 'update';
          lastLaPushAt.set(m.id, nowMs);
        }
        // THE WINDOW IS NOT RESET BY NEWS, deliberately: a score 30 seconds in
        // must not buy the next two minutes of silence from the clock. Only the
        // branch above touches lastLaPushAt.
        //
        // BUT THE CARD'S REMEMBERED LINE IS UPDATED BY ANY PUSH, because any
        // push carries the whole state - the card now says all of it, and
        // leaving `full` stale would fire a redundant texture push the moment
        // the window opened.
        if (laEvent) lastLaLine.set(m.id, { news, full });
        if (laFinal) { lastLaLine.delete(m.id); lastLaPushAt.delete(m.id); }
      }
      if (laEvent) {
        try {
          const r = await pushLiveActivities(sql, {
            matchId: m.id,
            event: laEvent,
            state: laState,
            log,
          });
          // A MATCH WITH NO ACTIVITIES IS NOT LEDGER-WORTHY. Until relay 5
          // nothing auto-starts one, so most games have none and a row per
          // poll would bury the polls that did something.
          if (r.activities) {
            // THE HOURLY COUNT RIDES THE SAME LINE. Recorded from the ids that
            // were actually SENT, so a failed push is not counted as one the
            // card received.
            r.perHour = recordLaPushes(r.sentIds, new Date(now).getTime());
            out.liveActivities.push(r);
          }
        } catch (e) {
          out.pushErrors.push(`liveActivity: ${String(e?.message ?? e).slice(0, 100)}`);
        }
      }
    }

    // AN EVENT ONLY FOR A GAME BEING PLAYED. A final has its own emitter, and a
    // scheduled game has no score to report.
    if (upd.status === 'live' && scoreChanged(m, after)) {
      out.scoreChanges += 1;
      // THE LATENCY INSTRUMENT. Neither provider sends an observation
      // timestamp - measured, both payloads - so what is recorded is the gap we
      // can actually see: the moment the fetch returned to the moment the write
      // landed. Thursday's report can then state a real number for OUR half and
      // say plainly that the provider's half is unmeasurable from here, rather
      // than quoting the poll interval and calling it latency.
      out.latencies.push({ matchId: m.id, ourMs: Date.now() - fetchedAt });
      const ev = toScoreRow({ ...m, ...{
        home_score: after.home_score, away_score: after.away_score,
        seen_at: new Date().toISOString(),
      } }, upd.liveState);
      if (ev) events.push(ev);
    }
  }

  // ---- THE HOLD SWEEP ------------------------------------------------------
  // A touchdown held for its try goes out on its own once the window closes -
  // which is also exactly what a MISSED extra point looks like from here, and
  // a six is the right number for one. This runs every poll, including polls
  // where the held match did not change, because otherwise a game that goes
  // quiet after a touchdown would sit on it until the next score.
  if (!dryRun && push) {
    for (const [k, p] of [...pendingScore]) {
      // ONE LOOKUP PER DUE HOLD, and only when it is actually due - a hold
      // still inside its window costs no query.
      const due0 = Date.now() - p.at >= FOLD_WINDOW_MS;
      const freshPlay = due0
        ? await scoringPlayFor(sql, p.match?.id ?? null, { homeScore: p.state?.homeScore, awayScore: p.state?.awayScore }).catch(() => null)
        : null;
      const { pending: still, emit: due } = onTick(p, { now: Date.now(), play: freshPlay });
      if (still) pendingScore.set(k, still); else pendingScore.delete(k);
      for (const e of due) {
        try {
          const r = await dispatch(sql, {
            match: p.match,
            event: 'score',
            state: {
              ...e.state,
              scoreKind: e.kind ? `${p.teamAbbr} ${e.kind}` : null,
              scorer: e.scorer ?? null,
              credit: e.credit ?? null,
            },
            log,
          });
          out.pushes.push({ event: 'score', sent: r.sent, skipped: r.skipped, failed: r.failed, foldTimeout: true });
          if (r.authFailure) out.pushAuthFailure = true;
        } catch (e2) { out.pushErrors.push(String(e2?.message ?? e2).slice(0, 120)); }
      }
    }
  }

  if (events.length) {
    // ONE EVENT PER SCORE STATE, EVER - the dedupe_hash is the match and the
    // two scores, so a poll that sees the same scoreline again writes nothing.
    const ins = await emit(events);
    out.events = Array.isArray(ins) ? ins.length : (ins?.length ?? 0);
  }
  out.unmapped = [...new Set(out.unmapped)];
  return out;
}
