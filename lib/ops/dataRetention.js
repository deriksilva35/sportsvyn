// lib/ops/dataRetention.js - odds price history 14 days, job logs 30 days
// (sun-16 item E). The daily job is app/api/cron/data-retention; the same
// counts, read-only, are scripts/retention-dry-run.mjs.
//
// NOTHING IS DELETED UNLESS RETENTION_APPLY=on. Without it the job DRY-RUNS:
// it counts what each rule would delete and records that under kind
// 'dry-run'. "Data stays" was the standing rule; the first PROD delete is
// Derik's GO, given by setting the flag, and nothing in this file sets it.
//
// ===========================================================================
// odds_markets - WHAT IS KEPT, AND WHICH READER NEEDS IT
// ===========================================================================
// odds_markets keeps every snapshot: each refresh flips the prior row to
// is_current = false and inserts a new current row. Every reader of that
// history, read on 4 Oct 2026 (grep odds_markets, every non-is_current read):
//
//   lib/gridiron/openingLine.js   "opened -2.5": the EARLIEST spread row per
//                                 match (any label, odds-api-v4).
//   lib/matchProbability.js       "since open": the EARLIEST row per match +
//                                 market_type + selection_label (totals: + the
//                                 selection_value) - three open_american reads.
//   lib/winprob/live.js           the market prior: the LAST spread rows
//                                 before kickoff (max fetched_at < kickoff_at,
//                                 then the rows within 2 minutes of it), frozen
//                                 ONCE into matches.metadata.market_prior at
//                                 the first live poll. After that every reader
//                                 (game page, scores-v4 closing line, NBA/
//                                 gridiron detail) reads the frozen metadata,
//                                 never odds_markets.
//   movement chips / 24h baseline previous_* columns ON THE is_current ROW,
//                                 carried forward by each writer (oddsIngest,
//                                 odds.js, propsIngest read the current row
//                                 only). No reader walks history for movement.
//   props "charts"                player game logs (lib/market/propsBoard.js
//                                 chartSeries), not price history.
//   market / wire / pick'em /     is_current rows only (lib/market/reads.js,
//   rankings / settle             lib/wire/lines.js, getSpreadHome, ...).
//   the Mac's training export     odds_spreads.jsonl.gz, taken 2 Oct, is a file
//                                 on the Mac; nothing in this repo reads old
//                                 rows for it. A FUTURE export of the full
//                                 hourly series can only see the anchors below
//                                 plus the last 14 days.
//
// So a row is KEPT when any of these holds, and DELETED otherwise:
//   current  is_current = true                                  (every reader)
//   recent   fetched_at >= now - 14 days
//   open     the earliest row of its selection                   (open lines)
//   close    the last row of its selection BEFORE kickoff        (the prior)
//   last     the last row of its selection at all                (the final
//            price a selection that left the board carried)
// "Its selection" is the partition (match_id, market_scope, market_type,
// fetcher_version, player_id, team_id, selection_label, selection_value). It
// is FINER than any reader's grouping - openingLine groups by match, the
// open_american reads by label (+ value for totals), the prior by match - and
// the earliest/last row of a coarser group is always the earliest/last row of
// one of its finer partitions, so every reader still finds the very row it
// finds today. Futures (match_id NULL) partition by league_id instead and have
// no kickoff, so they keep open + last.
//
// ===========================================================================
// sync_runs - WHAT IS KEPT, AND WHICH READER NEEDS IT
// ===========================================================================
// sync_runs is the house ledger: job logs AND a few permanent user ledgers.
//   ledger    sources that are dedupe/claim ledgers or engagement history,
//             kept forever: welcome-email (a user's send is claimed once,
//             lib/auth/welcomeEmail.js, no time bound), welcome-sheet, push
//             (event-id claims, lib/push/notify.js and seasonBoardTick, no
//             time bound), broadcast (per-user campaign sends,
//             scripts/broadcast.mjs), email-click, resend-webhook,
//             client-error, migrations, and this job's own rows (its state).
//   watchdog  source cron-watchdog* kind 'flag': the watchdog's once-a-day
//             claim rows (read 3 days back; kept forever, ~1 a day).
//   recent    started_at >= now - 30 days.
//   latest    the newest row, and the newest ok row, per (source, kind head
//             - 'quota:<day>' counts as 'quota' -, league): the watchdog's "last successful run" read
//             (lib/ops/cronWatchdog.js, power-edition per league), adp's
//             streak read and lastGamesRunAt must never come back empty just
//             because a job is seasonal.
//   quota     35 days for quota/budget rows: the Odds API month-to-date spend
//             (lib/gridiron/oddsBudgetRun.js, since the 1st of the month, so a
//             31-day month plus slack), the CFBD x-calllimit readings
//             (summary.budget, lib/pollers/runRecorder.js) and the live quota
//             tally (kind 'quota:<day>', lib/live/quota.js - read per UTC day).
//
// ===========================================================================
// HOW IT DELETES
// ===========================================================================
// In statements of at most BATCH_ROWS rows, units of MATCHES_PER_UNIT matches
// (the heaviest match holds ~21k rows), so no statement holds a long lock or
// a big transaction, under a per-run row cap and a time budget below the
// route's maxDuration. A run that stops early records a cursor; the next run
// resumes there. Once a full pass completes, later runs only look at matches
// with rows that aged past the cutoff since that pass (the floor), so the
// steady-state run touches days of history, not the table.

