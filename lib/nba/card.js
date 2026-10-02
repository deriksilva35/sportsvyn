// lib/nba/card.js - the NBA score card and game page, PURE (nba-card, thu-37).
//
// The card is the SHARED one - CardFace in components/scores/ScoreboardV4.js,
// mounted by /scores and by the game page - and it asks the sport once
// (sportOf, lib/live/vocabulary.js). Everything basketball-specific it draws is
// decided here, where a fixture can pin it:
//   · nbaLiveLabel     "Q4 · 2:14", "Half", "End Q3", "OT · 0:45", "2OT · 1:02"
//   · nbaFinalLabel    "Final", "Final · OT", "Final · 2OT"
//   · nbaLine          the line score: 1 2 3 4, then OT 2OT ... as played
//   · nbaCardExtras    the bonus, the timeouts, the final's period - from
//                      metadata.detail, which the poller writes (lib/nba/detail.js)
//   · performerLine    "Tatum 31 pts · Cunningham 28" live, "Tatum 38 pts · 11 reb" final
//   · nbaLeaders / nbaTeamStats / nbaBoxTables   the game page's final modules
//   · nbaPlayRows      the plays list, latest first, with the running score
//
// ABSENT, NEVER INVENTED. The feed carries no possession field (nor does any
// NBA route this product reads - /games, /box_scores/live, /plays), so the
// card draws no ball: lib/gridiron/possession.js answers null for basketball
// and nothing here guesses one from the last play. A row with no bonus or
// timeouts says nothing about them; a game with no odds row has no line.

import { shortOf, BASKETBALL } from '../live/vocabulary.js';

const n = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** 1-4 -> "Q1".."Q4"; 5 -> "OT"; 6 -> "2OT". The column and the clock share it. */
export function nbaPeriodWord(period) {
  const p = n(period);
  if (p == null || p < 1) return null;
  if (p <= 4) return `Q${p}`;
  return p === 5 ? 'OT' : `${p - 4}OT`;
}

const STOPPED = new Set(['0:00', '00:00', '0.0']);

/**
 * THE LIVE PILL. shortOf(BASKETBALL) is the one derivation of the period word
 * (it already says "Half" for period 2 at a stopped clock); this adds the
 * clock. A stopped clock at the end of any other period is "End Q3", not
 * "Q3 · 0.0" - the clock is not running and the period is over.
 */
export function nbaLiveLabel(liveState) {
  const word = shortOf(liveState, BASKETBALL);
  if (!word) return 'Live';
  if (word === 'Half') return 'Half';
  const c = liveState?.clock == null ? '' : String(liveState.clock).trim();
  if (!c) return word;
  if (STOPPED.has(c)) return `End ${word}`;
  return `${word} · ${c}`;
}

/** THE FINAL PILL: "Final", or the overtime it ended in. */
export function nbaFinalLabel(period) {
  const p = n(period);
  if (p == null || p <= 4) return 'Final';
  return `Final · ${nbaPeriodWord(p)}`;
}

/** The period a game ended in: the last line-score column, else regulation. */
export function finalPeriodOf(detail) {
  const ps = (Array.isArray(detail?.line_score) ? detail.line_score : []).map((p) => n(p?.period)).filter((p) => p != null);
  return ps.length ? Math.max(4, ...ps) : 4;
}

/**
 * THE LINE SCORE in lib/scores/expand.js lineFor's shape. Four regulation
 * columns always (an unplayed quarter is a blank, not a zero), then one per
 * overtime actually played. The total is the row's score - the number on the
 * card - not a sum that could disagree with it. Null when nothing is stored.
 */
