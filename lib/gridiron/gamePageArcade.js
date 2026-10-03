// lib/gridiron/gamePageArcade.js - the gridiron game page under the ARCADE
// theme (game-page-arcade, Derik's ruling wed-8). The dark page is untouched;
// app/nfl/game/[slug]/page.js and its CFB sibling branch here on arcadeFor().
//
// PURE SHAPING FIRST, then the reads. Everything the page decides - which
// modules, in what order; the scoring plays; the leaders; the closing line;
// the curve - is a pure function below with a test beside it. The reads are
// small and named, and each one is caught: a missing module is a missing
// module, never a missing page.
//
// WHAT IS NOT HERE, by ruling: the brief, any recap or article link, the win
// probability gloss, the explanatory notes, and per-play WP deltas in the
// live feed (the plays list carries none - wed-8, kept by sat-1).
//
// WHAT RELAY sat-1 (3 Oct) CHANGED in the wed-8 exclusions:
//   - CFB WIN PROBABILITY IS SHOWN (curve, number, card read) with the
//     CALIBRATING tag; NFL's tag is gone. Both are lib/winprob/display.js.
//   - BIGGEST SWINGS RETURNS, NFL FINALS ONLY, and only for games logged
//     after the fri-4 inputs fix (swingsEligible below).

import { sql } from '../db.js';
import { DISPLAYED } from '../winprob/display.js';
import { fmtLine } from '../scores/v4.js';
import { byGameClock } from './driveStrip.js';

/** The three page states. A simulated ?asOf= cut is 'live' by construction. */
export function pageState(status) {
  if (status === 'final') return 'final';
  if (status === 'live') return 'live';
  return 'pre';
}

/** Win probability is displayed for a league only where lib/winprob/live.js says so. */
export const winProbShown = (league) => DISPLAYED[league] === true;

/**
 * THE MODULE ORDER, per state (wed-8, thu-5, sat-1). PURE.
 *   pre    card, market, yours
 *   live   card, winprob (NFL/CFB, when there is a curve or a number), yours, chips
 *   final  card, winprob (NFL/CFB, only where winprob_log rows exist), swings
 *          (NFL only, only when biggestSwings found any), yours, scoring, leaders
 * THERE IS NO DRIVE MODULE (thu-5): the live card carries the field strip and
 * the last play. `market` is dropped when there is no two-sided read; `yours`
 * when the reader has nothing on the game AND no game is still open for it;
 * `scoring` / `leaders` when they would be empty. A module with nothing in it
 * is not drawn - the page has no placeholders.
 */
export function arcadeModules({ state, league, hasCurve = false, hasNow = false, hasSwings = false, hasMarket = true, hasYours = true, hasScoring = true, hasLeaders = true }) {
  const wp = winProbShown(league);
  const yours = hasYours ? 'yours' : null;
  if (state === 'pre') return ['card', hasMarket ? 'market' : null, yours].filter(Boolean);
  if (state === 'live') return ['card', wp && (hasCurve || hasNow) ? 'winprob' : null, yours, 'chips'].filter(Boolean);
  return ['card', wp && hasCurve ? 'winprob' : null, league === 'nfl' && hasSwings ? 'swings' : null,
    yours, hasScoring ? 'scoring' : null, hasLeaders ? 'leaders' : null].filter(Boolean);
}

/** The chips under a live game, each only where its section has something. */
export function liveChips({ plays = 0, box = false, stats = false, market = false }) {
  return [
    plays > 0 ? { key: 'plays', label: 'Plays' } : null,
    box ? { key: 'box', label: 'Box' } : null,
    stats ? { key: 'stats', label: 'Stats' } : null,
    market ? { key: 'market', label: 'Market' } : null,
  ].filter(Boolean);
}

const n = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * SCORING PLAYS: every change in the score, in game order, read off the plays
 * themselves - not the `scoring` flag, which a provider sets on the touchdown
 * and not always on the extra point that follows it. The side is the one
 * whose score went UP (a pick-six or a safety scores for the defense, so the
 * offense is not the scorer). A play with no score carries the last known one.
 * PURE. @returns [{ period, clock, side, text, playType, homeScore, awayScore, points }]
 */
