// lib/fantasy/movement.js — the ADP movement board's read layer.
//
// PURE FUNCTIONS + ONE QUERY. Everything that decides a number lives in a pure
// function taking a per-player series; the query only fetches rows and hands
// them over. That split is what lets the sign convention, the gates and the band
// boundaries be pinned by tests with no database.
//
// ============================ THE SIGN CONVENTION ===========================
// POSITIVE MEANS RISING. A positive delta means the ADP NUMBER WENT DOWN, i.e.
// the player is being drafted EARLIER than he was.
//
//     delta = older_adp - newer_adp
//
// So a player who went from ADP 26.7 to 18.2 has d7 = +8.5 and is rising. This
// is the single easiest thing in the whole board to silently flip - inverting it
// turns every riser into a faller and nothing crashes - so it is stated here,
// used in exactly one helper below, and pinned by a test.
//
// ================================== THE EPOCH ===============================
// Movement math starts at ADP_EPOCH. The 2026-07-20 snapshot predates the cron
// and sits across a 10-day gap, so using it as a baseline would report a
// fortnight of drift as if it were a week's and poison open/lo/hi/deltas for
// every player. The rows are NOT deleted - they are simply not movement input.
// "Open" is a player's first snapshot AT OR AFTER the epoch.
//
// ================================== THE GATES ===============================
// Every column that needs history gates INDEPENDENTLY, on the number of
// post-epoch snapshots THAT PLAYER actually has - never on calendar arithmetic,
// and never on the pool-wide count. A player who first appeared two snapshots
// ago has a d1 and nothing else, even when the pool has fifteen.
//
// A gated column is NULL, which the UI renders as an em-dash. It is never an
// estimate, an extrapolation, or a zero.

// lib/db.js is imported LAZILY inside getMovementBoard, not at module scope: it
// throws without DATABASE_URL, and every function above the query is pure and
// must stay importable in a unit test with no database configured.

// The first snapshot the cron wrote. Everything before it is excluded from
// movement math by every function in this module.
export const ADP_EPOCH = '2026-07-30';

// Snapshots required before a column is trustworthy. d3 compares against three
// snapshots back, so it needs four points; d7 needs eight. Drift needs enough
// history that a five-long streak is a finding rather than the arithmetic
// ceiling - with fewer than eight points, "longest streak" just means "every
// snapshot we have".
export const MIN_D1_HISTORY = 2;
export const MIN_D3_HISTORY = 4;
export const MIN_D7_HISTORY = 8;
export const MIN_DRIFT_HISTORY = 8;

// Consecutive snapshots in one direction before persistence earns a band.
// Taken from the locked mock (const STREAK = 5).
export const STREAK = 5;

// FFC draft appearances required before a player's movement is read as SIGNAL.
// Below this the numbers still render - they are real observations - but no band
// is assigned, and the player is excluded from the hero counts, the movers-only
// filter and the top risers/fallers. At the floor of the pool a player's ADP is
// computed from single-digit drafts, so a 13-pick "move" is sampling noise
// wearing the costume of a market move.
//
// Same doctrine as the history gates and the Sportsvyn 250 gate: a thin sample
// is SHOWN but never READ. We do not hide the number and we do not dress it up.
export const BAND_MIN_DRAFTS = 50;

// FFC publishes exactly one league size per scoring format. Format selection
// therefore implies size - there is no size selector, because there is no data
// behind one. Band thresholds are round-based against the format's OWN size.
export const FORMAT_SIZES = Object.freeze({
  ppr: 12,
  'half-ppr': 10,
  standard: 8,
  '2qb': 12,
});

export const FORMATS = Object.freeze(Object.keys(FORMAT_SIZES));

export function sizeForFormat(format) {
  return FORMAT_SIZES[format] ?? null;
}

/**
 * THE sign convention, in one place. positive = the ADP number fell = rising.
 */
export function delta(olderAdp, newerAdp) {
  if (olderAdp == null || newerAdp == null) return null;
  return round1(Number(olderAdp) - Number(newerAdp));
}

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * PURE. The trailing run of same-direction moves, signed.
 *
 * Positive = the player has been rising for N consecutive snapshots. Walks back
 * from the newest delta and stops at the first move the other way, or at a flat
 * snapshot - a day with no movement breaks a streak, which is what makes "six
 * mornings running" a claim about persistence rather than about rounding.
 *
 * `series` is ascending by snapshot date.
 */