export const RETENTION_SOURCE = 'data-retention';
export const ODDS_KEEP_DAYS = 14;
export const LOG_KEEP_DAYS = 30;
export const QUOTA_KEEP_DAYS = 35;
export const BATCH_ROWS = 20_000;
export const MATCHES_PER_UNIT = 10;
export const MAX_ROWS_PER_RUN = 1_000_000;
export const TIME_BUDGET_MS = 240_000;
/** A completed pass's next floor sits this far behind its cutoff. */
export const FLOOR_SLACK_DAYS = 2;

export const LEDGER_SOURCES = Object.freeze([
  'welcome-email', 'welcome-sheet', 'push', 'broadcast', 'email-click',
  'resend-webhook', 'client-error', 'migrations', RETENTION_SOURCE,
]);
// The Odds API spend legs (lib/gridiron/oddsBudgetRun.js SPEND regex).
export const QUOTA_SOURCE_RE = '^[a-z0-9]+-(odds|props|futures)$';

const DAY = 86_400_000;

/** APPLY only on the exact flag. Anything else - unset, 'true', 'ON' - dry-runs. */
export function retentionMode(env = process.env) {
  return env.RETENTION_APPLY === 'on' ? 'apply' : 'dry-run';
}

/** PURE. The cutoffs for a run at `now`. */
export function retentionPlan(now = new Date()) {
  const t = new Date(now).getTime();
  return {
    oddsCutoff: new Date(t - ODDS_KEEP_DAYS * DAY),
    logCutoff: new Date(t - LOG_KEEP_DAYS * DAY),
    quotaCutoff: new Date(t - QUOTA_KEEP_DAYS * DAY),
  };
}

const selKey = (r) => JSON.stringify([
  r.match_id ?? null, r.match_id == null ? (r.league_id ?? null) : null, r.market_scope, r.market_type,
  r.fetcher_version ?? null, r.player_id ?? null, r.team_id ?? null, r.selection_label, r.selection_value ?? null,
]);

/**
 * PURE. The verdict for every odds row, by the rule above - the same rule the
 * SQL below applies (ODDS_VERDICT), written a second time so a test can hold
 * the database to it. `kickoffOf(matchId)` gives a match's kickoff (or null).
 * Returns Map(id -> 'current'|'recent'|'open'|'close'|'last'|'delete').
 */