export function scoreChanges(plays) {
  const out = [];
  let h = 0, a = 0;
  for (const p of gameOrder(plays)) {
    const ph = n(p.homeScore), pa = n(p.awayScore);
    if (ph == null || pa == null) continue;
    if (ph === h && pa === a) continue;
    // A SCORE THAT GOES DOWN IS NOT A PLAY, it is a row carrying a stale
    // score - measured on PROD: a Q2 timeout in PHI@CHI (wk3) is stored at 0-0
    // between a 10-0 field goal and a 10-7 touchdown. Taken as the new
    // baseline it would make the touchdown look like 17 points to both sides.
    if (ph < h || pa < a) continue;
    const side = ph > h && pa === a ? 'home' : pa > a && ph === h ? 'away' : null;
    if (side) {
      out.push({
        period: p.period ?? null, clock: p.clock ?? null, side,
        text: p.text ?? null, playType: p.playType ?? null, homeScore: ph, awayScore: pa,
        points: side === 'home' ? ph - h : pa - a,
      });
    }
    h = ph; a = pa;
  }
  return out;
}

/**
 * GAME ORDER is lib/gridiron/driveStrip.js byGameClock: period up, clock
 * down, ties in stored order. playsFor() orders by drive and play number, and
 * the NFL feed's administrative rows (timeouts, the two-minute warning, END
 * QUARTER) carry no drive - so in that order they sit after the last drive
 * carrying the score of the moment they happened, and END QUARTER 3 at 20-7
 * would follow a 27-7 touchdown and read as a score.
 */
export const gameOrder = (plays) => byGameClock(plays);

/** "Q3 6:42", "OT 4:10", or the clock alone. */
export function whenLabel(period, clock) {
  const p = n(period);
  const q = p == null ? null : p >= 5 ? (p === 5 ? 'OT' : `OT${p - 4}`) : `Q${p}`;
  return [q, clock || null].filter(Boolean).join(' ');
}