export function driftFromSeries(series) {
  if (!Array.isArray(series) || series.length < 2) return null;
  let run = 0;
  let dir = 0;
  for (let i = series.length - 1; i > 0; i--) {
    const d = delta(series[i - 1].adp, series[i].adp);
    const step = d > 0 ? 1 : d < 0 ? -1 : 0;
    if (step === 0) break;
    if (dir === 0) dir = step;
    else if (step !== dir) break;
    run += 1;
  }
  return run === 0 ? 0 : run * dir;
}

/**
 * PURE. Everything the board needs from one player's post-epoch series.
 *
 * `series` must be ascending by snapshot date and ALREADY epoch-filtered -
 * filtering is the caller's job so this stays a pure function of what it is
 * given (and so a test can hand it a series that straddles the epoch and prove
 * the caller dropped the right rows).
 *
 * Each column is null when this player lacks the snapshots for it.
 */
export function movementFromSeries(series) {
  const s = Array.isArray(series) ? series : [];
  const n = s.length;
  if (n === 0) {
    return {
      adp: null, open: null, d1: null, d3: null, d7: null, drift: null,
      lo: null, hi: null, snapshots: 0,
    };
  }
  const latest = Number(s[n - 1].adp);
  const at = (back) => (n > back ? Number(s[n - 1 - back].adp) : null);
  const adps = s.map((r) => Number(r.adp));

  return {
    adp: round1(latest),
    // Open is the first post-epoch observation, which is a fact about this
    // player's history and survives every gate.
    open: round1(Number(s[0].adp)),
    d1: n >= MIN_D1_HISTORY ? delta(at(1), latest) : null,
    d3: n >= MIN_D3_HISTORY ? delta(at(3), latest) : null,
    d7: n >= MIN_D7_HISTORY ? delta(at(7), latest) : null,
    drift: n >= MIN_DRIFT_HISTORY ? driftFromSeries(s) : null,
    // lo/hi are the min/max ADP the player has actually held since the epoch.
    // NOT sim_player_pool.adp_low / adp_high - those are FFC's within-window
    // pick extremes for a single snapshot and mean something else entirely.
    lo: n >= MIN_D3_HISTORY ? round1(Math.min(...adps)) : null,
    hi: n >= MIN_D3_HISTORY ? round1(Math.max(...adps)) : null,
    snapshots: n,
  };
}

/**
 * PURE. Band assignment, transcribed from the locked mock's band().
 *
 *   sample floor: times_drafted < BAND_MIN_DRAFTS -> no band at all
 *   magnitude: |d3| >= size/2  ->  Steam / Sliding
 *   persistence: |drift| >= STREAK, agreeing in sign with d3  ->  Climbing / Fading
 *   otherwise Quiet; d3 unavailable -> no band at all
 *
 * WHEN DRIFT IS GATED THIS DEGRADES TO MAGNITUDE-ONLY, which is the required
 * behaviour and falls out naturally: a null drift satisfies neither persistence
 * branch, so a player can still be Steam, Sliding or Quiet but never Climbing or
 * Fading. The null checks are explicit rather than leaning on null >= 5 being
 * false, because that is a coincidence of JS and not an intention.
 */
export function bandFor({ d3, drift, size, timesDrafted }) {
  // The sample floor is checked FIRST. A thin-sample player can post a +13 d3
  // and it must not become a Steam chip on the strength of eight drafts.
  if (timesDrafted == null || timesDrafted < BAND_MIN_DRAFTS) return { key: 'none', label: '—' };
  if (d3 == null) return { key: 'none', label: '—' };
  const big = size / 2;
  if (d3 >= big) return { key: 'steam', label: 'Steam' };
  if (d3 <= -big) return { key: 'sliding', label: 'Sliding' };
  if (drift != null && drift >= STREAK && d3 > 0) return { key: 'warming', label: 'Climbing' };
  if (drift != null && drift <= -STREAK && d3 < 0) return { key: 'cooling', label: 'Fading' };
  return { key: 'quiet', label: 'Quiet' };
}

/**
 * PURE. Group flat pool rows into per-player ascending series, dropping
 * everything before the epoch. Exported so a test can prove the epoch row never
 * reaches the math.
 */
