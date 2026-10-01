// lib/soccer/eplDedupe.js - one row per EPL fixture (thu-24).
//
// WHY THERE ARE TWO. The fixture sync keyed rows on a slug that carries the
// kickoff DATE (leeds-vs-crystal-palace-2026-09-19), so a fixture the league
// moved by a day was INSERTED again under its new slug and the old row stayed
// behind - 'scheduled', in the past, forever. 35 pairs on PROD on 1 Oct, two
// of them (24647, 24649) already stale on /scores' window. The sync now finds a
// row by its provider fixture id first (lib/soccer/epl.js), so no new pair can
// form; this removes the ones that did.
//
// WHICH ROW STAYS. The one the provider currently returns: the daily sync
// upserts the CURRENT slug every run and never touches the abandoned one, so
// the row with the newest data_provider_synced_at is the provider's (id breaks
// a tie). Everything else in the pair is STALE.
//
// REFERENCES, per foreign-key table, read from pg_constraint rather than a
// list that rots:
//   - the kept row has NONE in that table -> the stale row's rows MOVE to it
//     (UPDATE match_id), so nothing is lost and no unique key can collide;
//   - the kept row has its own -> the stale row's rows are DROPPED with it
//     (ON DELETE CASCADE): they describe the abandoned kickoff, e.g. the
//     odds_markets history of the 19 Sep slot of a match played on the 20th;
//   - ON DELETE SET NULL (articles) is left to the database;
//   - ON DELETE RESTRICT (survivor_picks) REFUSES the pair, as does any soft
//     reference a foreign key cannot see: a contest or entry whose jsonb names
//     the stale id (tags cannot name a match: entity_type is team|player). A refused pair is reported, never forced.
//
// Dry run by default (scripts/epl-dedupe-fixtures.mjs); every write is gated
// on `apply`.

/** EPL rows that share a provider fixture id, grouped, kept row first. */
export async function findEplDuplicates(sql, { season = 2026 } = {}) {
  const rows = await sql`
    SELECT m.id, m.slug, m.status, m.kickoff_at, m.data_provider_synced_at, m.created_at,
           m.external_ids->>'api_sports' AS fixture
      FROM matches m JOIN leagues l ON l.id = m.league_id
     WHERE l.slug = 'epl' AND m.season_year = ${season}
       AND m.external_ids->>'api_sports' IS NOT NULL
       AND m.external_ids->>'api_sports' IN (
         SELECT m2.external_ids->>'api_sports' FROM matches m2 JOIN leagues l2 ON l2.id = m2.league_id
          WHERE l2.slug = 'epl' AND m2.season_year = ${season}
          GROUP BY 1 HAVING count(*) > 1)
     ORDER BY m.external_ids->>'api_sports', m.data_provider_synced_at DESC NULLS LAST, m.id DESC`;
  return groupPairs(rows);
}

/** PURE. Rows ordered (fixture, synced desc, id desc) -> [{ fixture, keep, stale[] }]. */
export function groupPairs(rows) {
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.fixture)) by.set(r.fixture, []);
    by.get(r.fixture).push(r);
  }
  return [...by.entries()].map(([fixture, list]) => {
    const sorted = [...list].sort(keptFirst);
    return { fixture, keep: sorted[0], stale: sorted.slice(1) };
  });
}

const t = (v) => (v == null ? -Infinity : new Date(v).getTime());
/** The provider's row first: newest sync, then the higher id. */
export function keptFirst(a, b) {
  return (t(b.data_provider_synced_at) - t(a.data_provider_synced_at)) || (Number(b.id) - Number(a.id));
}

/** Every FK into matches(id): [{ table, column, onDelete: 'c'|'n'|'r'|'a'|'d' }]. */
export async function matchForeignKeys(sql) {
  const rows = await sql`
    SELECT c.conrelid::regclass::text AS tbl, a.attname AS col, c.confdeltype AS del
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
     WHERE c.contype = 'f' AND c.confrelid = 'matches'::regclass
     ORDER BY 1, 2`;
  return rows.map((r) => ({ table: r.tbl, column: r.col, onDelete: r.del }));
}

const IDENT = /^[a-z_][a-z0-9_.]*$/;
const countRefs = async (sql, fk, id) => {
  if (!IDENT.test(fk.table) || !IDENT.test(fk.column)) throw new Error(`eplDedupe: odd identifier ${fk.table}.${fk.column}`);
  const r = await sql.query(`SELECT count(*)::int AS n FROM ${fk.table} WHERE ${fk.column} = $1`, [id]);
  return r[0]?.n ?? 0;
};