export function classifyOddsRows(rows, { cutoff, kickoffOf = () => null }) {
  const groups = new Map();
  for (const r of rows) {
    const k = selKey(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const t = (r) => new Date(r.fetched_at).getTime();
  const cmp = (a, b) => t(a) - t(b) || a.id - b.id;
  const cut = new Date(cutoff).getTime();
  const out = new Map();
  for (const g of groups.values()) {
    g.sort(cmp);
    const first = g[0];
    const last = g[g.length - 1];
    const ko = g[0].match_id != null ? kickoffOf(g[0].match_id) : null;
    const koT = ko == null ? null : new Date(ko).getTime();
    const pre = koT == null ? [] : g.filter((r) => t(r) < koT);
    const close = pre.length ? pre[pre.length - 1] : null;
    for (const r of g) {
      let v;
      if (r.is_current) v = 'current';
      else if (t(r) >= cut) v = 'recent';
      else if (r === first) v = 'open';
      else if (r === close) v = 'close';
      else if (r === last) v = 'last';
      else v = 'delete';
      out.set(r.id, v);
    }
  }
  return out;
}

// A KIND IS COMPARED BY ITS HEAD: 'quota:2026-09-01' and 'window:cfb' are
// one kind each per day/window, so "newest of its kind" taken literally would
// make every one of them the newest of a kind of one, kept forever.
const kindHead = (k) => String(k ?? '').split(':')[0];
const leagueOf = (s) => (s && typeof s === 'object' ? (s.summary?.league ?? s.league ?? null) : null);

/**
 * PURE. The ids that are the newest row, and the newest ok row, of their
 * (source, kind head, league) - the same set the SQL's `latest` CTE builds.
 */
export function latestSyncRunIds(rows) {
  const best = new Map();
  for (const r of rows) {
    const k = JSON.stringify([r.source, kindHead(r.kind), Boolean(r.ok), leagueOf(r.summary)]);
    const b = best.get(k);
    const t = new Date(r.started_at).getTime();
    if (!b || t > b.t || (t === b.t && r.id > b.id)) best.set(k, { t, id: r.id });
  }
  return new Set([...best.values()].map((b) => b.id));
}

/**
 * PURE. One sync_runs row's verdict. `latestIds` is the set of ids that are
 * the newest (and newest ok) row of their (source, kind, league).
 */
export function syncRunVerdict(row, { logCutoff, quotaCutoff, latestIds = new Set() }) {
  const at = new Date(row.started_at).getTime();
  if (LEDGER_SOURCES.includes(row.source)) return 'ledger';
  if (String(row.source).startsWith('cron-watchdog') && row.kind === 'flag') return 'watchdog';
  if (at >= new Date(logCutoff).getTime()) return 'recent';
  if (latestIds.has(row.id)) return 'latest';
  const quotaish = String(row.kind).startsWith('quota:')
    || (row.summary && typeof row.summary === 'object' && 'budget' in row.summary)
    || new RegExp(QUOTA_SOURCE_RE).test(row.source);
  if (quotaish && at >= new Date(quotaCutoff).getTime()) return 'quota';
  return 'delete';
}

// ---------------------------------------------------------------------------
// SQL. Text + params through sql.query, so the count and the delete share ONE
// verdict expression and cannot drift apart.
// ---------------------------------------------------------------------------

const ODDS_PARTITION = `o.market_scope, o.market_type, o.fetcher_version, o.player_id, o.team_id,
                        o.selection_label, o.selection_value`;

// $1 = cutoff. `pre` is NULL without a kickoff, so a futures row or a match
// with no kickoff is never a 'close'.
const ODDS_VERDICT = `
  CASE WHEN is_current THEN 'current'
       WHEN fetched_at >= $1::timestamptz THEN 'recent'
       WHEN rn_first = 1 THEN 'open'
       WHEN pre IS TRUE AND rn_close = 1 THEN 'close'
       WHEN rn_last = 1 THEN 'last'
       ELSE 'delete' END`;

/** The scoped rows of one unit: a list of match ids ($2), or the futures ('league'). */
function oddsScoped(unit) {
  if (unit.kind === 'matches') {
    return `
      SELECT o.id, o.is_current, o.fetched_at, pg_column_size(o.*) AS bytes,
             (o.fetched_at < m.kickoff_at) AS pre,
             row_number() OVER (PARTITION BY o.match_id, ${ODDS_PARTITION} ORDER BY o.fetched_at ASC, o.id ASC) AS rn_first,
             row_number() OVER (PARTITION BY o.match_id, ${ODDS_PARTITION} ORDER BY o.fetched_at DESC, o.id DESC) AS rn_last,
             row_number() OVER (PARTITION BY o.match_id, ${ODDS_PARTITION}, (o.fetched_at < m.kickoff_at)
                                ORDER BY o.fetched_at DESC, o.id DESC) AS rn_close
        FROM odds_markets o JOIN matches m ON m.id = o.match_id
       WHERE o.match_id = ANY($2::int[])`;
  }
  return `
      SELECT o.id, o.is_current, o.fetched_at, pg_column_size(o.*) AS bytes,
             NULL::boolean AS pre,
             row_number() OVER (PARTITION BY o.league_id, ${ODDS_PARTITION} ORDER BY o.fetched_at ASC, o.id ASC) AS rn_first,
             row_number() OVER (PARTITION BY o.league_id, ${ODDS_PARTITION} ORDER BY o.fetched_at DESC, o.id DESC) AS rn_last,
             1 AS rn_close
        FROM odds_markets o
       WHERE o.match_id IS NULL`;
}

const unitParams = (unit, cutoff) => (unit.kind === 'matches' ? [cutoff.toISOString(), unit.ids] : [cutoff.toISOString()]);

/** Verdict counts for one unit: [{ verdict, n, bytes, oldest, newest }]. Read-only. */
export async function countOddsUnit(sql, unit, { cutoff }) {
  const rows = await sql.query(`
    WITH scoped AS (${oddsScoped(unit)}),
         v AS (SELECT id, bytes, fetched_at, ${ODDS_VERDICT} AS verdict FROM scoped)
    SELECT verdict, count(*)::int AS n, COALESCE(sum(bytes), 0)::bigint AS bytes,
           min(fetched_at) AS oldest, max(fetched_at) AS newest
      FROM v GROUP BY verdict`, unitParams(unit, cutoff));
  return rows.map((r) => ({ ...r, bytes: Number(r.bytes) }));
}

/** Delete at most `limit` rows of one unit with verdict 'delete'. Returns the count. */
export async function deleteOddsUnit(sql, unit, { cutoff, limit = BATCH_ROWS }) {
  const p = unitParams(unit, cutoff);
  const rows = await sql.query(`
    WITH scoped AS (${oddsScoped(unit)}),
         doomed AS (SELECT id FROM scoped WHERE ${ODDS_VERDICT} = 'delete' LIMIT $${p.length + 1})
    DELETE FROM odds_markets WHERE id IN (SELECT id FROM doomed)
    RETURNING 1`, [...p, limit]);
  return rows.length;
}

/**
 * The match ids whose history may hold something to delete: a non-current
 * row older than the cutoff and, once a full pass has completed, no older
 * than the floor. Sorted, so a cursor can resume.
 */
export async function oddsCandidateMatches(sql, { cutoff, floor = null, after = null }) {
  const rows = await sql.query(`
    SELECT DISTINCT match_id FROM odds_markets
     WHERE match_id IS NOT NULL AND NOT is_current
       AND fetched_at < $1::timestamptz
       AND ($2::timestamptz IS NULL OR fetched_at >= $2::timestamptz)
       AND ($3::int IS NULL OR match_id > $3::int)
     ORDER BY match_id`, [cutoff.toISOString(), floor ? new Date(floor).toISOString() : null, after]);
  return rows.map((r) => Number(r.match_id));
}

/** PURE. Match ids -> units of MATCHES_PER_UNIT. */
export function matchUnits(ids, size = MATCHES_PER_UNIT) {
  const out = [];
  for (let i = 0; i < ids.length; i += size) out.push({ kind: 'matches', ids: ids.slice(i, i + size) });
  return out;
}

// $1 logCutoff, $2 quotaCutoff, $3 ledger sources, $4 quota source regex,
// $5 only these sources (tests; NULL = all).
const SYNC_VERDICT_SQL = `
  WITH latest AS (
    SELECT DISTINCT ON (source, split_part(kind, ':', 1), ok, COALESCE(summary->'summary'->>'league', summary->>'league')) id
      FROM sync_runs
     WHERE ($5::text[] IS NULL OR source = ANY($5::text[]))
     ORDER BY source, split_part(kind, ':', 1), ok, COALESCE(summary->'summary'->>'league', summary->>'league'),
              started_at DESC, id DESC
  ), v AS (
    SELECT s.id, s.started_at, pg_column_size(s.*) AS bytes,
      CASE WHEN s.source = ANY($3::text[]) THEN 'ledger'
           WHEN s.source LIKE 'cron-watchdog%' AND s.kind = 'flag' THEN 'watchdog'
           WHEN s.started_at >= $1::timestamptz THEN 'recent'
           WHEN s.id IN (SELECT id FROM latest) THEN 'latest'
           WHEN (s.kind LIKE 'quota:%' OR (jsonb_typeof(s.summary) = 'object' AND s.summary ? 'budget') OR s.source ~ $4)
                AND s.started_at >= $2::timestamptz THEN 'quota'
           ELSE 'delete' END AS verdict
      FROM sync_runs s
     WHERE ($5::text[] IS NULL OR s.source = ANY($5::text[]))
  )`;

const syncParams = (plan, onlySources) => [
  plan.logCutoff.toISOString(), plan.quotaCutoff.toISOString(), [...LEDGER_SOURCES], QUOTA_SOURCE_RE, onlySources ?? null,
];

/** sync_runs verdict counts. Read-only. */
export async function countSyncRuns(sql, plan, { onlySources = null } = {}) {
  const rows = await sql.query(`${SYNC_VERDICT_SQL}
    SELECT verdict, count(*)::int AS n, COALESCE(sum(bytes), 0)::bigint AS bytes,
           min(started_at) AS oldest, max(started_at) AS newest
      FROM v GROUP BY verdict`, syncParams(plan, onlySources));
  return rows.map((r) => ({ ...r, bytes: Number(r.bytes) }));
}

/** Delete at most `limit` sync_runs rows with verdict 'delete'. */
export async function deleteSyncRuns(sql, plan, { limit = BATCH_ROWS, onlySources = null } = {}) {
  const p = syncParams(plan, onlySources);
  const rows = await sql.query(`${SYNC_VERDICT_SQL}
    DELETE FROM sync_runs WHERE id IN (SELECT id FROM v WHERE verdict = 'delete' LIMIT $6)
    RETURNING 1`, [...p, limit]);
  return rows.length;
}

// ---------------------------------------------------------------------------
// THE LOOP. Pure over an injected `step` and clock, so the batching, the cap
// and the budget are tested without a database.
// ---------------------------------------------------------------------------

/**
 * Drain each unit in order: call step(unit, limit) until it returns fewer
 * than `limit` (the unit is empty), then the next. Stops BEFORE a statement
 * when the run cap is reached or the time budget is spent.
 * @returns {{ rows, statements, unitsDone, stoppedBy: 'done'|'cap'|'budget', perUnit }}
 */
export async function drain(units, step, {
  batchRows = BATCH_ROWS, maxRows = MAX_ROWS_PER_RUN, budgetMs = TIME_BUDGET_MS, clock = Date.now,
} = {}) {
  const t0 = clock();
  let rows = 0;
  let statements = 0;
  let unitsDone = 0;
  const perUnit = [];
  for (const unit of units) {
    let unitRows = 0;
    for (;;) {
      if (rows >= maxRows) return { rows, statements, unitsDone, stoppedBy: 'cap', perUnit };
      if (clock() - t0 >= budgetMs) return { rows, statements, unitsDone, stoppedBy: 'budget', perUnit };
      const limit = Math.min(batchRows, maxRows - rows);
      const n = await step(unit, limit);
      statements += 1;
      rows += n;
      unitRows += n;
      if (n < limit) break;
    }
    unitsDone += 1;
    perUnit.push(unitRows);
  }
  return { rows, statements, unitsDone, stoppedBy: 'done', perUnit };
}

const addVerdicts = (acc, rows) => {
  for (const r of rows) {
    const a = acc[r.verdict] ?? (acc[r.verdict] = { n: 0, bytes: 0, oldest: null, newest: null });
    a.n += r.n;
    a.bytes += r.bytes;
    const o = r.oldest ? new Date(r.oldest).toISOString() : null;
    const w = r.newest ? new Date(r.newest).toISOString() : null;
    if (o && (!a.oldest || o < a.oldest)) a.oldest = o;
    if (w && (!a.newest || w > a.newest)) a.newest = w;
  }
  return acc;
};

/**
 * Where the odds pass starts, from this job's last APPLY row:
 *   none            floor null (the whole table), no cursor;
 *   last completed  floor = its cutoff - FLOOR_SLACK_DAYS, no cursor;
 *   last stopped    the same floor, resume after its cursor.
 */
// A PASS can span runs. Its floor is set by the run that STARTED it
// (passCutoff): a match the pass cleaned on day 1 has had rows age past the
// cutoff on every day since, and a floor taken from the finishing run's cutoff
// would never look at them again.
export function oddsResume(lastApply) {
  const o = lastApply?.odds;
  if (!o) return { floor: null, after: null, passCutoff: null };
  if (o.complete) {
    const from = o.passCutoff ?? o.cutoff;
    return { floor: new Date(new Date(from).getTime() - FLOOR_SLACK_DAYS * DAY).toISOString(), after: null, passCutoff: null };
  }
  return { floor: o.floor ?? null, after: o.cursor ?? null, passCutoff: o.passCutoff ?? o.cutoff ?? null };
}

export async function lastApplySummary(sql) {
  const [r] = await sql`
    SELECT summary FROM sync_runs
     WHERE source = ${RETENTION_SOURCE} AND kind = 'apply' AND ok = true
     ORDER BY started_at DESC LIMIT 1`;
  return r?.summary ?? null;
}

/**
 * ONE RUN. mode 'dry-run' counts every rule (read-only); mode 'apply'
 * deletes. Returns the summary recordRun stores.
 */
export async function runRetention({
  sql, mode, now = new Date(), clock = Date.now, budgetMs = TIME_BUDGET_MS, maxRows = MAX_ROWS_PER_RUN,
  batchRows = BATCH_ROWS, onlyMatchIds = null, onlySources = null, skipFutures = false,
}) {
  const plan = retentionPlan(now);
  const t0 = clock();
  const resume = onlyMatchIds ? { floor: null, after: null, passCutoff: null } : oddsResume(await lastApplySummary(sql));
  const ids = onlyMatchIds
    ? [...onlyMatchIds].sort((a, b) => a - b)
    : await oddsCandidateMatches(sql, { cutoff: plan.oddsCutoff, floor: resume.floor, after: mode === 'apply' ? resume.after : null });
  const units = [...(skipFutures || onlyMatchIds ? [] : [{ kind: 'futures' }]), ...matchUnits(ids)];
  const summary = {
    mode,
    cutoffs: { odds: plan.oddsCutoff.toISOString(), logs: plan.logCutoff.toISOString(), quota: plan.quotaCutoff.toISOString() },
  };

  if (mode !== 'apply') {
    summary.syncRuns = addVerdicts({}, await countSyncRuns(sql, plan, { onlySources }));
    const odds = {};
    let unitsDone = 0;
    for (const u of units) {
      if (clock() - t0 >= budgetMs) break;
      addVerdicts(odds, await countOddsUnit(sql, u, { cutoff: plan.oddsCutoff }));
      unitsDone += 1;
    }
    summary.odds = { floor: resume.floor, candidates: ids.length, units: units.length, unitsDone,
      complete: unitsDone === units.length, verdicts: odds };
    summary.ms = clock() - t0;
    return summary;
  }

  const logs = await drain([{ kind: 'sync_runs' }], (_u, limit) => deleteSyncRuns(sql, plan, { limit, onlySources }),
    { batchRows, maxRows, budgetMs, clock });
  summary.syncRuns = { deleted: logs.rows, statements: logs.statements, stoppedBy: logs.stoppedBy };

  const left = Math.max(0, budgetMs - (clock() - t0));
  const odds = await drain(units, (u, limit) => deleteOddsUnit(sql, u, { cutoff: plan.oddsCutoff, limit }),
    { batchRows, maxRows: Math.max(0, maxRows - logs.rows), budgetMs: left, clock });
  const matchUnitsDone = units.slice(0, odds.unitsDone).filter((u) => u.kind === 'matches');
  const lastDone = matchUnitsDone.length ? matchUnitsDone[matchUnitsDone.length - 1].ids.at(-1) : resume.after;
  summary.odds = {
    cutoff: plan.oddsCutoff.toISOString(), passCutoff: resume.passCutoff ?? plan.oddsCutoff.toISOString(),
    floor: resume.floor, resumedAfter: resume.after,
    candidates: ids.length, units: units.length, unitsDone: odds.unitsDone,
    deleted: odds.rows, statements: odds.statements, stoppedBy: odds.stoppedBy,
    complete: odds.stoppedBy === 'done', cursor: odds.stoppedBy === 'done' ? null : lastDone,
  };
  summary.ms = clock() - t0;
  return summary;
}
