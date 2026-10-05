// lib/migrations/ledger.mjs - THE MIGRATION LEDGER (sun-18 item 4).
//
// schema_migrations records every numbered migration a database has had:
// number, file name, sha256 of the file bytes, when, by whom. With it the
// apply script can say three things it could not say before:
//
//   "already applied"   the number is in the ledger with this exact checksum:
//                       skip it, a re-run is a no-op.
//   "CHANGED"           the number is in the ledger with a DIFFERENT checksum:
//                       somebody edited a migration after it ran somewhere.
//                       Refuse - the file no longer describes that database.
//   "duplicate number"  two files claim one number. Refuse on every run, for
//                       the whole directory, not just the files requested.
//
// ONE GRANDFATHERED DUPLICATE. 081 is two files - 081_news_items.sql (the
// table) and 081_news_feeds_seed.sql (its 32 rows, "run after
// 081_news_items.sql") - from 1f1b85d, 31 Aug, long applied on both
// databases. Renaming either would change history; instead number 81 is ONE
// UNIT of two files, applied in that order and checksummed together (sha256
// over the two files' bytes, concatenated in apply order). The exception is
// exact: a third 081 file, or any other duplicate, is refused.
//
// The pure half (files, checksums, planning, status) takes no database. The
// DB half takes a pg Client the caller owns, so a test can point it at a
// throwaway schema with `SET search_path`.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { splitTopLevel } from './sqlLex.mjs';

export const LEDGER_TABLE = 'schema_migrations';

// The ledger migration is found by its NAME, not its number, so renumbering it
// at merge time (128 today, if Tuesday's 126 and 127 land first) is a file
// rename and nothing else.
export const LEDGER_MIGRATION_SUFFIX = '_schema_migrations.sql';

export const GRANDFATHERED_DUPLICATES = Object.freeze({
  81: Object.freeze(['081_news_items.sql', '081_news_feeds_seed.sql']),
});

const NUMBERED = /^(\d+)_.+\.sql$/;

export function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Read a migrations directory into units.
 * @returns {{ units: Unit[], unnumbered: string[], duplicates: {number, files}[] }}
 *   Unit = { number, name, files: [{ file, path, bytes }], checksum, isLedger }
 * Files inside a grandfathered unit are ordered as GRANDFATHERED_DUPLICATES
 * says; `duplicates` lists every number that is NOT an exact grandfathered set.
 */
export function readMigrationsDir(dir, { readFile = (p) => fs.readFileSync(p), listDir = (d) => fs.readdirSync(d) } = {}) {
  const names = listDir(dir).filter((f) => f.endsWith('.sql')).sort();
  const byNumber = new Map();
  const unnumbered = [];
  for (const f of names) {
    const m = NUMBERED.exec(f);
    if (!m) { unnumbered.push(f); continue; }
    const number = parseInt(m[1], 10);
    if (!byNumber.has(number)) byNumber.set(number, []);
    byNumber.get(number).push(f);
  }
  const duplicates = [];
  const units = [];
  for (const [number, files] of [...byNumber.entries()].sort((a, b) => a[0] - b[0])) {
    let ordered = files;
    if (files.length > 1) {
      const g = GRANDFATHERED_DUPLICATES[number];
      const exact = g && g.length === files.length && g.every((x) => files.includes(x));
      if (!exact) { duplicates.push({ number, files }); continue; }
      ordered = [...g];
    }
    const loaded = ordered.map((file) => {
      const p = path.join(dir, file);
      return { file, path: p, bytes: readFile(p) };
    });
    units.push({
      number,
      name: ordered.join(' + '),
      files: loaded,
      checksum: unitChecksum(loaded.map((x) => x.bytes)),
      isLedger: ordered.length === 1 && ordered[0].endsWith(LEDGER_MIGRATION_SUFFIX),
    });
  }
  return { units, unnumbered, duplicates };
}

/** sha256 of the file bytes; for a grandfathered multi-file unit, of the bytes concatenated in apply order. */
export function unitChecksum(bufs) {
  return sha256(Buffer.concat(bufs.map((b) => (Buffer.isBuffer(b) ? b : Buffer.from(b)))));
}