const SUFFIX = /^(jr\.?|sr\.?|ii|iii|iv|v)$/i;
/** "Josh Allen" -> "Allen"; "Marvin Harrison Jr." -> "Harrison Jr.". */
export function shortName(full) {
  const parts = String(full ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? '';
  const last = parts.at(-1);
  return SUFFIX.test(last) && parts.length > 2 ? `${parts.at(-2)} ${last}` : last;
}

const tdBit = (td) => (n(td) > 0 ? ` · ${n(td)} TD` : '');
/** One leader's line, per category: "26/37 · 298 · 3 TD", "17 · 84", "8 · 92 · 1 TD". */
export function leaderLine(cat, s) {
  if (cat === 'PASS') return `${n(s.cmp) ?? 0}/${n(s.att) ?? 0} · ${n(s.yds) ?? 0}${tdBit(s.td)}`;
  return `${n(s.att) ?? 0} · ${n(s.yds) ?? 0}${tdBit(s.td)}`;
}

const CATS = [
  ['PASS', (r) => n(r.pass_att) > 0, (r) => n(r.pass_yds) ?? 0, (r) => ({ cmp: r.pass_cmp, att: r.pass_att, yds: r.pass_yds, td: r.pass_td })],
  ['RUSH', (r) => n(r.rush_att) > 0, (r) => n(r.rush_yds) ?? 0, (r) => ({ att: r.rush_att, yds: r.rush_yds, td: r.rush_td })],
  ['REC', (r) => n(r.rec) > 0, (r) => n(r.rec_yds) ?? 0, (r) => ({ att: r.rec, yds: r.rec_yds, td: r.rec_td })],
];

/**
 * LEADERS, PASS / RUSH / REC, BOTH TEAMS, from regTeamTables' raw rows (the
 * NFL box score the page already reads). The leader is the most yards in the
 * category; a tie goes to the name, so the order is stable. A category with
 * no line on either side is not drawn. PURE.
 * @returns [{ cat, away: {name, line} | null, home: {name, line} | null }]
 */
export function gameLeaders(rows, { homeId, awayId }) {
  const best = (teamId, has, yds, stat, cat) => {
    const mine = (rows ?? []).filter((r) => r.team_id === teamId && has(r));
    if (!mine.length) return null;
    mine.sort((x, y) => yds(y) - yds(x) || String(x.full_name).localeCompare(String(y.full_name)));
    return { name: shortName(mine[0].full_name), line: leaderLine(cat, stat(mine[0])) };
  };
  return CATS.map(([cat, has, yds, stat]) => ({
    cat, away: best(awayId, has, yds, stat, cat), home: best(homeId, has, yds, stat, cat),
  })).filter((l) => l.away || l.home);
}

/**
 * THE SAME THREE ROWS FOR CFB, from lib/cfb/boxScore.js's tables - which are
 * already sorted leader-first by the yards column (CFB_GROUPS `sort`). The
 * cells are that module's: passing [C/ATT, YDS, TD, INT], rushing [CAR, YDS,
 * TD, LONG], receiving [REC, YDS, TD, LONG]. PURE.
 * `teams` is [{ side: 'home'|'away', tables }].
 */
export function cfbLeaders(teams) {
  const top = (side, group) => {
    const t = (teams ?? []).find((x) => x.side === side);
    const tbl = t?.tables?.find((x) => x.group === group);
    return tbl?.rows?.[0] ?? null;
  };
  const line = (cat, r) => {
    if (!r) return null;
    const c = r.cells ?? [];
    if (cat === 'PASS') {
      const [cmp, att] = String(c[0] ?? '').split('/');
      return { name: shortName(r.name), line: leaderLine('PASS', { cmp, att, yds: c[1], td: c[2] }) };
    }
    return { name: shortName(r.name), line: leaderLine(cat, { att: c[0], yds: c[1], td: c[2] }) };
  };
  return [['PASS', 'passing'], ['RUSH', 'rushing'], ['REC', 'receiving']]
    .map(([cat, g]) => ({ cat, away: line(cat, top('away', g)), home: line(cat, top('home', g)) }))
    .filter((l) => l.away || l.home);
}

/**
 * THE CLOSING LINE for the final card's foot: metadata.market_prior, the last
 * consensus HOME spread before kickoff in betting convention (-3 = home by 3;
 * lib/winprob/live.js). Written as the favourite's line, the way the board's
 * odds foot writes it. Null when there is no prior - then the foot says
 * nothing about a line. PURE.
 */
export function closingLine(prior, game) {
  const s = n(prior?.spread);
  if (s == null) return null;
  if (s === 0) return 'Closing line PK';
  const homeFav = s < 0;
  const ab = (homeFav ? game?.home : game?.away)?.abbreviation ?? '';
  return `Closing line ${ab} ${fmtLine(homeFav ? s : -s)}`.replace(/\s+/g, ' ');
}

/** Regulation is 3600 s; overtime is a 600 s period on the same axis. */
export const REG_SECS = 3600;
const OT_SECS = 600;

/** Elapsed game seconds from the model's own clock (winprob_log.inputs). */
export function elapsedOf(inputs) {
  const ot = Number(inputs?.is_ot) === 1;
  if (ot) {
    const half = n(inputs?.secs_half);
    return REG_SECS + (half == null ? OT_SECS : Math.max(0, OT_SECS - half));
  }
  const g = n(inputs?.secs_game);
  return g == null ? null : Math.max(0, REG_SECS - g);
}

/** Elapsed seconds after a play: (period, clock) on the same axis. */
export function elapsedAt(period, clock) {
  const p = n(period);
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(clock ?? ''));
  if (p == null || !m) return null;
  const left = Number(m[1]) * 60 + Number(m[2]);
  if (p >= 5) return REG_SECS + (p - 5) * OT_SECS + Math.max(0, OT_SECS - left);
  return (p - 1) * 900 + Math.max(0, 900 - left);
}

/**
 * THE CURVE: winprob_log rows (ts order) as points on the game clock. A row
 * whose clock cannot be read is skipped; x never runs backwards (a corrected
 * clock would otherwise draw a loop). `upTo` cuts the curve at an elapsed
 * second - a simulated ?asOf= replay shows the curve as it stood then. PURE.
 * @returns {{ points: [{x, p}], end: number }} p is the HOME probability, 0-1
 */
export function curvePoints(rows, { upTo = null } = {}) {
  const points = [];
  let maxX = 0;
  for (const r of rows ?? []) {
    const x0 = elapsedOf(r.inputs);
    const p = n(r.p_home);
    if (x0 == null || p == null) continue;
    if (upTo != null && x0 > upTo) break;
    const x = Math.max(maxX, x0);
    maxX = x;
    points.push({ x, p: Math.min(1, Math.max(0, p)) });
  }
  return { points, end: Math.max(REG_SECS, maxX) };
}

