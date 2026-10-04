// lib/migrations/verify.mjs - "is this migration's work actually on the
// database?", asked of the catalog, never of the data. Used once, by
// scripts/migrations-backfill.mjs, before it writes ledger rows for
// migrations that ran before the ledger existed.
//
// PARSE. Each file is read for the objects it leaves behind: tables (and the
// columns a CREATE TABLE lists), ADD COLUMN, named ADD CONSTRAINT, indexes,
// functions, triggers, views, types, sequences, extensions, ALTER COLUMN
// SET/DROP NOT NULL - and for what it removes: DROP TABLE/COLUMN/CONSTRAINT/
// INDEX/..., RENAME. Statements inside DO $$ ... $$ guards are read too (082
// adds its constraint from one). INSERT/UPDATE/DELETE are data: nothing in the
// catalog proves they ran.
//
// SUPERSESSION. A migration's object is checked against the state the LAST
// migration to touch it leaves. 055 drops an index an earlier file made; 122
// drops and re-adds constraints. An event that a later file reverses is
// "superseded by NNN" and is not looked for; an object on a table a later
// file drops goes with it.
//
// VERDICT per migration:
//   verified      every checked object is in the state the files say
//   missing       none of them is
//   partial       some are and some are not
//   unverifiable  nothing checkable (pure data, or only superseded objects):
//                 "assumed applied", and listed for a human

import { analysisFragments } from './sqlLex.mjs';

// ---------------------------------------------------------------------------
// Parsing.
// ---------------------------------------------------------------------------

