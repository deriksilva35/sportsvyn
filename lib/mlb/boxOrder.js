// lib/mlb/boxOrder.js - the batting table in BATTING ORDER (tue-9 D). PURE.
//
// WHY. mlb_player_game_stats carries no batting-order field, and its
// `position` is the player's ROSTER DEFAULT, not tonight's: 6 Oct LAD@ATL
// printed the Braves with two LF (Thomas, Dubon) and no DH, alphabetised by
// first name. The game's own order and positions are in matches.metadata.lineups
// (BDL /mlb/v1/lineups: order 1-9, position as posted), so the nine come from
// there.
//
// SUBSTITUTES. /lineups lists only the starting nine. BDL's play-by-play
// announces pinch hitters and runners as "Pham hit for Peters" / "McCray ran
// for Davidson" (surnames only), so a sub is placed directly under the man he
// replaced, as PH or PR. BDL sends NO defensive-replacement event, so a sub
// the plays never name goes to the foot of his club's list labelled "sub" -
// that is the provider's limit, and no second source is used (tue-10).

const strip = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** "B. Montgomery" -> { initial: 'b', last: 'montgomery' }; "Acuña Jr." -> { last: 'acuna jr.' } */
function nameKey(s) {
  const t = strip(s);
  const m = /^([a-z])\.\s+(.+)$/.exec(t);
  return m ? { initial: m[1], last: m[2] } : { initial: null, last: t };
}

/** Does a full player_name match a play-text surname (with optional initial)? */
function matches(fullName, key) {
  const n = strip(fullName);
  if (!(n === key.last || n.endsWith(` ${key.last}`))) return false;
  return key.initial == null || n.startsWith(key.initial);
}

/** Play texts -> [{ sub, replaced, kind: 'PH'|'PR' }], in play order. */
export function parseSubs(texts = []) {
  const out = [];
  for (const t of texts) {
    const m = /^\s*(.+?)\s+(hit|ran) for\s+(.+?)\.?\s*$/.exec(String(t ?? ''));
    if (m) out.push({ sub: m[1], replaced: m[3], kind: m[2] === 'hit' ? 'PH' : 'PR' });
  }
  return out;
}

/**
 * @param hitters   splitBox().hitters (any order)
 * @param lineups   matches.metadata.lineups { away: [{id, order, position}], home: [...] }
 * @param subTexts  play texts in play order (only "X hit for Y" / "X ran for Y" are read)
 * @param teams     { awayId, homeId }
 * @returns hitters in order; each row gains { order, sub } and `position` is THIS game's.
 *          With no posted lineup for a club its rows keep their incoming order.
 */
export function orderHitters(hitters = [], lineups = null, subTexts = [], { awayId = null, homeId = null } = {}) {
  const subs = parseSubs(subTexts);
  const out = [];
  for (const [side, teamId] of [['away', awayId], ['home', homeId]]) {
    const rows = hitters.filter((r) => r.team_id === teamId);
    const nine = Array.isArray(lineups?.[side]) ? lineups[side] : [];
    if (!nine.length) { out.push(...rows.map((r) => ({ ...r, order: null, sub: false }))); continue; }
    const byId = new Map(nine.map((l) => [String(l.id), l]));
    const starters = rows.filter((r) => byId.has(String(r.bdl_player_id)))
      .map((r) => ({ ...r, order: Number(byId.get(String(r.bdl_player_id)).order), position: byId.get(String(r.bdl_player_id)).position ?? r.position, sub: false }))
      .sort((a, b) => a.order - b.order);
    const bench = rows.filter((r) => !byId.has(String(r.bdl_player_id)));
    // replacedId -> [sub rows], following chains (a PH for a PH).
    const placed = new Map();
    const used = new Set();
    const pool = [...starters];
    for (const s of subs) {
      const rk = nameKey(s.replaced); const sk = nameKey(s.sub);
      const replaced = pool.find((r) => matches(r.player_name, rk));
      const sub = bench.find((r) => !used.has(String(r.bdl_player_id)) && matches(r.player_name, sk));
      if (!replaced || !sub) continue;
      used.add(String(sub.bdl_player_id));
      const row = { ...sub, order: replaced.order, position: s.kind, sub: true };
      const k = String(replaced.bdl_player_id);
      if (!placed.has(k)) placed.set(k, []);
      placed.get(k).push(row);
      pool.push(row);
    }
    const emit = (r) => { out.push(r); for (const c of placed.get(String(r.bdl_player_id)) ?? []) emit(c); };
    starters.forEach(emit);
    // NO EVENT, NO GUESS (tue-10): a sub the plays never name is labelled "sub" -
    // his roster position would claim a spot in the field nobody reported.
    for (const r of bench) if (!used.has(String(r.bdl_player_id))) out.push({ ...r, order: null, sub: true, position: 'sub' });
  }
  // A ROW ON NEITHER CLUB (should not happen) is kept, not dropped.
  for (const r of hitters) if (r.team_id !== awayId && r.team_id !== homeId) out.push({ ...r, order: null, sub: false });
  return out;
}
