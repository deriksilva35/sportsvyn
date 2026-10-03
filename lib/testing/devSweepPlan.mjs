// lib/testing/devSweepPlan.mjs - the pure half of scripts/dev-orphan-sweep.mjs.
//
// Everything here is decided without a database: which flags were given, whether
// the target may be touched at all, and in what order tables are emptied and
// refilled. The script does the I/O; the unit test (devSweepPlan.test.mjs) pins
// these decisions, because a wrong answer in any of them is a deleted table on
// the wrong database or a restore that cannot run.

export const DEFAULT_OLDER_THAN_MIN = 30;

// ---------------------------------------------------------------- arguments

export function parseArgs(argv) {
  const out = { mode: 'list', dryRun: false, olderThan: DEFAULT_OLDER_THAN_MIN, undoFile: null, outFile: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--apply') out.mode = out.mode === 'undo' ? bad('--apply and --undo are exclusive') : 'apply';
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--undo') {
      if (out.mode === 'apply') bad('--apply and --undo are exclusive');
      out.mode = 'undo';
      out.undoFile = val();
    } else if (a === '--older-than') {
      const raw = val();
      const n = Number(raw);
      if (!/^\d+(\.\d+)?$/.test(raw) || !Number.isFinite(n)) bad(`--older-than wants minutes, got "${raw}"`);
      out.olderThan = n;
    } else if (a === '--out') out.outFile = val();
    else bad(`unknown argument "${a}"`);
  }
  if (out.dryRun && out.mode !== 'apply') bad('--dry-run only means something with --apply');
  if (out.outFile && out.mode !== 'apply') bad('--out only means something with --apply');
  return out;
}

function bad(msg) { throw new Error(msg); }

// ---------------------------------------------------------------- refusal

// The endpoint a URL reaches, with Neon's "-pooler" suffix taken off the first
// label: the pooled and the direct URL of one database are one database.
export function hostFingerprint(url) {
  let host;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return null; }
  const [first, ...rest] = host.split('.');
  return [first.replace(/-pooler$/, ''), ...rest].join('.');
}

// null when the run may go ahead, otherwise the reason it may not. A write
// (apply or undo) also needs PROD_DATABASE_URL present: without it there is
// nothing to compare against, and "could not check" is not "checked".
export function refuseReason({ url, prodUrl, mode }) {
  if (!url) return 'DATABASE_URL missing in env';
  if (prodUrl && url === prodUrl) return 'DATABASE_URL is PROD. This sweep is for DEV.';
  const fp = hostFingerprint(url);
  if (!fp) return 'DATABASE_URL is not a URL';
  if (prodUrl && hostFingerprint(prodUrl) === fp) return `DATABASE_URL reaches PROD's host (${fp}). This sweep is for DEV.`;
  if (mode !== 'list' && !prodUrl) return 'PROD_DATABASE_URL missing in env: cannot prove the target is not PROD';
  return null;
}

// ---------------------------------------------------------------- FK actions

// pg_constraint.confdeltype -> what the sweep does to a child row that points
// at a row it deletes. CASCADE / NO ACTION / RESTRICT: the child goes too,
// explicitly and into the undo file. SET NULL: the column is nulled
// explicitly (and the old value kept for the undo) - deleting there would
// walk out of the fixture into real data, e.g. team -> blurb -> every player
// whose current outlook is that blurb.
export function fkTreatment(confdeltype) {
  switch (confdeltype) {
    case 'c': case 'a': case 'r': return 'delete';
    case 'n': return 'null';
    default: throw new Error(`FK action "${confdeltype}" is not handled by the sweep`);
  }
}

// Children before parents, over the tables that have rows to delete. Only the
// edges whose child is deleted constrain the order (SET NULL edges are nulled
// before any delete runs) and a table's edge to itself is settled inside its
// own single DELETE. A cycle is an error, never a guess.
export function deletionOrder(tables, edges) {
  const set = new Set(tables);
  const parentsOf = new Map(tables.map((t) => [t, new Set()]));
  const childCount = new Map(tables.map((t) => [t, 0]));
  for (const e of edges) {
    if (e.child === e.parent || !set.has(e.child) || !set.has(e.parent)) continue;
    if (fkTreatment(e.action) !== 'delete') continue;
    if (parentsOf.get(e.child).has(e.parent)) continue;
    parentsOf.get(e.child).add(e.parent);
    childCount.set(e.parent, childCount.get(e.parent) + 1);
  }
  // Kahn's algorithm, ready set kept sorted so the order is stable run to run.
  const ready = tables.filter((t) => childCount.get(t) === 0).sort();
  const order = [];
  while (ready.length) {
    const t = ready.shift();
    order.push(t);
    for (const p of parentsOf.get(t)) {
      childCount.set(p, childCount.get(p) - 1);
      if (childCount.get(p) === 0) { ready.push(p); ready.sort(); }
    }
  }
  if (order.length !== tables.length) {
    const stuck = tables.filter((t) => !order.includes(t)).sort();
    throw new Error(`FK cycle among ${stuck.join(', ')}: refusing to order the delete`);
  }
  return order;
}

// The undo file is written in execution order (nulls, then deletes children
// first); the restore runs it backwards: parents inserted first, the nulled
// columns put back last, once the rows they point at exist again.
export function restoreTableOrder(undoTablesInFileOrder) {
  return [...undoTablesInFileOrder].reverse();
}

// ---------------------------------------------------------------- age guard

// A row is young when it has a created_at at or after the cutoff. A row with
// no created_at (or a NULL one) has no age of its own and follows its parent.
export function isYoung(row, cutoffMs) {
  if (!row || row.created_at == null) return false;
  const t = Date.parse(row.created_at);
  return Number.isFinite(t) && t >= cutoffMs;
}

// Walk a collected row's `via` chain up to the seed row that pulled it in.
// nodes: Map<"table|key", { via: "table|key" | null }>.
export function rootOf(nodes, id) {
  const seen = new Set();
  let cur = id;
  while (nodes.get(cur)?.via) {
    if (seen.has(cur)) throw new Error(`via cycle at ${cur}`);
    seen.add(cur);
    cur = nodes.get(cur).via;
  }
  return cur;
}

export const qi = (name) => `"${String(name).replace(/"/g, '""')}"`;
