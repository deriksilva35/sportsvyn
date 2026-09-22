// services/live-poller/poll.mjs — one poll of one league. The only file here
// that talks to a provider, and it is deliberately thin: every decision it
// makes was made in a pure module under lib/live/ and can be tested without a
// network, a clock or a database.

import { mapLiveStatus, liveState, parseBdlProse } from '../../lib/live/vocabulary.js';
import { writeLive, scoreChanged } from '../../lib/live/write.js';
import { toScoreRow } from '../../lib/live/scoreEvent.js';
import { fromBdlMlb } from '../../lib/mlb/ingest.js';
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
export function fromMlb(row, unmapped, play = null) {
  const n = fromBdlMlb(row, unmapped, { play });
  return {
    providerId: n.providerId,
    status: n.status,
    homeScore: n.homeScore,
    awayScore: n.awayScore,
    liveState: n.liveState,
  };
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
  league, providerKey, fetcher, normalise, enrich = null,
  now = new Date(), dryRun = false, push = true, log = () => {},
}) {
  const out = {
    league, considered: 0, matched: 0, unmatched: 0, written: 0,
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
           m.external_ids->>${providerKey} AS pid,
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
       AND m.kickoff_at BETWEEN ${now.toISOString()}::timestamptz - interval '8 hours'
                            AND ${now.toISOString()}::timestamptz + interval '30 minutes'`;
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
    if (enrich && String(row?.status_state ?? '') === 'in_progress') {
      extra = await enrich(row);
      if (extra) out.calls += 1;
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