export function seriesByPlayer(rows, epoch = ADP_EPOCH) {
  const byPlayer = new Map();
  for (const r of rows) {
    const d = asDate(r.snapshot_date);
    if (d < epoch) continue;                       // (B) epoch exclusion
    const key = r.ffc_player_id;
    if (!byPlayer.has(key)) {
      byPlayer.set(key, {
        ffcPlayerId: key,
        name: r.name,
        position: r.position,
        team: r.team,
        matchedPlayerId: r.matched_player_id ?? null,
        timesDrafted: r.times_drafted == null ? null : Number(r.times_drafted),
        series: [],
        _newest: null,
        _byDate: new Map(),
      });
    }
    const p = byPlayer.get(key);
    // ONE POINT PER DATE, enforced here rather than trusted from the query.
    // sim_player_pool's natural key includes (scoring_format, teams_count), so a
    // read that pins both can only ever yield one row per player per date - but
    // a read that pins only the format yields FOUR, and they would land here as
    // four "snapshots" on the same morning. That is worse than a wrong number:
    // it inflates the history count and ungates d3 on a player who has one day
    // of data, using deltas taken between a 2QB ADP and a standard ADP. The
    // query is scoped correctly today; this makes the corruption impossible
    // rather than merely unlikely, and duplicate dates are never legitimate.
    const seen = p._byDate.get(d);
    if (seen) { seen.adp = Number(r.adp); } else {
      const pt = { date: d, adp: Number(r.adp) };
      p._byDate.set(d, pt);
      p.series.push(pt);
    }
    // The NEWEST row wins for the descriptive fields - a player who changes team
    // mid-window should read as his current team. Compared by DATE, not by input
    // order: this function is pure and must not quietly depend on the caller
    // having sorted, even though the query does.
    if (p._newest == null || d > p._newest) {
      p._newest = d;
      p.name = r.name; p.position = r.position; p.team = r.team;
      p.matchedPlayerId = r.matched_player_id ?? p.matchedPlayerId;
      if (r.times_drafted != null) p.timesDrafted = Number(r.times_drafted);
    }
  }
  for (const p of byPlayer.values()) {
    p.series.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    delete p._newest;
    delete p._byDate;
  }
  return byPlayer;
}

const asDate = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

/**
 * THE QUERY. One statement, then pure functions.
 *
 * Reads only sim_player_pool. It deliberately does NOT join draft_picks or
 * anything else: the pool holds one row per player PER SNAPSHOT PER FORMAT, so
 * any join through it multiplies. Sportsvyn ADP is a separate read keyed on
 * matched player identity (item 3).
 */
export async function getMovementBoard(format, opts = {}) {
  const size = sizeForFormat(format);
  if (size == null) throw new Error(`unknown scoring format: ${format}`);
  const epoch = opts.epoch ?? ADP_EPOCH;
  const db = opts.sql ?? (await import('../db.js')).sql;

  // NFL ONLY. A college row's `adp` is a DERIVED PLACEMENT, not a price - it is
  // the row's rank on the college board, so it shifts whenever that board
  // reorders. Movement would read those shifts as ADP moves and mix them into a
  // list of NFL ones, on a scale (10000+) that shares nothing with the NFL
  // numbers beside it. The college price that COULD move is ncaaf_adp, and
  // measuring it is a separate question from this module's.
  //
  // (This query is still unscoped by SOURCE - it mixes ffc and fantrax rows,
  // which predates the college board and is queued separately. Not widened here.)
  const rows = await db`
    SELECT ffc_player_id, name, position, team, adp, times_drafted,
           matched_player_id, snapshot_date
      FROM sim_player_pool
     WHERE scoring_format = ${format}
       AND teams_count = ${size}
       AND snapshot_date >= ${epoch}::date
       AND league = 'nfl'
     ORDER BY ffc_player_id, snapshot_date`;

  // Epoch-filtered in JS as well as in the SQL. The query already excludes
  // pre-epoch rows, but this module must not depend on the caller having done
  // it - the same reason seriesByPlayer sorts by date rather than trusting
  // ORDER BY. Otherwise the snapshot count, the gates and `latest` all silently
  // describe a window the movement math never used.
  const snapshotDates = [...new Set(
    rows.map((r) => asDate(r.snapshot_date)).filter((d) => d >= epoch),
  )].sort();
  const latest = snapshotDates[snapshotDates.length - 1] ?? null;

  const players = [];
  for (const p of seriesByPlayer(rows, epoch).values()) {
    // RESTRICT TO THE LATEST SNAPSHOT. A player FFC has dropped has no current
    // ADP, and rendering his last-seen value in a column labelled ADP is
    // inference. His history stays in the spine untouched, so if FFC re-adds him
    // his movement resumes from the record rather than starting over.
    if (latest != null && !p.series.some((x) => x.date === latest)) continue;
    const m = movementFromSeries(p.series);
    const band = bandFor({ d3: m.d3, drift: m.drift, size, timesDrafted: p.timesDrafted });
    players.push({
      ffcPlayerId: p.ffcPlayerId,
      name: p.name,
      position: p.position,
      team: p.team,
      matchedPlayerId: p.matchedPlayerId,
      timesDrafted: p.timesDrafted,
      ...m,
      band,
      // Whether this player's movement may be READ as signal: drives the hero
      // counts, the movers-only filter and the risers/fallers lists. False for a
      // thin sample or a missing d3 - the row still renders, it just does not
      // get to speak.
      bandEligible: band.key !== 'none',
    });
  }
  players.sort((a, b) => (a.adp ?? Infinity) - (b.adp ?? Infinity));

  return {
    format,
    size,
    epoch,
    players,
    snapshotDates,
    snapshotCount: snapshotDates.length,
    latestSnapshot: snapshotDates[snapshotDates.length - 1] ?? null,
    // What the UI needs to decide which columns to render at all. Pool-wide, so
    // a header can say "7d needs 8 snapshots, we have 5" - but per-player gating
    // still governs each individual cell.
    gates: {
      d1: snapshotDates.length >= MIN_D1_HISTORY,
      d3: snapshotDates.length >= MIN_D3_HISTORY,
      d7: snapshotDates.length >= MIN_D7_HISTORY,
      drift: snapshotDates.length >= MIN_DRIFT_HISTORY,
    },
  };
}

