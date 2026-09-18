// lib/testing/fixtureMark.mjs - A FIXTURE THAT ONLY EVER DELETES ITS OWN ROWS.
//
// ============================================================================
// THE DEFECT, TWICE, ON TWO DIFFERENT NIGHTS
// ============================================================================
// Suite fixtures identify their rows by a shared LIKE pattern and clean up
// with `DELETE ... WHERE email LIKE 'collegesurface-%@example.invalid'`. That
// is correct for one run and wrong for two, and `node --test` runs files in
// parallel:
//
//   collegeSurface.test.mjs's `after` hook wipes the pattern and then asserts
//   the count is zero. A second run of the same file inserting between that
//   DELETE and that SELECT makes the first one fail - which is exactly what
//   chunk B produced, intermittently, for two relays running.
//
//   And worse, silently: drafts.test.mjs wipes 'simtest-%@example.invalid',
//   which MATCHES leagueShare.test.mjs's 'simtest-share-...' users. One file's
//   cleanup deletes another file's fixtures mid-test. Nobody saw it because
//   the two are in different chunks today; a full-suite run puts them side by
//   side.
//
// THE FIX IS A MARKER THAT CANNOT COLLIDE. pid plus a high-resolution start
// stamp: unique per process, so a pattern built from it matches this run's
// rows and no other's - including another run of the same file, on the same
// database, at the same moment.
//
// IT IS STILL A PATTERN, DELIBERATELY. Fixtures insert several rows and want
// one predicate to remove them all; what changes is that the pattern is
// scoped to the run rather than to the file.
//
// LEFTOVERS FROM A KILLED RUN ARE A SEPARATE PROBLEM, and this does not make
// them worse: sweepStale() below removes rows older than an hour carrying the
// same family prefix, so a run reaped mid-test cannot poison the next one
// either. An hour is long enough that it can never touch a live sibling run.

import { hrtime } from 'node:process';

/** Unique per process: pid, plus the nanosecond clock at module load. */
const RUN = `${process.pid}x${hrtime.bigint().toString(36).slice(-8)}`;

/**
 * A fixture identity for one family of rows in one run.
 *
 * @param {string} family e.g. 'collegesurface' - what these rows are for
 * @returns {{ run: string, email: (tag?: string) => string, like: string,
 *             family: string, staleLike: string }}
 *   email('a')  -> 'collegesurface-<run>-a@example.invalid'
 *   like        -> 'collegesurface-<run>-%@example.invalid'  THIS RUN ONLY
 *   staleLike   -> 'collegesurface-%@example.invalid'        the whole family
 */
export function fixtureMark(family) {
  const f = String(family).replace(/[^a-z0-9]/gi, '').toLowerCase();
  return {
    family: f,
    run: RUN,
    email: (tag = 'x') => `${f}-${RUN}-${String(tag).replace(/[^a-z0-9]/gi, '')}@example.invalid`,
    // users.handle carries its OWN unique index - idx_users_handle_lower
    // (migration 066) - so a fixture that sets a handle needs a run-scoped one
    // or two runs collide on the index rather than on the email.
    handle: (tag = 'x') => `${f}${RUN}${String(tag).replace(/[^a-z0-9]/gi, '')}`.toLowerCase().slice(0, 30),
    like: `${f}-${RUN}-%@example.invalid`,
    staleLike: `${f}-%@example.invalid`,
  };
}

/**
 * Remove this family's rows left behind by a run that died before its own
 * cleanup - and ONLY those, never a sibling's live rows.
 *
 * THE HOUR IS THE SAFETY MARGIN. No suite file runs for an hour, so anything
 * that old belongs to nobody. Called from `before`, where a stale row would
 * otherwise be inherited.
 */
export async function sweepStale(sql, mark, { table = 'users', column = 'email', ageHours = 1 } = {}) {
  const rows = await sql.query(
    `DELETE FROM ${table} WHERE ${column} LIKE $1 AND created_at < now() - ($2 || ' hours')::interval RETURNING 1`,
    [mark.staleLike, String(ageHours)],
  ).catch(() => ({ rows: [] }));
  return (rows.rows ?? rows ?? []).length;
}