const IDENT = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)`;
const QNAME = String.raw`${IDENT}(?:\s*\.\s*${IDENT})?`;

export function normName(raw) {
  if (!raw) return raw;
  const parts = raw.split(/\s*\.\s*(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  const last = parts[parts.length - 1];
  const schema = parts.length > 1 ? parts[0] : null;
  const fix = (p) => (p.startsWith('"') ? p.slice(1, -1).replace(/""/g, '"') : p.toLowerCase());
  const name = fix(last);
  if (schema && fix(schema) !== 'public') return `${fix(schema)}.${name}`;
  return name;
}

function splitTopCommas(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function balancedParen(s, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** Collapse whitespace so a comment compares the same however it was wrapped. */
export function normComment(s) {
  return s == null ? null : String(s).replace(/\s+/g, ' ').trim();
}

function parseLiteral(s) {
  // One or more adjacent '...' literals ('' escapes a quote), or NULL.
  const t = s.trim();
  if (/^NULL$/i.test(t)) return { value: null };
  let i = 0;
  let value = '';
  let any = false;
  while (i < t.length) {
    while (t[i] === ' ') i++;
    if (i >= t.length) break;
    if (t[i] !== "'") return null;
    let j = i + 1;
    while (j < t.length) {
      if (t[j] === "'") { if (t[j + 1] === "'") { value += "'"; j += 2; continue; } break; }
      value += t[j];
      j++;
    }
    if (j >= t.length) return null;
    any = true;
    i = j + 1;
  }
  return any ? { value } : null;
}

/** COMMENT ON TABLE/COLUMN/CONSTRAINT with its literal -> a 'comment' event, or null. */
export function parseComment(rawFrag) {
  let m = new RegExp(String.raw`^COMMENT\s+ON\s+TABLE\s+(${QNAME})\s+IS\s+([\s\S]*)$`, 'i').exec(rawFrag);
  let target;
  if (m) target = { kind: 'comment', name: normName(m[1]), table: null, sub: 'table', lit: m[2] };
  if (!m && (m = new RegExp(String.raw`^COMMENT\s+ON\s+COLUMN\s+(${IDENT})\s*\.\s*(${IDENT})\s+IS\s+([\s\S]*)$`, 'i').exec(rawFrag))) {
    target = { kind: 'comment', name: normName(m[2]), table: normName(m[1]), sub: 'column', lit: m[3] };
  }
  if (!m && (m = new RegExp(String.raw`^COMMENT\s+ON\s+CONSTRAINT\s+(${IDENT})\s+ON\s+(${QNAME})\s+IS\s+([\s\S]*)$`, 'i').exec(rawFrag))) {
    target = { kind: 'comment', name: normName(m[1]), table: normName(m[2]), sub: 'constraint', lit: m[3] };
  }
  if (!target) return null;
  const lit = parseLiteral(target.lit);
  if (!lit) return null;
  const key = `comment:${target.sub}:${target.table ? `${target.table}.` : ''}${target.name}`;
  return { key, kind: 'comment', sub: target.sub, name: target.name, table: target.table, expect: normComment(lit.value) };
}

const CONTROL_PREFIX = new RegExp(
  String.raw`^(?:DO|BEGIN|DECLARE\b.*?\bBEGIN|ELSE|ELSIF\b.*?\bTHEN|IF\b.*?\bTHEN|THEN|LOOP|FOR\b.*?\bLOOP|EXCEPTION\b.*?\bTHEN|WHEN\b.*?\bTHEN)\b\s*`,
  'i'
);
const CONTROL_ONLY = /^(?:DO|BEGIN(?:\s+(?:WORK|TRANSACTION))?|START\s+TRANSACTION|COMMIT|END(?:\s+(?:IF|LOOP|CASE))?|ROLLBACK|RETURN\b.*|LANGUAGE\s+\w+.*|RAISE\b.*|PERFORM\b.*|NULL|SET\s+(?:LOCAL\s+)?[a-z_.]+\s*(?:=|TO)\b.*|RESET\b.*|ANALYZE\b.*|AS)$/i;

/**
 * @returns {{ events: Event[], data: string[], comments: number, unchecked: string[], unrecognized: string[] }}
 *   Event = { key, kind, table?, expect: 'present'|'absent'|'NULL'|'NOT NULL', text }
 */
export function parseMigration(sqlText) {
  const events = [];
  const data = [];
  const unchecked = [];
  const unrecognized = [];
  let comments = 0;

  const ev = (kind, name, expect, text, table = null) => {
    const key = table ? `${kind}:${table}.${name}` : `${kind}:${name}`;
    events.push({ key, kind, name, table, expect, text: text.slice(0, 100) });
  };

  const blanked = analysisFragments(sqlText);
  const raw = analysisFragments(sqlText, { keepStrings: true });
  if (raw.length !== blanked.length) throw new Error('parseMigration: fragment streams disagree');
  for (let fi = 0; fi < blanked.length; fi++) {
    let frag = blanked[fi];
    let prev;
    do { prev = frag; frag = frag.replace(CONTROL_PREFIX, ''); } while (frag !== prev && frag);
    if (!frag || CONTROL_ONLY.test(frag)) continue;
    let m;

    if (/^COMMENT\s+ON\b/i.test(frag)) {
      comments++;
      const c = parseComment(raw[fi]);
      if (c) events.push({ ...c, text: frag.slice(0, 100) });
      continue;
    }
    if (/^(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE|WITH|SELECT|MERGE\s+INTO|VALUES)\b/i.test(frag)) { data.push(frag.slice(0, 100)); continue; }

    if ((m = new RegExp(String.raw`^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(${QNAME})\s+ON\s+(?:ONLY\s+)?(${QNAME})`, 'i').exec(frag))) {
      events.push({ key: `index:${normName(m[1])}`, kind: 'index', name: normName(m[1]), table: normName(m[2]), expect: 'present', text: frag.slice(0, 100), onTable: normName(m[2]) });
      continue;
    }
    if (/^CREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(frag)) { unchecked.push(`unnamed index: ${frag.slice(0, 80)}`); continue; }

    if ((m = new RegExp(String.raw`^CREATE\s+(?:(?:GLOBAL\s+|LOCAL\s+)?(?:TEMP|TEMPORARY)\s+|UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(${QNAME})\s*`, 'i').exec(frag))) {
      const table = normName(m[1]);
      ev('table', table, 'present', frag);
      const rest = frag.slice(m[0].length);
      if (rest.startsWith('(')) {
        const close = balancedParen(rest, 0);
        const body = rest.slice(1, close === -1 ? undefined : close);
        for (const item of splitTopCommas(body)) {
          if (/^(?:CONSTRAINT|PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY|EXCLUDE|LIKE)\b/i.test(item)) {
            const c = new RegExp(String.raw`^CONSTRAINT\s+(${IDENT})`, 'i').exec(item);
            if (c) ev('constraint', normName(c[1]), 'present', item, table);
            else if (/^PRIMARY\s+KEY\b/i.test(item)) ev('constraint', `${table}_pkey`, 'present', item, table);
            continue;
          }
          const col = new RegExp(String.raw`^(${IDENT})`).exec(item);
          if (col) {
            ev('column', normName(col[1]), 'present', item, table);
            if (/\bNOT\s+NULL\b/i.test(item) || /\bPRIMARY\s+KEY\b/i.test(item)) ev('nullable', normName(col[1]), 'NOT NULL', item, table);
            if (/\bPRIMARY\s+KEY\b/i.test(item) && !/\bCONSTRAINT\b/i.test(item)) ev('constraint', `${table}_pkey`, 'present', item, table);
          }
        }
      } else {
        unchecked.push(`table ${table} columns (no column list): ${frag.slice(0, 80)}`);
      }
      continue;
    }

    if ((m = new RegExp(String.raw`^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(${QNAME})\s+`, 'i').exec(frag))) {
      const table = normName(m[1]);
      const rest = frag.slice(m[0].length);
      let r;
      if ((r = new RegExp(String.raw`^RENAME\s+TO\s+(${IDENT})`, 'i').exec(rest))) {
        ev('table', table, 'absent', frag);
        ev('table', normName(r[1]), 'present', frag);
        continue;
      }
      for (const action of splitTopCommas(rest)) {
        let a;
        if ((a = new RegExp(String.raw`^ADD\s+CONSTRAINT\s+(${IDENT})`, 'i').exec(action))) { ev('constraint', normName(a[1]), 'present', action, table); continue; }
        // An unnamed PRIMARY KEY is always named <table>_pkey by Postgres (039
        // drops user_dashboards_pkey and adds an unnamed one back).
        if (/^ADD\s+PRIMARY\s+KEY\b/i.test(action)) { ev('constraint', `${table}_pkey`, 'present', action, table); continue; }
        if (/^ADD\s+(?:PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY|EXCLUDE)\b/i.test(action)) { unchecked.push(`unnamed constraint on ${table}: ${action.slice(0, 60)}`); continue; }
        if ((a = new RegExp(String.raw`^ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(${IDENT})`, 'i').exec(action))) {
          ev('column', normName(a[1]), 'present', action, table);
          if (/\bNOT\s+NULL\b/i.test(action) || /\bPRIMARY\s+KEY\b/i.test(action)) ev('nullable', normName(a[1]), 'NOT NULL', action, table);
          continue;
        }
        if ((a = new RegExp(String.raw`^DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?(${IDENT})`, 'i').exec(action))) { ev('constraint', normName(a[1]), 'absent', action, table); continue; }
        if ((a = new RegExp(String.raw`^DROP\s+(?:COLUMN\s+)?(?:IF\s+EXISTS\s+)?(${IDENT})`, 'i').exec(action))) { ev('column', normName(a[1]), 'absent', action, table); continue; }
        if ((a = new RegExp(String.raw`^ALTER\s+(?:COLUMN\s+)?(${IDENT})\s+(SET|DROP)\s+NOT\s+NULL`, 'i').exec(action))) {
          ev('column', normName(a[1]), 'present', action, table);
          ev('nullable', normName(a[1]), a[2].toUpperCase() === 'SET' ? 'NOT NULL' : 'NULL', action, table);
          continue;
        }
        if ((a = new RegExp(String.raw`^ALTER\s+(?:COLUMN\s+)?(${IDENT})\s+`, 'i').exec(action))) {
          ev('column', normName(a[1]), 'present', action, table);
          unchecked.push(`column change on ${table}: ${action.slice(0, 60)}`);
          continue;
        }
        if ((a = new RegExp(String.raw`^RENAME\s+CONSTRAINT\s+(${IDENT})\s+TO\s+(${IDENT})`, 'i').exec(action))) {
          ev('constraint', normName(a[1]), 'absent', action, table);
          ev('constraint', normName(a[2]), 'present', action, table);
          continue;
        }
        if ((a = new RegExp(String.raw`^RENAME\s+(?:COLUMN\s+)?(${IDENT})\s+TO\s+(${IDENT})`, 'i').exec(action))) {
          ev('column', normName(a[1]), 'absent', action, table);
          ev('column', normName(a[2]), 'present', action, table);
          continue;
        }
        if ((a = new RegExp(String.raw`^VALIDATE\s+CONSTRAINT\s+(${IDENT})`, 'i').exec(action))) { ev('constraint', normName(a[1]), 'present', action, table); continue; }
        unchecked.push(`ALTER TABLE ${table}: ${action.slice(0, 60)}`);
      }
      continue;
    }

    if ((m = new RegExp(String.raw`^ALTER\s+INDEX\s+(?:IF\s+EXISTS\s+)?(${QNAME})\s+RENAME\s+TO\s+(${IDENT})`, 'i').exec(frag))) {
      ev('index', normName(m[1]), 'absent', frag);
      ev('index', normName(m[2]), 'present', frag);
      continue;
    }

    if ((m = new RegExp(String.raw`^CREATE\s+(?:OR\s+REPLACE\s+)?(FUNCTION|PROCEDURE)\s+(${QNAME})`, 'i').exec(frag))) { ev('function', normName(m[2]), 'present', frag); continue; }
    if ((m = new RegExp(String.raw`^CREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+(${IDENT})\b.*?\bON\s+(${QNAME})`, 'i').exec(frag))) { ev('trigger', normName(m[1]), 'present', frag, normName(m[2])); continue; }
    if ((m = new RegExp(String.raw`^CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?(${QNAME})`, 'i').exec(frag))) { ev('relation', normName(m[1]), 'present', frag); continue; }
    if ((m = new RegExp(String.raw`^CREATE\s+TYPE\s+(${QNAME})`, 'i').exec(frag))) { ev('type', normName(m[1]), 'present', frag); continue; }
    if ((m = new RegExp(String.raw`^CREATE\s+SEQUENCE\s+(?:IF\s+NOT\s+EXISTS\s+)?(${QNAME})`, 'i').exec(frag))) { ev('relation', normName(m[1]), 'present', frag); continue; }
    if ((m = new RegExp(String.raw`^CREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?(${IDENT})`, 'i').exec(frag))) { ev('extension', normName(m[1]), 'present', frag); continue; }
    if ((m = new RegExp(String.raw`^CREATE\s+SCHEMA\s+(?:IF\s+NOT\s+EXISTS\s+)?(${IDENT})`, 'i').exec(frag))) { ev('schema', normName(m[1]), 'present', frag); continue; }

    if ((m = new RegExp(String.raw`^DROP\s+(TABLE|INDEX|FUNCTION|PROCEDURE|VIEW|MATERIALIZED\s+VIEW|TYPE|SEQUENCE|EXTENSION|SCHEMA)\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?(${QNAME}(?:\s*,\s*${QNAME})*)`, 'i').exec(frag))) {
      const what = m[1].toUpperCase().replace(/\s+/g, ' ');
      const kind = { TABLE: 'table', INDEX: 'index', FUNCTION: 'function', PROCEDURE: 'function', VIEW: 'relation', 'MATERIALIZED VIEW': 'relation', TYPE: 'type', SEQUENCE: 'relation', EXTENSION: 'extension', SCHEMA: 'schema' }[what];
      for (const nm of splitTopCommas(m[2])) ev(kind, normName(nm), 'absent', frag);
      continue;
    }
    if ((m = new RegExp(String.raw`^DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?(${IDENT})\s+ON\s+(${QNAME})`, 'i').exec(frag))) { ev('trigger', normName(m[1]), 'absent', frag, normName(m[2])); continue; }

    if (/^(?:ALTER|CREATE|DROP|GRANT|REVOKE)\b/i.test(frag)) { unchecked.push(frag.slice(0, 80)); continue; }
    unrecognized.push(frag.slice(0, 100));
  }
  return { events, data, comments, unchecked, unrecognized };
}

// ---------------------------------------------------------------------------
// Expectations across the whole sequence.
// ---------------------------------------------------------------------------

/**
 * @param parsed [{ number, name, parsed }] in apply order
 * @returns Map key -> { expect, number } (the final state and who set it), and
 *          each event annotated with { final, supersededBy }.
 */
export function finalStates(parsedUnits) {
  const final = new Map();
  for (const u of parsedUnits) {
    for (const e of u.parsed.events) final.set(e.key, { expect: e.expect, number: u.number });
  }
  return final;
}

function tableOf(e) {
  if (e.kind === 'index') return e.onTable || e.table;
  if (e.kind === 'column' || e.kind === 'constraint' || e.kind === 'trigger' || e.kind === 'nullable') return e.table;
  if (e.kind === 'comment') return e.table || e.name;
  return null;
}

// ---------------------------------------------------------------------------
// Catalog (read-only).
// ---------------------------------------------------------------------------

/**
 * Load the public-schema catalog with SELECTs only. `q(text)` runs one query
 * and resolves to rows - a neon() function or a pg client wrapper.
 */
export async function loadCatalog(q, schema = 'public') {
  const s = schema.replace(/'/g, "''");
  const [rels, cols, idx, cons, procs, trigs, types, exts, schemas] = await Promise.all([
    q(`SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = '${s}' AND c.relkind IN ('r','p','v','m','S','f')`),
    q(`SELECT table_name, column_name, is_nullable FROM information_schema.columns WHERE table_schema = '${s}'`),
    q(`SELECT ic.relname AS indexname, tc.relname AS tablename, i.indisvalid FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid JOIN pg_class tc ON tc.oid = i.indrelid JOIN pg_namespace n ON n.oid = ic.relnamespace WHERE n.nspname = '${s}'`),
    q(`SELECT co.conname, c.relname FROM pg_constraint co JOIN pg_class c ON c.oid = co.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = '${s}'`),
    q(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = '${s}'`),
    q(`SELECT t.tgname, c.relname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = '${s}' AND NOT t.tgisinternal`),
    q(`SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = '${s}' AND t.typtype IN ('e','c','d','r')`),
    q(`SELECT extname FROM pg_extension`),
    q(`SELECT nspname FROM pg_namespace`),
  ]);
  const comments = await q(`SELECT 'table' AS sub, c.relname AS tbl, c.relname AS name, d.description
       FROM pg_description d JOIN pg_class c ON c.oid = d.objoid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE d.classoid = 'pg_class'::regclass AND d.objsubid = 0 AND n.nspname = '${s}'
     UNION ALL
     SELECT 'column', c.relname, a.attname, d.description
       FROM pg_description d JOIN pg_class c ON c.oid = d.objoid JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.objsubid
      WHERE d.classoid = 'pg_class'::regclass AND d.objsubid > 0 AND n.nspname = '${s}'
     UNION ALL
     SELECT 'constraint', c.relname, co.conname, d.description
       FROM pg_description d JOIN pg_constraint co ON co.oid = d.objoid JOIN pg_class c ON c.oid = co.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE d.classoid = 'pg_constraint'::regclass AND n.nspname = '${s}'`);
  return {
    tables: new Set(rels.filter((r) => r.relkind === 'r' || r.relkind === 'p' || r.relkind === 'f').map((r) => r.relname)),
    relations: new Set(rels.map((r) => r.relname)),
    columns: new Map(cols.map((r) => [`${r.table_name}.${r.column_name}`, r.is_nullable])),
    indexes: new Map(idx.map((r) => [r.indexname, { table: r.tablename, valid: r.indisvalid }])),
    constraints: new Set(cons.map((r) => `${r.relname}.${r.conname}`)),
    functions: new Set(procs.map((r) => r.proname)),
    triggers: new Set(trigs.map((r) => `${r.relname}.${r.tgname}`)),
    types: new Set(types.map((r) => r.typname)),
    extensions: new Set(exts.map((r) => r.extname)),
    schemas: new Set(schemas.map((r) => r.nspname)),
    comments: new Map(comments.map((r) => [`${r.sub}:${r.sub === 'table' ? '' : `${r.tbl}.`}${r.name}`, normComment(r.description)])),
  };
}

