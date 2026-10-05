// lib/teams/colourFill.js - the pure half of scripts/team-colours-fill.mjs
// (mon-22): normalise a colour, read one CFBD /teams row, and plan which teams
// get which pair. No I/O here; the script fetches, prints and writes.
//
// THE RULE IS FILL, NEVER OVERWRITE. A team is planned only when BOTH of its
// colour columns are NULL and the source has BOTH colours for it - a half pair
// would leave a row the both-NULL guard never revisits. Everything else is
// listed as unfilled with the reason, so a re-run (a new FCS opponent, a
// promoted club) shows exactly what is still missing.

/** Six hex digits, with or without the hash, any case -> hash + uppercase; anything else -> null. Same as sync.js's hexOrNull. */
export function normHex(v) {
  const s = String(v ?? '').trim();
  return /^#?[0-9a-f]{6}$/i.test(s) ? `#${s.replace('#', '').toUpperCase()}` : null;
}

/** One CFBD /teams row -> { key, name, primary, secondary } keyed on the CFBD id as a string. */
export function cfbdColourRow(t) {
  return {
    key: t?.id == null ? null : String(t.id),
    name: t?.school ?? null,
    primary: normHex(t?.color),
    secondary: normHex(t?.alternateColor),
  };
}

/** CFBD /teams payload -> Map(cfbd id -> { primary, secondary, source }). */
export function cfbdColourMap(rows) {
  const out = new Map();
  for (const r of rows ?? []) {
    const c = cfbdColourRow(r);
    if (!c.key) continue;
    out.set(c.key, { primary: c.primary, secondary: c.secondary, source: `CFBD /teams id ${c.key} (${c.name})` });
  }
  return out;
}

/** EPL_COLORS (slug -> {primary, secondary, source}) -> Map(slug -> { primary, secondary, source }). */
export function staticColourMap(table, label) {
  const out = new Map();
  for (const [slug, c] of Object.entries(table)) {
    out.set(slug, { primary: normHex(c.primary), secondary: normHex(c.secondary), source: `${label}: ${c.source}${c.flag ? ` [FLAG: ${c.flag}]` : ''}` });
  }
  return out;
}

/**
 * teams: [{ id, name, color_primary, color_secondary, key }] for one league
 * (key = the join value: cfbd_team_id or slug). colours: Map(key -> pair).
 * -> { fills: [{ id, name, primary, secondary, source }], unfilled: [{ id, name, key, reason }], alreadyColoured }
 */
export function planColourFill(teams, colours) {
  const fills = []; const unfilled = []; let alreadyColoured = 0;
  for (const t of teams) {
    if (t.color_primary != null || t.color_secondary != null) { alreadyColoured += 1; continue; }
    const c = t.key == null ? null : colours.get(String(t.key));
    if (!c) { unfilled.push({ id: t.id, name: t.name, key: t.key ?? null, reason: t.key == null ? 'no join key' : 'not in source' }); continue; }
    if (!c.primary || !c.secondary) {
      unfilled.push({ id: t.id, name: t.name, key: t.key, reason: `source lacks ${!c.primary && !c.secondary ? 'both colours' : !c.primary ? 'primary' : 'secondary'}` });
      continue;
    }
    fills.push({ id: t.id, name: t.name, primary: c.primary, secondary: c.secondary, source: c.source });
  }
  return { fills, unfilled, alreadyColoured };
}