/** The SVG polyline for the curve, home at the top. PURE. */
export function curvePath(curve, { w = 358, h = 64 } = {}) {
  const { points, end } = curve;
  const r = (v) => Math.round(v * 10) / 10;
  return points.map(({ x, p }) => `${r((x / end) * w)},${r((1 - p) * h)}`).join(' ');
}

/** "PHI 71%" from a home probability; the side ahead, and its number. PURE. */
export function wpNow(pHome, game) {
  const p = n(pHome);
  if (p == null) return null;
  const home = Math.round(p * 100);
  const homeFav = home >= 50;
  return { abbr: (homeFav ? game.home : game.away)?.abbreviation ?? '', pct: homeFav ? home : 100 - home };
}

/**
 * A QUARTER LINE FROM THE PLAYS, for a simulated ?asOf= cut only: the row's
 * own line_scores describe the end of the game, not play N. Points per period
 * are the score at the period's last play minus the score at the previous
 * one's. PURE. Same shape as lib/scores/expand.js lineFor.
 */
export function lineFromPlays(plays, game) {
  const byP = new Map();
  let last = { h: 0, a: 0 };
  for (const p of gameOrder(plays)) {
    const ph = n(p.homeScore), pa = n(p.awayScore), per = n(p.period);
    if (per == null) continue;
    // the same stale-row rule as scoreChanges: a score never goes down
    if (ph != null && pa != null && ph >= last.h && pa >= last.a) last = { h: ph, a: pa };
    byP.set(per, { ...last });
  }
  const periods = [...byP.keys()].sort((x, y) => x - y);
  if (!periods.length) return null;
  const top = Math.max(4, periods.at(-1));
  const cols = []; const hc = []; const ac = [];
  let prev = { h: 0, a: 0 };
  for (let q = 1; q <= top; q += 1) {
    cols.push(q >= 5 ? (q === 5 ? 'OT' : `OT${q - 4}`) : String(q));
    const end = byP.get(q);
    if (!end) { hc.push(''); ac.push(''); continue; }
    hc.push(String(end.h - prev.h)); ac.push(String(end.a - prev.a));
    prev = end;
  }
  const ab = (t) => t?.abbreviation ?? '';
  return {
    columns: cols, total: 'T', extra: [],
    rows: [
      { side: 'away', abbr: ab(game.away), cells: ac, total: prev.a, extra: [] },
      { side: 'home', abbr: ab(game.home), cells: hc, total: prev.h, extra: [] },
    ],
  };
}

// ---------------------------------------------------------------------------
// Reads. Small, named, each caught by its caller.
// ---------------------------------------------------------------------------

/**
 * The game's curve, in time order, for the game's OWN sport - a displayed one
 * (lib/winprob/display.js), never another sport's rows. One read; LIMIT is a
 * backstop (a game logs ~150).
 */
export async function winProbRows(matchId, { sport, db = sql } = {}) {
  if (DISPLAYED[sport] !== true) return [];
  return db`SELECT p_home, inputs FROM winprob_log
             WHERE match_id = ${matchId} AND sport = ${sport}
             ORDER BY ts, id LIMIT 3000`;
}

// ---------------------------------------------------------------------------
// BIGGEST SWINGS (relay sat-1). NFL finals only.
// ---------------------------------------------------------------------------

/** Kickoffs from here on: the first slate fully after the fri-4 inputs fix. */
export const SWINGS_KICKOFF_FROM = '2026-10-04T00:00:00Z';
/** The fri-4 fix went live on the poller at this instant (main f31c447). */
export const SWINGS_LOGGED_AFTER = '2026-10-02T20:21:04Z';
export const SWINGS_TOP = 3;

/**
 * ELIGIBILITY, BOTH CONDITIONS (sat-1). PURE.
 *   - NFL, and the game is final;
 *   - kickoff_at >= SWINGS_KICKOFF_FROM;
 *   - EVERY state row (no inputs.reason) was logged strictly after
 *     SWINGS_LOGGED_AFTER. One older state row and the game has no module:
 *     its curve was computed, in part, with the pre-fix possession and clock.
 * Hold / release / final rows are not states and are not looked at here.
 */
const msOf = (v) => (v == null || v === '' ? NaN : new Date(v).getTime());