// ===========================================================================
// SPORTSVYN ADP — where OUR drafters take a player
// ===========================================================================
//
// THE JOIN, and why it is what it is:
//
//   draft_picks.ffc_player_id  ->  the pool's ffc_player_id
//
// draft_picks carries ffc_player_id directly, so the two sides meet on the
// SAME player identity the pool uses, with no third table in between.
//
// IT DOES NOT TOUCH sim_player_pool, deliberately. The pool holds one row per
// player PER SNAPSHOT PER FORMAT - today that is six snapshots x four formats -
// so joining picks through it would multiply every pick by however many pool
// rows that player has and inflate both the count and the average. The board
// merges the two results in JS, keyed on ffc_player_id, after each has been
// aggregated independently.
//
// CORPUS: completed drafts, mode <> 'tracker', and picked_by = 'user'.
//
// THE picked_by FILTER IS WHAT MAKES THE CLAIM TRUE. The column says "where our
// own drafters take a player". Without the filter it measured the ENGINE: of the
// 900 qualifying picks in the corpus, 886 were picked_by='ai'. The engine drafts
// against market ADP by construction, so including its picks would drive
// divergence toward zero and turn the column into a measure of our own AI
// echoing the market back at us. The methodology copy stands as written
// precisely because the filter makes it accurate.
//
// A tracker draft is excluded for the same reason in reverse: it is a log of
// someone else's real draft at a real table, so those picks are strangers'
// choices, not our drafters'.
//
// 25 USER appearances, not 250. 250 was calibrated against an imagined corpus;
// once the corpus is human picks only, the gate's job is noise control and 25
// independent human selections is a real cluster rather than a coin-flip. Named
// here, stated in the methodology copy, and never tuned afterwards - a threshold
// that moves to produce a nicer-looking board is not a threshold.
export const SV_MIN_DRAFTS = 25;

/**
 * Sportsvyn ADP per player. Returns a Map keyed by ffc_player_id:
 *   { svAdp, appearances, eligible }
 *
 * `eligible` is appearances >= SV_MIN_DRAFTS. Below the floor the value is still
 * returned (it is a real average) but the board renders an em-dash - same
 * doctrine as the history gates and the band floor: a thin sample is shown in
 * the detail, never read as signal in the column.
 *
 * appearances counts DISTINCT drafts in which a user took this player, not
 * picks: two picks of the same player in one draft is impossible, but counting
 * distinct drafts is the honest unit for "how many independent human decisions
 * is this average standing on".
 */
export async function getSportsvynAdp(opts = {}) {
  const db = opts.sql ?? (await import('../db.js')).sql;
  const rows = await db`
    SELECT dp.ffc_player_id,
           avg(dp.overall_pick)::float           AS sv_adp,
           count(DISTINCT dp.draft_id)::int      AS appearances,
           count(*)::int                         AS picks
      FROM draft_picks dp
      JOIN drafts d ON d.id = dp.draft_id
     WHERE d.status = 'completed'
       AND d.mode <> 'tracker'
       AND dp.picked_by = 'user'
     GROUP BY dp.ffc_player_id`;

  const out = new Map();
  for (const r of rows) {
    out.set(r.ffc_player_id, {
      svAdp: Math.round(Number(r.sv_adp) * 10) / 10,
      appearances: r.appearances,
      eligible: r.appearances >= SV_MIN_DRAFTS,
    });
  }
  return out;
}