export function duplicateMessage(duplicates) {
  return duplicates
    .map((d) => `  number ${String(d.number).padStart(3, '0')} is claimed by ${d.files.length} files: ${d.files.join(', ')}`)
    .join('\n');
}

/**
 * Resolve a CLI argument ("087", "87", "087_footballdb_season_totals",
 * "087_footballdb_season_totals.sql") to a unit, or to an unnumbered file name.
 */
export function resolveArg(arg, { units, unnumbered }) {
  if (/^\d+$/.test(arg)) {
    const n = parseInt(arg, 10);
    const u = units.find((x) => x.number === n);
    return u ? { unit: u } : { error: `No migration numbered ${arg}` };
  }
  const want = arg.endsWith('.sql') ? arg : `${arg}.sql`;
  const u = units.find((x) => x.files.some((f) => f.file === want));
  if (u) return { unit: u };
  if (unnumbered.includes(want)) return { unnumbered: want };
  return { error: `No migration file matches "${arg}"` };
}

// ---------------------------------------------------------------------------
// Transaction handling.
//
// THREE MODES, decided from the file's text:
//
//   wrap  (the default) BEGIN; <file>; INSERT ledger row; COMMIT. The DDL and
//         its ledger row land together or not at all.
//   wrap, folding the file's own BEGIN/COMMIT. 120 and 122 carry top-level
//         BEGIN; ... COMMIT;. Run inside our wrapper as-is, their COMMIT would
//         commit OUR transaction early and leave the ledger insert outside it
//         - atomicity lost with nothing but a NOTICE to say so. Those
//         top-level statements are removed from the text we execute (the
//         checksum is still of the file bytes) and the whole file runs in
//         the wrapper: the same work, now atomic with its row.
//   none  the file holds a statement Postgres refuses inside a transaction
//         block (CREATE/DROP INDEX CONCURRENTLY - 117 is one - REINDEX
//         CONCURRENTLY, VACUUM, CREATE DATABASE, ALTER SYSTEM). It is run one
//         top-level statement at a time in autocommit (a multi-statement
//         string is itself an implicit transaction, which CONCURRENTLY also
//         refuses), and the ledger row is written after the last one
//         succeeds. Not atomic, and said so: a failure part-way leaves the
//         statements before it applied and NO ledger row, and the error names
//         how far it got. These files are written idempotent (IF NOT EXISTS)
//         for exactly this reason, so the re-run is the repair.
// ---------------------------------------------------------------------------

const NO_TX = /\b(?:CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY|DROP\s+INDEX\s+CONCURRENTLY|REINDEX\b[^;]*\bCONCURRENTLY|VACUUM|CREATE\s+DATABASE|DROP\s+DATABASE|ALTER\s+SYSTEM|DETACH\s+PARTITION\b[^;]*\bCONCURRENTLY)\b/i;
const OWN_BEGIN = /^(?:BEGIN(?:\s+(?:WORK|TRANSACTION))?|START\s+TRANSACTION)(?:\s+ISOLATION\s+LEVEL\s+[A-Z ]+)?$/i;
const OWN_END = /^(?:COMMIT|END)(?:\s+(?:WORK|TRANSACTION))?$/i;
const OWN_ROLLBACK = /^ROLLBACK\b/i;

/**
 * @returns {{ mode: 'wrap'|'none', statements, execSql, folded: number, reason }}
 */
