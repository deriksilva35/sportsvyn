// lib/nba/pagePre.js - the NBA game page's pre-game modules, PURE (thu1-nba-page).
// Raw feed rows in (lib/nba/pageFeed.js), the shapes GamePageArcade draws out.
// NOTHING GUESSED: a field the feed does not carry is a field not drawn, and a
// module with nothing in it is null.

import { surname } from './card.js';

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const nameOf = (p) => `${String(p?.first_name ?? '').trim()} ${String(p?.last_name ?? '').trim()}`.trim();

// ------------------------------------------------------------- the header

/**
 * THE LINE AND THE TOTAL from the feed's odds rows: the vendor named
 * 'draftkings' if it has a spread, else the first row that has one. The home
 * handicap, signed (negative = home favoured), as getSpreadHome returns it.
 * The total rides with the spread's row, else the first row carrying one.
 * { spreadHome, total } - either may be null; null when neither is there.
 */
export function pickOdds(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const spread = (r) => num(r?.spread_home_value);
  const total = (r) => { const t = num(r?.total_value); return t != null && t > 0 ? t : null; };
  const row = list.find((r) => String(r?.vendor).toLowerCase() === 'draftkings' && (spread(r) != null || total(r) != null))
    ?? list.find((r) => spread(r) != null) ?? list.find((r) => total(r) != null) ?? null;
  if (!row) return null;
  const s = spread(row);
  const t = total(row) ?? list.map(total).find((x) => x != null) ?? null;
  return s == null && t == null ? null : { spreadHome: s, total: t };
}

/** "34-12"-style record from a standings row, or null (no games, no chip). */
export function standingRecord(rows, bdlTeamId) {
  const r = (rows ?? []).find((x) => String(x?.team?.id) === String(bdlTeamId));
  const w = num(r?.wins), l = num(r?.losses);
  if (w == null || l == null || w + l === 0) return null;
  return `${w}-${l}`;
}

// ------------------------------------------------------------- injuries

const STATUS_RANK = { out: 0, doubtful: 1, questionable: 2, probable: 3, 'day-to-day': 4 };
const STATUS_WORD = { out: 'Out', doubtful: 'Doubtful', questionable: 'Questionable', probable: 'Probable', 'day-to-day': 'Day-to-day' };

/**
 * THE NOTE: the short part of the feed's description - "Injury/Illness - Right
 * Knee Surgery (2026-10-21, DAL@HOU). Prior ..." -> "Right Knee Surgery". The
 * leading "Injury/Illness - " label is dropped, the text before " (" (or the
 * first sentence) kept, and a long sentence cut to ~80 characters on a word.
 */