export function swingsEligible({ league, state, kickoffAt, rows }) {
  if (league !== 'nfl' || state !== 'final') return false;
  const ko = msOf(kickoffAt);
  if (!Number.isFinite(ko) || ko < msOf(SWINGS_KICKOFF_FROM)) return false;
  const cut = msOf(SWINGS_LOGGED_AFTER);
  const states = (rows ?? []).filter((r) => !r?.inputs?.reason);
  if (!states.length) return false;
  return states.every((r) => { const t = msOf(r.ts); return Number.isFinite(t) && t > cut; });
}

/**
 * IS THIS ROW'S PLAY OUT OF BOUNDS FOR A SWING? A kickoff (the model reads it
 * as the receiver's 1st & 10 at a spot it was never trained to carry across -
 * the jump into and out of it is the mapping, not the game) and a try (an
 * extra point or a two-point attempt on a row of its own). Read from the play:
 *   play_type  /^kickoff/ or /^onside/ - EXCEPT a kickoff return touchdown,
 *              which is a score, not a kickoff state;
 *              /extra-point|two-point|conversion|^pat(-|$)/
 *   text       a row that is ONLY a try: "extra point" or "TWO-POINT
 *              CONVERSION" with no TOUCHDOWN in it. BDL folds the try into
 *              the touchdown row (lib/winprob/live.js) - that row IS the
 *              touchdown and counts.
 * A row whose play is missing (no play_seq, or a play_seq that resolves to
 * no plays row) is also out: there is no text, clock or team to show. PURE.
 */
export function swingExcluded(play) {
  if (!play || (play.play_type == null && play.text == null)) return true;
  const key = String(play.play_type ?? '').trim().toLowerCase().replace(/\s+/g, '-');
  const text = String(play.text ?? '');
  const td = /touchdown/.test(key) || /TOUCHDOWN/i.test(text);
  if (/^(kickoff|onside)/.test(key) && !/touchdown/.test(key)) return true;
  if (/extra-point|two-point|conversion|^pat(-|$)/.test(key)) return true;
  if (!td && /extra point|TWO-POINT CONVERSION/i.test(text)) return true;
  return false;
}

/**
 * THE SWINGS. PURE.
 * `rows` are the game's winprob_log rows joined to their play (biggestSwingRows):
 *   { id, ts, play_seq, p_home, inputs, period, clock, play_type, text, offense_team_id }
 *
 * THE RULE, EXACTLY:
 *   1. Order by ts, then id (the log's own order). Drop every row with an
 *      inputs.reason (hold, release, final): they are not states. What is left
 *      is the sequence of STATE rows S0..Sn.
 *   2. Each consecutive pair (S[i-1], S[i]) is a candidate, delta = p(S[i]) -
 *      p(S[i-1]), credited to S[i]'s play. A pair counts only when
 *        - NEITHER row is excluded (swingExcluded): a delta INTO a kickoff or
 *          try row and a delta OUT OF one are both dropped - never bridged
 *          across it;
 *        - the two rows are different plays (play_seq changed) - a re-read of
 *          the same play is not a swing;
 *        - |delta| > 0.
 *   3. Rank by |delta| descending; a tie goes to the EARLIER pair (log order),
 *      so the order is stable. Keep the top SWINGS_TOP, biggest first.
 *   4. Each swing: the play's text, its own quarter and clock, the team that
 *      made the play (the offense; on a defensive or return touchdown the
 *      scoring side, as lib/winprob/live.js reads it), and the delta in the
 *      curve's home/away framing: the side whose probability went UP, "+N%"
 *      (deltaHome keeps the signed home value).
 * @returns [{ text, when, period, clock, teamId, team, deltaHome, gainer, pct, label, playSeq }]
 */