export function transactionPlan(sqlText) {
  const statements = splitTopLevel(sqlText);
  const noTx = statements.filter((s) => NO_TX.test(s.code));
  const own = statements.filter((s) => OWN_BEGIN.test(s.code) || OWN_END.test(s.code));
  const rollback = statements.filter((s) => OWN_ROLLBACK.test(s.code));
  if (rollback.length) throw new Error(`file contains a top-level ROLLBACK (${rollback[0].code.slice(0, 60)}) - refusing to guess what it means`);
  if (noTx.length) {
    if (own.length) throw new Error('file mixes a statement that cannot run in a transaction with its own BEGIN/COMMIT - split it');
    return {
      mode: 'none',
      statements: statements.map((s) => s.text),
      execSql: null,
      folded: 0,
      reason: `cannot run in a transaction: ${noTx[0].code.slice(0, 80)}`,
    };
  }
  let execSql = sqlText;
  if (own.length) {
    // Remove from the end so earlier offsets stay valid.
    for (const s of [...own].sort((a, b) => b.start - a.start)) {
      execSql = execSql.slice(0, s.start) + `/* [ledger] own ${s.code} folded into the wrapper */` + execSql.slice(s.end);
    }
  }
  return {
    mode: 'wrap',
    statements: null,
    execSql,
    folded: own.length,
    reason: own.length ? `file's own ${own.map((s) => s.code).join('/')} folded into the wrapper` : null,
  };
}

// ---------------------------------------------------------------------------
// Planning and status (pure).
// ---------------------------------------------------------------------------

/**
 * @param units requested units, in order
 * @param ledgerRows rows from schema_migrations ([] when the table is absent)
 * @returns [{ unit, action: 'apply'|'skip'|'refuse', reason }]
 */
export function planApply(units, ledgerRows) {
  const byNumber = new Map(ledgerRows.map((r) => [Number(r.number), r]));
  return units.map((unit) => {
    const row = byNumber.get(unit.number);
    if (!row) return { unit, action: 'apply', reason: 'not in ledger' };
    if (row.checksum === unit.checksum) {
      const renamed = row.name !== unit.name ? ` (ledger name was ${row.name})` : '';
      return { unit, action: 'skip', reason: `already applied${renamed}` };
    }
    return {
      unit,
      action: 'refuse',
      reason: `CHANGED since it was applied: ledger ${row.name} sha256 ${row.checksum.slice(0, 12)}, file sha256 ${unit.checksum.slice(0, 12)}`,
    };
  });
}

/**
 * THE UN-BACKFILLED GUARD. On a database whose ledger holds nothing older
 * than the ledger migration itself, every pre-ledger migration reads as
 * pending - but they all ran long ago. Asking for one there means the
 * one-time backfill has not run yet, and applying it would re-run old DDL and
 * data statements. Returns the requested units that would be re-run that way
 * (the caller refuses unless told the database really is fresh).
 */
export function unbackfilledRequests(requested, ledgerRows, allUnits) {
  const ledgerUnit = allUnits.find((u) => u.isLedger);
  if (!ledgerUnit) return [];
  const anyOlder = ledgerRows.some((r) => Number(r.number) < ledgerUnit.number);
  if (anyOlder) return [];
  const recorded = new Set(ledgerRows.map((r) => Number(r.number)));
  return requested.filter((u) => u.number < ledgerUnit.number && !recorded.has(u.number));
}

/**
 * Applied vs pending for every unit, plus ledger rows with no file.
 * @returns [{ number, name, state: 'applied'|'CHANGED'|'pending'|'LEDGER-ONLY', applied_at, note }]
 */
export function statusRows(units, ledgerRows) {
  const byNumber = new Map(ledgerRows.map((r) => [Number(r.number), r]));
  const rows = units.map((u) => {
    const r = byNumber.get(u.number);
    if (!r) return { number: u.number, name: u.name, state: 'pending', applied_at: null, note: null };
    return {
      number: u.number,
      name: u.name,
      state: r.checksum === u.checksum ? 'applied' : 'CHANGED',
      applied_at: r.applied_at,
      note: r.note ?? null,
    };
  });
  const fileNumbers = new Set(units.map((u) => u.number));
  for (const r of ledgerRows) {
    if (!fileNumbers.has(Number(r.number))) {
      rows.push({ number: Number(r.number), name: r.name, state: 'LEDGER-ONLY', applied_at: r.applied_at, note: r.note ?? null });
    }
  }
  return rows.sort((a, b) => a.number - b.number);
}