export function injuryNote(description, max = 80) {
  let t = String(description ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  t = t.replace(/^[A-Za-z/ ]{3,24} - (?=\S)/, '');
  const paren = t.indexOf(' (');
  if (paren > 0) t = t.slice(0, paren);
  // The first sentence end - past a few characters, so "J. Smith" is not one.
  const dot = t.slice(8).search(/[.!?](\s|$)/);
  if (dot >= 0) t = t.slice(0, dot + 8);
  t = t.trim();
  if (!t) return null;
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 40 ? cut.lastIndexOf(' ') : cut.length).replace(/[,;:\s]+$/, '')}…`;
}

/**
 * INJURIES, per side, worst first. `sideOf` maps a provider team id to
 * 'home' | 'away'. A row with an unknown status or no name is dropped.
 * Null when neither team has anyone listed.
 */
export function shapeInjuries(rows, sideOf) {
  const out = { away: [], home: [] };
  const seen = new Set();
  for (const r of rows ?? []) {
    const side = sideOf(r?.player?.team_id);
    const word = STATUS_WORD[String(r?.status ?? '').toLowerCase()];
    const name = nameOf(r?.player);
    if (!side || !word || !name || seen.has(r.player.id)) continue;
    seen.add(r.player.id);
    out[side].push({ name, status: word, note: injuryNote(r.description) });
  }
  const rank = (e) => STATUS_RANK[e.status.toLowerCase()] ?? 9;
  for (const side of ['away', 'home']) out[side].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return out.away.length || out.home.length ? out : null;
}

/** "updated 3:42 PM PT" - the time WE fetched it (the feed carries none). */
export function updatedLabel(at) {
  const d = at instanceof Date ? at : new Date(at);
  if (!Number.isFinite(d.getTime())) return null;
  const t = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
  return `updated ${t.replace(/ /g, ' ')} PT`;
}

// ------------------------------------------------------------- lineups

const POS_ORDER = { PG: 0, G: 1, SG: 2, GF: 3, SF: 4, F: 5, PF: 6, FC: 7, C: 8 };
const posRank = (p) => POS_ORDER[String(p ?? '').toUpperCase().replace('-', '')] ?? 9;

/** One team's starters from a /lineups payload: [{ id, pos, name }], guards to centres, max 5. */
export function startersOf(rows, bdlTeamId) {
  return (rows ?? [])
    .filter((r) => r?.starter === true && String(r?.team?.id) === String(bdlTeamId) && nameOf(r?.player))
    .map((r) => ({ id: r.player.id, pos: String(r.position || r.player?.position || '').trim(), name: nameOf(r.player) }))
    .sort((a, b) => posRank(a.pos) - posRank(b.pos))
    .slice(0, 5);
}

/**
 * THE STARTING LINEUPS. `thisGame` = /lineups for this game (empty before tip);
 * `prior` = { away, home } /lineups of each team's most recent completed game.
 * "Confirmed" only when this game's lineup names five-or-so for BOTH teams;
 * otherwise "Projected" = each team's starters last time out. A side with
 * neither is not drawn; both empty = null.
 */
export function lineupsBlock({ thisGame, prior, awayBdl, homeBdl }) {
  const now = { away: startersOf(thisGame, awayBdl), home: startersOf(thisGame, homeBdl) };
  if (now.away.length && now.home.length) return { label: 'Confirmed', ...now };
  const proj = { away: startersOf(prior?.away, awayBdl), home: startersOf(prior?.home, homeBdl) };
  return proj.away.length || proj.home.length ? { label: 'Projected', ...proj } : null;
}

// ------------------------------------------------------------- season leaders

const SEASON_CATS = [['PTS', 'pts'], ['REB', 'reb'], ['AST', 'ast'], ['3PM', 'fg3m']];
const one = (v) => num(v).toFixed(1);

/**
 * SEASON LEADERS, top 3 per team per category, per game, from the feed's season
 * averages. `teamOf` maps a provider player id to 'home' | 'away' (from each
 * team's active roster). gp >= 1 is required. Same shape as nbaLeaders:
 * [{ cat, away: [{ name, line }], home: [...] }]; null when nobody qualifies.
 */
export function seasonLeaders(avgRows, teamOf) {
  const by = { away: [], home: [] };
  for (const r of avgRows ?? []) {
    const side = teamOf(r?.player?.id);
    if (!side || !(num(r?.stats?.gp) >= 1)) continue;
    by[side].push({ name: surname(nameOf(r.player)), full: nameOf(r.player), s: r.stats });
  }
  const top = (side, key) => by[side].filter((p) => (num(p.s[key]) ?? 0) > 0)
    .sort((a, b) => num(b.s[key]) - num(a.s[key]) || a.full.localeCompare(b.full)).slice(0, 3)
    .map((p) => ({ name: p.name, line: one(p.s[key]) }));
  const rows = SEASON_CATS.map(([cat, key]) => ({ cat, away: top('away', key), home: top('home', key) }))
    .filter((r) => r.away.length || r.home.length);
  return rows.length ? rows : null;
}

// ------------------------------------------------------------- last 5 and the series

/** A BDL /games row -> the finals shape lib/nba/gameDetail.js nbaTeamFinals returns, or null if not a final. */
export function finalFromGame(g) {
  if (String(g?.status_state ?? g?.status ?? '').toLowerCase() !== 'final') return null;
  const hs = num(g.home_team_score), as = num(g.visitor_team_score);
  if (hs == null || as == null || g.postponed) return null;
  return {
    key: String(g.id), bdlGameId: String(g.id), at: g.datetime ?? g.date,
    homeBdl: g.home_team?.id == null ? null : String(g.home_team.id), awayBdl: g.visitor_team?.id == null ? null : String(g.visitor_team.id),
    homeAbbr: g.home_team?.abbreviation ?? '', awayAbbr: g.visitor_team?.abbreviation ?? '', homeScore: hs, awayScore: as,
  };
}

/** The finals one team played (provider id), newest first, de-duplicated by game. */
export function finalsOf(finals, bdlTeamId) {
  const seen = new Set();
  return (finals ?? [])
    .filter((f) => (String(f.homeBdl) === String(bdlTeamId) || String(f.awayBdl) === String(bdlTeamId)) && f.homeScore !== f.awayScore)
    .filter((f) => (seen.has(f.key) ? false : (seen.add(f.key), true)))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/**
 * LAST 5 for one team: [{ win, score: '121-113' (its own score first), opp: '@DET' | 'vs BOS' }].
 * Fewer than five when fewer were played; null when none.
 */
export function last5(finals, bdlTeamId) {
  const mine = finalsOf(finals, bdlTeamId).slice(0, 5).map((f) => {
    const home = String(f.homeBdl) === String(bdlTeamId);
    const own = home ? f.homeScore : f.awayScore, theirs = home ? f.awayScore : f.homeScore;
    const opp = home ? f.awayAbbr : f.homeAbbr;
    return { win: own > theirs, score: `${own}-${theirs}`, opp: `${home ? 'vs' : '@'} ${opp}` };
  });
  return mine.length ? mine : null;
}

/**
 * THE SEASON SERIES so far: "BOS leads series 2-1" / "Series tied 1-1";
 * null when they have not played. Counts the finals between the two.
 */
export function seriesLine(finals, { awayBdl, homeBdl, awayAbbr, homeAbbr }) {
  const games = finalsOf(finals, awayBdl).filter((f) => String(f.homeBdl) === String(homeBdl) || String(f.awayBdl) === String(homeBdl));
  if (!games.length) return null;
  let a = 0, h = 0;
  for (const f of games) {
    const awayWon = String(f.homeBdl) === String(awayBdl) ? f.homeScore > f.awayScore : f.awayScore > f.homeScore;
    if (awayWon) a += 1; else h += 1;
  }
  if (a === h) return `Series tied ${a}-${h}`;
  return a > h ? `${awayAbbr} leads series ${a}-${h}` : `${homeAbbr} leads series ${h}-${a}`;
}

/** The latest completed game id for a team that we can ask /lineups about, or null. */
export function latestGameId(finals, bdlTeamId) {
  return finalsOf(finals, bdlTeamId).find((f) => f.bdlGameId)?.bdlGameId ?? null;
}