export function nbaLine(game, detail) {
  const ls = Array.isArray(detail?.line_score) ? detail.line_score : [];
  if (!ls.length) return null;
  const by = new Map(ls.map((p) => [n(p.period), p]));
  const top = Math.max(4, ...by.keys());
  const columns = []; const cells = { home: [], away: [] };
  for (let p = 1; p <= top; p += 1) {
    columns.push(p <= 4 ? String(p) : nbaPeriodWord(p));
    const row = by.get(p);
    cells.home.push(row?.home == null ? '' : String(row.home));
    cells.away.push(row?.away == null ? '' : String(row.away));
  }
  const ab = (t) => t?.abbreviation ?? '';
  return {
    columns, total: 'T', extra: [],
    rows: [
      { side: 'away', abbr: ab(game?.away), cells: cells.away, total: game?.awayScore ?? '', extra: [] },
      { side: 'home', abbr: ab(game?.home), cells: cells.home, total: game?.homeScore ?? '', extra: [] },
    ],
  };
}

/**
 * WHAT THE CARD READS OFF metadata.detail, per state. The bonus and the
 * timeouts are LIVE facts: a final card carrying "TO 1 · 1" or a BONUS tag
 * would be describing a stoppage that is over. Each is null unless BOTH sides
 * are stated - half a fact is not drawn.
 *   bonus      { home: bool, away: bool }   X in the bonus = X shoots the bonus
 *   timeouts   { home: n, away: n }
 *   finalPeriod  the period a final ended in (Final · OT)
 */
export function nbaCardExtras(status, detail) {
  const live = status === 'live';
  const b = detail?.bonus; const t = detail?.timeouts;
  const bonus = live && typeof b?.home === 'boolean' && typeof b?.away === 'boolean' ? { home: b.home, away: b.away } : null;
  const timeouts = live && n(t?.home) != null && n(t?.away) != null ? { home: n(t.home), away: n(t.away) } : null;
  return { bonus, timeouts, finalPeriod: status === 'final' ? finalPeriodOf(detail) : null };
}

/** "TO 2 · 1", in the card's team order (away first). */
export function timeoutsText(timeouts, order = ['away', 'home']) {
  if (!timeouts) return null;
  return `TO ${order.map((s) => timeouts[s]).join(' · ')}`;
}