export function formatStatus(rows, { ledgerExists }) {
  const lines = [];
  if (!ledgerExists) lines.push(`(no ${LEDGER_TABLE} table on this target: every migration reads as pending)`);
  for (const r of rows) {
    const when = r.applied_at ? new Date(r.applied_at).toISOString() : r.state === 'applied' || r.state === 'CHANGED' ? '(backfilled)' : '';
    lines.push(`${String(r.number).padStart(3, '0')}  ${r.state.padEnd(11)} ${r.name}${when ? `  ${when}` : ''}`);
  }
  const count = (s) => rows.filter((r) => r.state === s).length;
  lines.push(`applied ${count('applied')} / pending ${count('pending')} / CHANGED ${count('CHANGED')} / ledger-only ${count('LEDGER-ONLY')}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// DB half. `client` is a connected pg Client the caller owns.
// ---------------------------------------------------------------------------

export async function ledgerExists(client) {
  const { rows } = await client.query(`SELECT to_regclass($1) IS NOT NULL AS present`, [LEDGER_TABLE]);
  return rows[0].present === true;
}

export async function readLedger(client) {
  if (!(await ledgerExists(client))) return null;
  const { rows } = await client.query(`SELECT number, name, checksum, applied_at, applied_by, note FROM ${LEDGER_TABLE} ORDER BY number`);
  return rows;
}

/**
 * Apply one unit and write its ledger row. Re-checks the ledger INSIDE the
 * transaction, and the number PRIMARY KEY makes a racing second apply fail at
 * the INSERT and roll its DDL back.
 * @returns {{ mode, reason }}
 */
export async function applyUnit(client, unit, { appliedBy = null, note = null, log = () => {} } = {}) {
  // A grandfathered pair is planned file by file but must share one mode.
  const plans = unit.files.map((f) => transactionPlan(f.bytes.toString('utf8')));
  const mode = plans.some((p) => p.mode === 'none') ? 'none' : 'wrap';
  if (mode === 'none' && unit.files.length > 1) throw new Error(`${unit.name}: a multi-file unit cannot include a no-transaction migration`);
  const insert = `INSERT INTO ${LEDGER_TABLE} (number, name, checksum, applied_at, applied_by, note) VALUES ($1, $2, $3, now(), $4, $5)`;
  const params = [unit.number, unit.name, unit.checksum, appliedBy, note];

  if (mode === 'wrap') {
    const execSql = plans.map((p) => p.execSql).join('\n;\n');
    const reason = plans.map((p) => p.reason).filter(Boolean).join('; ') || null;
    if (reason) log(`  (${reason})`);
    await client.query('BEGIN');
    try {
      await client.query(execSql);
      await client.query(insert, params);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    }
    return { mode, reason };
  }

  const { statements, reason } = plans[0];
  log(`  (NO TRANSACTION - ${reason}; running ${statements.length} statement(s) one at a time, ledger row after the last)`);
  for (let i = 0; i < statements.length; i++) {
    try {
      await client.query(statements[i]);
    } catch (e) {
      e.message = `${unit.name}: statement ${i + 1}/${statements.length} failed - statements 1..${i} ARE applied, NO ledger row written. The file is meant to be idempotent: fix and re-run. Cause: ${e.message}`;
      throw e;
    }
  }
  await client.query(insert, params);
  return { mode, reason };
}

/**
 * BOOTSTRAP. If schema_migrations does not exist, apply the ledger migration
 * (the one *_schema_migrations.sql file) through applyUnit, which records the
 * ledger migration as its own first row - in the same transaction that
 * creates the table. The DDL lives in one place, the migration file.
 * @returns {{ created: boolean, unit?: Unit }}
 */
export async function ensureLedger(client, units, opts = {}) {
  if (await ledgerExists(client)) return { created: false };
  const unit = units.find((u) => u.isLedger);
  if (!unit) throw new Error(`no ${LEDGER_TABLE} table on the target and no *${LEDGER_MIGRATION_SUFFIX} file to create it`);
  await applyUnit(client, unit, opts);
  return { created: true, unit };
}