/** Soft references a foreign key cannot see. Any hit refuses the pair. */
export async function softRefs(sql, id) {
  const needle = `"match_id": ${Number(id)}`;
  const needle2 = `"match_id":${Number(id)}`;
  const contests = await sql`
    SELECT count(*)::int AS n FROM contests c
     WHERE strpos(c::text, ${needle}) > 0 OR strpos(c::text, ${needle2}) > 0`;
  const entries = await sql`
    SELECT count(*)::int AS n FROM contest_entries e
     WHERE strpos(e::text, ${needle}) > 0 OR strpos(e::text, ${needle2}) > 0`;
  const out = {};
  if (contests[0].n) out.contests = contests[0].n;
  if (entries[0].n) out.contest_entries = entries[0].n;
  return out;
}

/**
 * The plan for one pair: per stale row, what moves, what is dropped, and
 * whether it is refused. Reads only.
 */
export async function planPair(sql, pair, fks) {
  const stale = [];
  for (const s of pair.stale) {
    const move = []; const drop = []; const nulled = []; const refuse = [];
    for (const fk of fks) {
      const n = await countRefs(sql, fk, s.id);
      if (!n) continue;
      if (fk.onDelete === 'r' || fk.onDelete === 'a') { refuse.push(`${fk.table}: ${n} (restrict)`); continue; }
      if (fk.onDelete === 'n') { nulled.push({ ...fk, n }); continue; }
      const kept = await countRefs(sql, fk, pair.keep.id);
      if (kept === 0) move.push({ ...fk, n }); else drop.push({ ...fk, n, keptHas: kept });
    }
    const soft = await softRefs(sql, s.id);
    for (const [k, n] of Object.entries(soft)) refuse.push(`${k}: ${n} (soft reference)`);
    stale.push({ row: s, move, drop, nulled, refuse });
  }
  return { fixture: pair.fixture, keep: pair.keep, stale };
}

/** Apply one planned pair: move, then delete the stale row. Refused rows are skipped. */
export async function applyPair(sql, plan) {
  const done = [];
  for (const s of plan.stale) {
    if (s.refuse.length) { done.push({ id: s.row.id, refused: s.refuse }); continue; }
    const qs = s.move.map((m) => sql.query(
      `UPDATE ${m.table} SET ${m.column} = $1 WHERE ${m.column} = $2`, [plan.keep.id, s.row.id]));
    // The row goes only if it is STILL the stale twin of the kept one - a
    // second run, or a sync between plan and apply, deletes nothing it should not.
    qs.push(sql`
      DELETE FROM matches WHERE id = ${s.row.id}
         AND external_ids->>'api_sports' = ${String(plan.fixture)}
         AND EXISTS (SELECT 1 FROM matches k WHERE k.id = ${plan.keep.id}
                      AND k.external_ids->>'api_sports' = ${String(plan.fixture)})`);
    await sql.transaction(qs);
    done.push({ id: s.row.id, moved: s.move.map((m) => `${m.table} ${m.n}`), dropped: s.drop.map((d) => `${d.table} ${d.n}`) });
  }
  return done;
}

/** The whole job. `apply` false is a dry run that writes nothing. */
export async function dedupeEpl(sql, { season = 2026, apply = false } = {}) {
  const pairs = await findEplDuplicates(sql, { season });
  const fks = await matchForeignKeys(sql);
  const plans = [];
  for (const p of pairs) plans.push(await planPair(sql, p, fks));
  const results = apply ? [] : null;
  if (apply) for (const p of plans) results.push({ fixture: p.fixture, keep: p.keep.id, done: await applyPair(sql, p) });
  return { pairs: plans.length, staleRows: plans.reduce((a, p) => a + p.stale.length, 0), plans, results };
}

/** One line per pair, for the script and the report. */
export function describePlan(p) {
  const d = (r) => `${r.id} ${r.slug} ${r.status} ${new Date(r.kickoff_at).toISOString().slice(0, 16)}Z`;
  const lines = [`fixture ${p.fixture}: KEEP ${d(p.keep)}`];
  for (const s of p.stale) {
    const bits = [
      s.move.length ? `move ${s.move.map((m) => `${m.table} ${m.n}`).join(', ')}` : null,
      s.drop.length ? `drop ${s.drop.map((m) => `${m.table} ${m.n}`).join(', ')}` : null,
      s.nulled.length ? `null ${s.nulled.map((m) => `${m.table} ${m.n}`).join(', ')}` : null,
      s.refuse.length ? `REFUSED ${s.refuse.join('; ')}` : null,
    ].filter(Boolean);
    lines.push(`    stale ${d(s.row)}${bits.length ? ` - ${bits.join(' / ')}` : ' - no references'}`);
  }
  return lines.join('\n');
}
