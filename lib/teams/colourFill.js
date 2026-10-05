// lib/teams/colourFill.js - the pure half of scripts/team-colours-fill.mjs
// (mon-22): normalise a colour, read one CFBD /teams row, and plan which teams
// get which pair. No I/O here; the script fetches, prints and writes.
//
// THE RULE IS FILL, NEVER OVERWRITE. A team is planned only when BOTH of its
// colour columns are NULL. PRIMARY-ONLY IS ALLOWED (mon-24 ruling 1): when the
// source has a primary and no secondary, the primary is written and the
// secondary stays NULL - every reader treats that as "no colours" and draws
// the abbreviation disc with its ring (lib/gridiron/readers.js teamColors(),
// the team mark component), so nothing is half-dressed. The row is then no
// longer both-NULL, so a later run never revisits it - by design.
// A source with NO primary falls through to the optional static fallback
// (lib/cfb/teamColors.js: full pairs only). Everything else is listed as
// unfilled with the reason, so a re-run (a new FCS opponent, a promoted club)
// shows exactly what is still missing.

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
 * fallback: Map(key -> full pair), used only when `colours` has no primary.
 * -> { fills: [{ id, name, primary, secondary (may be null), source, primaryOnly }],
 *      unfilled: [{ id, name, key, reason }], alreadyColoured }
 */
/** True for black in any spelling normHex accepts - written without a colour literal. */
const isBlack = (v) => /^#?0{6}$/.test(String(v ?? '').trim());

export function planColourFill(teams, colours, { fallback = null } = {}) {
  const fills = []; const unfilled = []; let alreadyColoured = 0;
  for (const t of teams) {
    if (t.color_primary != null || t.color_secondary != null) { alreadyColoured += 1; continue; }
    if (t.key == null) { unfilled.push({ id: t.id, name: t.name, key: null, reason: 'no join key' }); continue; }
    const c = colours.get(String(t.key)) ?? null;
    // A PRIMARY-ONLY BLACK IS NOT STORED (mon-25). CFBD gives pure black with no
    // alternate for 9 FCS schools - a placeholder for North Alabama (purple and
    // gold) and Utah Tech (red), not a colour. Those stay empty for a later
    // reviewed fix; a black that comes WITH a secondary is a real pair and is kept.
    if (c?.primary && !c.secondary && isBlack(c.primary)) {
      unfilled.push({ id: t.id, name: t.name, key: t.key, reason: 'primary-only black (CFBD placeholder) - left for review' });
      continue;
    }
    if (c?.primary) {
      fills.push({ id: t.id, name: t.name, primary: c.primary, secondary: c.secondary ?? null, source: c.source, primaryOnly: !c.secondary });
      continue;
    }
    const f = fallback?.get(String(t.key)) ?? null;
    if (f?.primary && f?.secondary) {
      fills.push({ id: t.id, name: t.name, primary: f.primary, secondary: f.secondary, source: f.source, primaryOnly: false });
      continue;
    }
    unfilled.push({ id: t.id, name: t.name, key: t.key, reason: !c ? 'not in source' : 'source has no primary' });
  }
  return { fills, unfilled, alreadyColoured };
}