/** Is the event's final expectation true of the catalog? Returns { ok, detail }. */
export function checkEvent(e, cat) {
  const has = (() => {
    switch (e.kind) {
      case 'table': return cat.tables.has(e.name) || cat.relations.has(e.name);
      case 'relation': return cat.relations.has(e.name);
      case 'column': return cat.columns.has(`${e.table}.${e.name}`);
      case 'index': return cat.indexes.has(e.name);
      case 'constraint': return cat.constraints.has(`${e.table}.${e.name}`);
      case 'function': return cat.functions.has(e.name);
      case 'trigger': return cat.triggers.has(`${e.table}.${e.name}`);
      case 'type': return cat.types.has(e.name);
      case 'extension': return cat.extensions.has(e.name);
      case 'schema': return cat.schemas.has(e.name);
      case 'nullable': return null;
      default: return undefined;
    }
  })();
  if (e.kind === 'comment') {
    const k = `${e.sub}:${e.table ? `${e.table}.` : ''}${e.name}`;
    const v = cat.comments.has(k) ? cat.comments.get(k) : null;
    return { ok: v === e.expect, detail: `comment on ${e.sub} ${e.table ? `${e.table}.` : ''}${e.name} ${v === null ? 'absent' : 'differs from the file'}` };
  }
  if (e.kind === 'nullable') {
    const v = cat.columns.get(`${e.table}.${e.name}`);
    if (v === undefined) return { ok: false, detail: `${e.table}.${e.name} absent (nullability)` };
    const isNotNull = v === 'NO';
    const ok = e.expect === 'NOT NULL' ? isNotNull : !isNotNull;
    return { ok, detail: `${e.table}.${e.name} is ${isNotNull ? 'NOT NULL' : 'nullable'}, expected ${e.expect}` };
  }
  if (has === undefined) return { ok: null, detail: `unknown kind ${e.kind}` };
  const ok = e.expect === 'present' ? has : !has;
  let detail = `${e.kind} ${e.table && e.kind !== 'index' ? `${e.table}.` : ''}${e.name} ${has ? 'present' : 'absent'}`;
  if (e.kind === 'index' && has && cat.indexes.get(e.name).valid === false) {
    return { ok: false, detail: `index ${e.name} present but INVALID (a failed CONCURRENTLY build)` };
  }
  if (!ok) detail += `, expected ${e.expect}`;
  return { ok, detail };
}