export function biggestSwings(rows, game, { top = SWINGS_TOP } = {}) {
  const at = (r) => { const t = msOf(r.ts); return Number.isFinite(t) ? t : 0; };
  const states = (rows ?? []).filter((r) => r && !r.inputs?.reason && n(r.p_home) != null)
    .map((r, i) => ({ r, i }))
    .sort((a, b) => at(a.r) - at(b.r) || (n(a.r.id) ?? 0) - (n(b.r.id) ?? 0) || a.i - b.i)
    .map((x) => x.r);
  const homeId = game?.home?.id ?? null;
  const awayId = game?.away?.id ?? null;
  const abbr = (id) => (id != null && Number(id) === Number(homeId) ? game.home?.abbreviation : id != null && Number(id) === Number(awayId) ? game.away?.abbreviation : null) ?? '';
  const cands = [];
  for (let i = 1; i < states.length; i += 1) {
    const a = states[i - 1], b = states[i];
    if (swingExcluded(a) || swingExcluded(b)) continue;
    if (a.play_seq != null && b.play_seq != null && String(a.play_seq) === String(b.play_seq)) continue;
    const d = n(b.p_home) - n(a.p_home);
    if (!(Math.abs(d) > 0)) continue;
    cands.push({ i, d, row: b });
  }
  cands.sort((x, y) => Math.abs(y.d) - Math.abs(x.d) || x.i - y.i);
  return cands.slice(0, top).map(({ d, row }) => {
    const key = String(row.play_type ?? '').trim().toLowerCase().replace(/\s+/g, '-');
    const defenceScored = /touchdown/.test(key) && (/return-touchdown$/.test(key) || /^blocked-/.test(key));
    const off = n(row.offense_team_id);
    const teamId = off == null ? null : defenceScored ? (off === Number(homeId) ? awayId : off === Number(awayId) ? homeId : null) : off;
    const gainer = d > 0 ? game?.home?.abbreviation ?? '' : game?.away?.abbreviation ?? '';
    const pct = Math.round(Math.abs(d) * 100);
    return {
      text: row.text ?? '', period: row.period ?? null, clock: row.clock ?? null,
      when: whenLabel(row.period, row.clock), teamId, team: abbr(teamId),
      deltaHome: d, gainer, pct, label: `${gainer} +${pct}%`, playSeq: row.play_seq ?? null,
    };
  });
}

/**
 * The swings' read: the game's NFL log joined to each row's play, one query.
 * Called only for an eligible-looking final (NFL, final, kickoff on or after
 * SWINGS_KICKOFF_FROM); swingsEligible then checks the rows' own stamps.
 */
export async function biggestSwingRows(matchId, { db = sql } = {}) {
  return db`SELECT w.id, w.ts, w.play_seq, w.p_home, w.inputs,
                   p.period, p.clock, p.play_type, p.text, p.offense_team_id
              FROM winprob_log w
              LEFT JOIN plays p ON p.id = w.play_seq AND p.match_id = w.match_id
             WHERE w.match_id = ${matchId} AND w.sport = 'nfl'
             ORDER BY w.ts, w.id LIMIT 3000`;
}

/** THE PLAYS LIST: the latest five (latest first) and the count, two reads over plays.match_id. */
export async function playsFeed(matchId, { db = sql, limit = 5 } = {}) {
  const [rows, cnt] = await Promise.all([
    // GAME ORDER, REVERSED (see gameOrder): period, then the clock - an
    // administrative row has no drive number, so a drive-keyed order would
    // pin every timeout of the night to the top of the list.
    db`SELECT period, clock, offense_team_id, play_type, text
         FROM plays WHERE match_id = ${matchId}
        ORDER BY period DESC NULLS LAST,
                 CASE WHEN clock ~ '^[0-9]{1,2}:[0-9]{2}$'
                      THEN split_part(clock, ':', 1)::int * 60 + split_part(clock, ':', 2)::int END ASC NULLS LAST,
                 drive_number DESC NULLS LAST, play_number DESC NULLS LAST, id DESC
        LIMIT ${limit}`,
    db`SELECT count(*)::int AS n FROM plays WHERE match_id = ${matchId}`,
  ]);
  return {
    latest: rows.map((r) => ({ period: r.period, clock: r.clock, offenseTeamId: r.offense_team_id, playType: r.play_type, text: r.text })),
    total: Number(cnt[0]?.n ?? 0),
  };
}

/** The network for the card's label - the same lateral /scores reads. */
export async function networkFor(matchId, { db = sql } = {}) {
  const r = await db`SELECT broadcaster_name FROM match_broadcasters
                      WHERE match_id = ${matchId} AND country_code = 'US'
                      ORDER BY is_primary DESC, display_order ASC LIMIT 1`;
  return r[0]?.broadcaster_name ?? null;
}

/** The ET weekday of a kickoff, "Sun" - the card's "Final · Sun". */
export function etWeekday(iso) {
  if (!iso) return null;
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(new Date(iso));
}