/**
 * PURE. Divergence = Sportsvyn ADP minus market ADP.
 *
 * A POSITIVE number means our drafters WAIT LONGER than the field does. Note
 * this is the opposite sign sense to the movement deltas above, where positive
 * means rising - because this compares two positions rather than measuring a
 * change over time, and the mock's methodology states it in exactly these words:
 * "Divergence is Sportsvyn ADP minus market ADP. A positive number means our
 * drafters wait longer than the field does."
 *
 * Returns null unless the player clears the sample floor, so the board can never
 * print a divergence computed off a handful of drafts.
 */
export function divergence(sv, marketAdp) {
  if (!sv || !sv.eligible || sv.svAdp == null || marketAdp == null) return null;
  return Math.round((sv.svAdp - marketAdp) * 10) / 10;
}

// ============================== THE ENTRY CARD ==============================
// The /nfl instrument-column card is a VIEW OF THE SAME BOARD, never a second
// computation of it. It calls getMovementBoard and slices - so a player the
// board withholds can never appear on the card, and the two surfaces cannot
// disagree about who is moving. That is the whole reason this lives here rather
// than as its own query.

/**
 * The three card lists, sliced from a board result. Pure, so the tab-visibility
 * rule is testable without a database.
 *
 * CLIMBING RETURNS null, NOT []. The two mean different things and the card
 * renders them differently: [] is "the tab exists and nobody is climbing",
 * null is "this tab does not exist yet because drift is gated". Collapsing them
 * would put an empty Climbing tab on a board that cannot compute drift at all.
 */
export function cardLists(board, n = 5) {
  // Band eligibility is the SAME floor the board uses (BAND_MIN_DRAFTS plus a
  // real d3). A -7.8 move computed off 15 drafts is withheld from the board, so
  // it must not lead the card either.
  const eligible = board.players.filter((p) => p.bandEligible && p.d3 != null);
  const rising = eligible.filter((p) => p.d3 > 0).sort((a, b) => b.d3 - a.d3).slice(0, n);
  const falling = eligible.filter((p) => p.d3 < 0).sort((a, b) => a.d3 - b.d3).slice(0, n);
  const climbing = board.gates.drift
    ? board.players
      .filter((p) => p.drift != null && p.drift > 0)
      .sort((a, b) => b.drift - a.drift || (b.d3 ?? 0) - (a.d3 ?? 0))
      .slice(0, n)
    : null;
  return { rising, falling, climbing };
}

/**
 * Rookie ids for a season, as a Set. Shared by the board route and the card so
 * the R chip is decided in ONE place - two callers hand-writing the same
 * `WHERE rookie_season = ...` is how one of them ends up a season behind.
 */
export const ROOKIE_SEASON = 2026;

export async function getRookieIds(season = ROOKIE_SEASON) {
  const { sql } = await import('../db.js');
  const rows = await sql`SELECT id FROM nfl_players WHERE rookie_season = ${season}`;
  return new Set(rows.map((r) => r.id));
}

/** The entry card's read: one board query, sliced, with rookie flags attached. */
/**
 * TOP N BY ABSOLUTE 3-DAY MOVE, risers and fallers mixed into ONE list.
 *
 * cardLists() splits the board into two ranked columns because the board has
 * room for two. A dashboard module has room for one list, and "the five biggest
 * moves" is a different question from "the top five of each direction" - taking
 * the head of each list and interleaving would show a +0.4 riser above a -9.1
 * faller. Sorting on |d3| is the only ordering that answers the asked question.
 *
 * It reads the CARD, not the board: the card is already gated on bandEligible
 * and non-null d3, so this inherits both without restating them.
 */
export function topMovers(card, n = 5) {
  return [...(card?.rising ?? []), ...(card?.falling ?? [])]
    .filter((p) => p.d3 != null)
    .sort((a, b) => Math.abs(b.d3) - Math.abs(a.d3) || b.d3 - a.d3)
    .slice(0, n);
}

export async function getMovementCard(format = 'ppr', n = 5, opts = {}) {
  const [board, rookieIds] = await Promise.all([
    getMovementBoard(format, opts),
    getRookieIds(),
  ]);
  const flag = (p) => ({ ...p, isRookie: p.matchedPlayerId != null && rookieIds.has(p.matchedPlayerId) });
  const lists = cardLists(board, n);
  return {
    format,
    size: board.size,
    snapshotCount: board.snapshotCount,
    latestSnapshot: board.latestSnapshot,
    gates: board.gates,
    rising: lists.rising.map(flag),
    falling: lists.falling.map(flag),
    climbing: lists.climbing == null ? null : lists.climbing.map(flag),
  };
}