/** The newest play's sentence for the card's last-play line, or null. */
export function lastPlayText(detail) {
  const t = String(detail?.last_play?.text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  // "End of the 4th Quarter" / "End of Game" are not plays a reader follows.
  if (/^(end period|end game|start period)$/i.test(String(detail.last_play.type ?? ''))) return null;
  return t;
}

const SUFFIX = /^(jr\.?|sr\.?|ii|iii|iv|v)$/i;
/** "Jayson Tatum" -> "Tatum"; "Jaren Jackson Jr." -> "Jackson Jr.". */
export function surname(full) {
  const parts = String(full ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? '';
  const last = parts.at(-1);
  return SUFFIX.test(last) && parts.length > 2 ? `${parts.at(-2)} ${last}` : last;
}

const byPts = (a, b) => (n(b.pts) ?? 0) - (n(a.pts) ?? 0) || String(a.player_name).localeCompare(String(b.player_name));
const played = (rows) => (rows ?? []).filter((r) => !r.dnp && (n(r.pts) ?? 0) > 0);

/**
 * THE FOOT'S ONE LINE, from nba_player_game_stats.
 *   live   each side's top scorer, the higher first: "Tatum 31 pts · Cunningham 28"
 *   final  the game's top scorer, with rebounds or assists when either reaches
 *          five (the larger): "Tatum 38 pts · 11 reb"
 * Null when nobody has scored - the foot says nothing rather than "0 pts".
 */
export function performerLine(rows, { status, homeId, awayId } = {}) {
  const scored = played(rows);
  if (!scored.length) return null;
  if (status === 'final') {
    const top = [...scored].sort(byPts)[0];
    const reb = n(top.reb) ?? 0; const ast = n(top.ast) ?? 0;
    const more = Math.max(reb, ast) >= 5 ? ` · ${reb >= ast ? `${reb} reb` : `${ast} ast`}` : '';
    return `${surname(top.player_name)} ${n(top.pts)} pts${more}`;
  }
  const tops = [homeId, awayId]
    .map((id) => scored.filter((r) => r.team_id === id).sort(byPts)[0])
    .filter(Boolean)
    .sort(byPts);
  if (!tops.length) return null;
  return tops.map((r, i) => `${surname(r.player_name)} ${n(r.pts)}${i === 0 ? ' pts' : ''}`).join(' · ');
}

/**
 * LEADERS, PTS / REB / AST, BOTH TEAMS - the final's module, the gridiron
 * Leaders component's shape ({ cat, away: {name, line}, home }). The points
 * line carries the shooting: "38 · 13/24 · 5 3PM" (threes from three made).
 * Ties go to the name so the order is stable. A category nobody recorded is
 * not drawn.
 */
export function nbaLeaders(rows, { homeId, awayId }) {
  const cats = [
    ['PTS', 'pts', (r) => `${n(r.pts) ?? 0} · ${n(r.fgm) ?? 0}/${n(r.fga) ?? 0}${(n(r.fg3m) ?? 0) >= 3 ? ` · ${n(r.fg3m)} 3PM` : ''}`],
    ['REB', 'reb', (r) => `${n(r.reb) ?? 0}`],
    ['AST', 'ast', (r) => `${n(r.ast) ?? 0}`],
  ];
  const best = (teamId, key, line) => {
    const mine = (rows ?? []).filter((r) => r.team_id === teamId && !r.dnp && (n(r[key]) ?? 0) > 0);
    if (!mine.length) return null;
    mine.sort((a, b) => (n(b[key]) ?? 0) - (n(a[key]) ?? 0) || String(a.player_name).localeCompare(String(b.player_name)));
    return { name: surname(mine[0].player_name), line: line(mine[0]) };
  };
  return cats.map(([cat, key, line]) => ({ cat, away: best(awayId, key, line), home: best(homeId, key, line) }))
    .filter((l) => l.away || l.home);
}

const pct = (m, a) => (a > 0 ? (m / a).toFixed(3).replace(/^0/, '') : null);

/**
 * TEAM STATS, FG% / 3PT / REB / TOV, summed from the player lines. The
 * percentage is derived from the summed makes and attempts (migration 119:
 * counting stats only, a rate is the reader's). REB is the players' total; a
 * team rebound has no player and is not in the box this product holds.
 * Shape: { [teamId]: { 'FG%', '3PT', REB, TOV } } - GamePageArcade TeamStats'.
 */
export function nbaTeamStats(rows, { homeId, awayId }) {
  const out = {};
  for (const id of [awayId, homeId]) {
    const mine = (rows ?? []).filter((r) => r.team_id === id);
    if (!mine.length) continue;
    const sum = (k) => mine.reduce((a, r) => a + (n(r[k]) ?? 0), 0);
    out[id] = {
      'FG%': pct(sum('fgm'), sum('fga')),
      '3PT': `${sum('fg3m')}/${sum('fg3a')}`,
      REB: sum('reb'),
      TOV: sum('turnovers'),
    };
  }
  return Object.keys(out).length ? out : null;
}

/** 1754 -> "29:14"; null -> "". */
export function minutesOf(seconds) {
  const s = n(seconds);
  if (s == null) return '';
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * THE FULL BOX, one table per side in GamePageArcade BoxTables' shape. Players
 * who did not play are left off (the box is who played); minutes first, then
 * the line. Sorted by minutes, the order a box score is read in.
 */
export function nbaBoxTables(rows, game) {
  const headings = ['MIN', 'PTS', 'REB', 'AST', 'FG', '3PT', 'FT', '+/-'];
  return ['away', 'home'].map((side) => {
    const t = side === 'home' ? game?.home : game?.away;
    const mine = (rows ?? []).filter((r) => r.team_id === t?.id && !r.dnp)
      .sort((a, b) => (n(b.seconds) ?? 0) - (n(a.seconds) ?? 0) || String(a.player_name).localeCompare(String(b.player_name)));
    const pm = (v) => (n(v) == null ? '' : n(v) > 0 ? `+${n(v)}` : String(n(v)));
    return {
      side, abbr: t?.abbreviation ?? '',
      tables: mine.length ? [{
        group: 'players', label: 'Box', headings,
        rows: mine.map((r) => ({
          name: r.player_name,
          cells: [minutesOf(r.seconds), n(r.pts) ?? 0, n(r.reb) ?? 0, n(r.ast) ?? 0,
            `${n(r.fgm) ?? 0}/${n(r.fga) ?? 0}`, `${n(r.fg3m) ?? 0}/${n(r.fg3a) ?? 0}`, `${n(r.ftm) ?? 0}/${n(r.fta) ?? 0}`, pm(r.plus_minus)],
        })),
      }] : [],
    };
  });
}

/** "Q4 2:14", "OT 0:45", "2OT 1:02" for a play row. */
export function nbaWhen(period, clock) {
  return [nbaPeriodWord(period), clock || null].filter(Boolean).join(' ');
}

/** Rows the plays list does not show: who checked in is not what happened. */
export const QUIET_PLAY = /^substitution$/i;

/**
 * THE PLAYS LIST, latest first, from `plays` rows (lib/nba/statsSync.js
 * shapeNbaPlays). A scoring play carries the score after it, away first as the
 * card reads ("104-101"); every other play none. PURE.
 * @param plays  [{ period, clock, playType, text, homeScore, awayScore, scoring, offenseTeamId, playNumber }]
 */
export function nbaPlayRows(plays, { abbrOf = () => null } = {}) {
  return [...(plays ?? [])]
    .filter((p) => !QUIET_PLAY.test(String(p.playType ?? '')) && p.text)
    .sort((a, b) => (n(b.playNumber) ?? 0) - (n(a.playNumber) ?? 0))
    .map((p) => ({
      when: nbaWhen(p.period, p.clock),
      abbr: abbrOf(p.offenseTeamId) ?? '',
      text: p.text,
      score: p.scoring && n(p.homeScore) != null && n(p.awayScore) != null ? `${n(p.awayScore)}-${n(p.homeScore)}` : null,
    }));
}

/**
 * THE GAME PAGE'S MODULES, per state - the gridiron arcadeModules' grammar,
 * basketball's list. A module with nothing in it is not drawn.
 *   pre    card, market, yours
 *   live   card, yours, chips (Plays | Box | Leaders | Market)
 *   final  card, yours, leaders, teamstats, fullbox (+ box when opened)
 * NO WIN PROBABILITY for basketball (thu-37): there is no model, and no module.
 */
export function nbaModules({ state, hasMarket = false, hasYours = false, hasLeaders = false, hasTeamStats = false, hasBox = false, boxOpen = false }) {
  const yours = hasYours ? 'yours' : null;
  if (state === 'pre') return ['card', hasMarket ? 'market' : null, yours].filter(Boolean);
  if (state === 'live') return ['card', yours, 'chips'].filter(Boolean);
  return ['card', yours, hasLeaders ? 'leaders' : null, hasTeamStats ? 'teamstats' : null,
    hasBox ? (boxOpen ? 'box' : 'fullbox') : null].filter(Boolean);
}

/** The live chips, each only where its section has something. Leaders, not Stats. */
export function nbaChips({ plays = 0, box = false, leaders = false, market = false }) {
  return [
    plays > 0 ? { key: 'plays', label: 'Plays' } : null,
    box ? { key: 'box', label: 'Box' } : null,
    leaders ? { key: 'stats', label: 'Leaders' } : null,
    market ? { key: 'market', label: 'Market' } : null,
  ].filter(Boolean);
}