/**
 * @param parsedUnits [{ number, name, parsed }] in apply order
 * @param cat loadCatalog() result
 * @returns [{ number, name, verdict, checked, present, missing, drift, superseded, data, unchecked, unrecognized }]
 *
 * COMMENTS are evidence of a lesser kind. In a migration that also creates
 * or alters something, a comment whose text differs from the file is DRIFT
 * (the file was edited after it ran, or a later file re-commented without
 * this parser seeing it) and is listed without changing the verdict. In a
 * comment-only migration (089, 093, 094) the comments are the only evidence
 * there is, so they decide it.
 */
export function verifyUnits(parsedUnits, cat) {
  const final = finalStates(parsedUnits);
  // Global order, so a comment made before its object was dropped and
  // re-created (which takes the comment with it) is not looked for.
  let seq = 0;
  const lastAbsent = new Map();
  const seqOf = new Map();
  for (const u of parsedUnits) {
    for (const e of u.parsed.events) {
      seqOf.set(e, ++seq);
      if (e.expect === 'absent') lastAbsent.set(e.key, seq);
    }
  }
  const results = [];
  for (const u of parsedUnits) {
    const missing = [];
    const drift = [];
    const superseded = [];
    let checked = 0;
    let present = 0;
    let commentChecked = 0;
    let commentPresent = 0;
    const commentMissing = [];
    const seen = new Set();
    for (const e of u.parsed.events) {
      const f = final.get(e.key);
      if (f.expect !== e.expect) { superseded.push(`${e.key} -> changed by ${String(f.number).padStart(3, '0')}`); continue; }
      const t = tableOf(e);
      if (t && e.kind !== 'table') {
        const tf = final.get(`table:${t}`);
        if (tf && tf.expect === 'absent') { superseded.push(`${e.key} gone with table ${t} (dropped by ${String(tf.number).padStart(3, '0')})`); continue; }
      }
      if (e.kind === 'comment') {
        const objKey = e.sub === 'table' ? `table:${e.name}` : `${e.sub}:${e.table}.${e.name}`;
        const of = final.get(objKey);
        if (of && of.expect === 'absent') { superseded.push(`${e.key} gone with its ${e.sub} (by ${String(of.number).padStart(3, '0')})`); continue; }
        if ((lastAbsent.get(objKey) || 0) > seqOf.get(e)) { superseded.push(`${e.key} dropped with its ${e.sub} after this file`); continue; }
      }
      const dedupe = `${e.key}|${e.expect}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      const r = checkEvent(e, cat);
      if (r.ok === null) continue;
      if (e.kind === 'comment') {
        commentChecked++;
        if (r.ok) commentPresent++;
        else commentMissing.push(r.detail);
        continue;
      }
      checked++;
      if (r.ok) present++;
      else missing.push(r.detail);
    }
    // A missing table takes its columns, indexes and constraints with it:
    // report the table once, with the count, not sixty lines.
    const goneTables = missing.map((d) => /^table (\S+) absent/.exec(d)).filter(Boolean).map((m) => m[1]);
    for (const t of goneTables) {
      const before = missing.length;
      const keep = missing.filter((d) => d.startsWith(`table ${t} `) || !(d.includes(` ${t}.`) || d.startsWith(`${t}.`)));
      missing.length = 0;
      missing.push(...keep);
      const i = missing.findIndex((d) => d.startsWith(`table ${t} `));
      if (before > keep.length) missing[i] += ` (+${before - keep.length} of its columns/constraints/nullability)`;
    }
    if (checked === 0) {
      checked = commentChecked;
      present = commentPresent;
      missing.push(...commentMissing);
    } else {
      drift.push(...commentMissing);
    }
    let verdict;
    if (checked === 0) verdict = 'unverifiable';
    else if (present === checked) verdict = 'verified';
    else if (present === 0) verdict = 'missing';
    else verdict = 'partial';
    results.push({
      number: u.number,
      name: u.name,
      verdict,
      checked,
      present,
      missing,
      drift,
      superseded,
      data: u.parsed.data.length,
      unchecked: u.parsed.unchecked,
      unrecognized: u.parsed.unrecognized,
    });
  }
  return results;
}
