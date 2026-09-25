// lib/mlb/probables.js - probable starters from BallDontLie, in the shape
// metadata.probables has always held: { away: {id, name} | null,
// home: {id, name} | null }, or null when neither side has announced.
//
// THE SOURCE IS BDL's /mlb/v1/lineups. Before the batting order is posted it
// carries one row per club with is_probable_pitcher = true (position SP); after
// posting, the nine batters join it. Measured 25 Sep 2026 against the statsapi
// probables the poller had written on PROD: 84 of 86 starters identical, none
// different, 2 missing on BDL (one game). And BDL LEADS - it had 26 of 28 of the
// next day's scheduled games announced while statsapi's had none written yet.
//
// THE ID IS NOW A BDL PLAYER ID. It used to be an MLBAM id, which lib/october/
// pool.js compared against BDL roster ids and could therefore never match (the
// name fallback carried it). Same key, same place, the id that pool holds.
//
// matchKey and pickByKickoff moved here from lib/mlb/statsapi.js unchanged in
// behaviour: the Run and October builders key a day's probables by
// (day, away, home) and a doubleheader is a LIST under one key.

const BDL = 'https://api.balldontlie.io';

/** `${day}:${AWAY}@${HOME}`, or null when any part is missing. */
export function matchKey(awayAbbr, homeAbbr, day) {
  if (!awayAbbr || !homeAbbr || !day) return null;
  return `${String(day).slice(0, 10)}:${String(awayAbbr).toUpperCase()}@${String(homeAbbr).toUpperCase()}`;
}

/**
 * WHICH HALF OF A DOUBLEHEADER IS OUR ROW. The one candidate, or NULL - and
 * null is a real answer the callers print rather than paper over.
 *
 * One candidate is the answer without a clock. With several, the first pitch
 * decides, and only clearly: the nearest wins IF it is inside `toleranceMin`
 * AND the runner-up is at least `marginMin` further away. A pair we cannot
 * separate by an hour is a pair we do not understand.
 */
export function pickByKickoff(candidates, kickoffIso, { toleranceMin = 180, marginMin = 60 } = {}) {
  const list = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  const t = kickoffIso == null ? NaN : Date.parse(kickoffIso);
  if (!Number.isFinite(t)) return null;
  const scored = list
    .map((g) => ({ g, d: Math.abs(Date.parse(g.gameDate ?? '') - t) }))
    .filter((x) => Number.isFinite(x.d))
    .sort((a, b) => a.d - b.d);
  if (!scored.length) return null;
  if (scored[0].d > toleranceMin * 60_000) return null;
  if (scored.length > 1 && scored[1].d - scored[0].d < marginMin * 60_000) return null;
  return scored[0].g;
}

/**
 * PURE. One game's /lineups rows -> probables, by the club abbreviation on
 * each row. A PARTIAL answer is kept: one club announcing hours before the
 * other is the normal state, and dropping it would keep an announced starter
 * unannounced until his opponent announced too.
 */
export function probablesFromLineupRows(rows, { awayAbbr, homeAbbr } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const one = (abbr) => {
    if (!abbr) return null;
    const r = list.find((x) => x?.is_probable_pitcher === true
      && String(x?.team?.abbreviation ?? '').toUpperCase() === String(abbr).toUpperCase());
    const name = r?.player?.full_name
      ?? [r?.player?.first_name, r?.player?.last_name].filter(Boolean).join(' ');
    if (r?.player?.id == null || !name) return null;
    return { id: String(r.player.id), name: String(name) };
  };
  const away = one(awayAbbr); const home = one(homeAbbr);
  if (!away && !home) return null;
  return { away, home };
}

async function bdlGet(path, { key = process.env.BDL_API_KEY, fetchImpl = fetch } = {}) {
  if (!key) throw new Error('BDL_API_KEY is not set');
  const res = await fetchImpl(`${BDL}${path}`, { headers: { Authorization: key } });
  if (!res.ok) throw new Error(`BDL ${path.split('?')[0]} -> ${res.status}`);
  return res.json();
}

/** Every /lineups row for these BDL game ids, walking the cursor. */
export async function fetchLineupRows(gameIds, opts = {}) {
  const ids = [...new Set((gameIds ?? []).filter((x) => x != null).map(String))];
  const out = [];
  for (let i = 0; i < ids.length; i += 25) {
    const q = ids.slice(i, i + 25).map((id) => `game_ids[]=${encodeURIComponent(id)}`).join('&');
    let cursor = null;
    do {
      const j = await bdlGet(`/mlb/v1/lineups?${q}&per_page=100${cursor ? `&cursor=${cursor}` : ''}`, opts);
      out.push(...(j?.data ?? []));
      cursor = j?.meta?.next_cursor ?? null;
    } while (cursor);
  }
  return out;
}

/** One game's probables, for a caller holding our row's BDL id and clubs. */
export async function probablesForGame(bdlGameId, { awayAbbr, homeAbbr }, opts = {}) {
  if (bdlGameId == null) return null;
  const rows = await fetchLineupRows([bdlGameId], opts);
  return probablesFromLineupRows(rows, { awayAbbr, homeAbbr });
}

/**
 * One UTC day's games, keyed the way a caller holding OUR rows finds them:
 * Map(matchKey -> [{ bdlGameId, gameDate, probables }]), only keys with at
 * least one announced side. The day is the UTC day of the first pitch - the
 * same day the callers take off our own kickoff_at, which is BDL's own time.
 * BDL's dates[] filter is a calendar the provider owns, so the neighbours are
 * asked too and the answer is cut to the requested UTC day here.
 */
export async function probablesByMatch(dayIso, opts = {}) {
  const day = String(dayIso).slice(0, 10);
  const t = Date.parse(`${day}T00:00:00Z`);
  const around = [-1, 0, 1].map((d) => new Date(t + d * 86_400_000).toISOString().slice(0, 10));
  const g = await bdlGet(`/mlb/v1/games?${around.map((d) => `dates[]=${d}`).join('&')}&per_page=100`, opts);
  const games = (g?.data ?? []).filter((x) => String(x?.date ?? '').slice(0, 10) === day);
  const out = new Map();
  if (!games.length) return out;
  const rows = await fetchLineupRows(games.map((x) => x.id), opts);
  const byGame = new Map();
  for (const r of rows) {
    const k = String(r?.game_id);
    if (!byGame.has(k)) byGame.set(k, []);
    byGame.get(k).push(r);
  }
  for (const x of games) {
    const awayAbbr = x?.away_team?.abbreviation; const homeAbbr = x?.home_team?.abbreviation;
    const probables = probablesFromLineupRows(byGame.get(String(x.id)) ?? [], { awayAbbr, homeAbbr });
    const key = matchKey(awayAbbr, homeAbbr, day);
    if (!key || !probables) continue;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push({ bdlGameId: String(x.id), gameDate: x.date ?? null, probables });
  }
  return out;
}
