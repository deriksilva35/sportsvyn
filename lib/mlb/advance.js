// lib/mlb/advance.js - the postseason ADVANCE: re-running the import that stages
// games, opens October's days, The Run's rounds and the series boards, as the
// bracket fills in (tue-2).
//
// WHAT IT RUNS. scripts/mlb-postseason-import.mjs --prod --apply <season>, with
// DATABASE_URL pointed at PROD (fa80e73: the apply refuses otherwise). It is
// idempotent: staged games stay staged, an opened day/round/board is found and
// kept. No standings import - the seeds are final for the postseason.
//
// WHEN. Two triggers, one job (services/mlb-advance):
//   a. the live poller, when the LAST MLB game of an ET day goes final - no
//      other MLB game that day live or still to play - schedules it five
//      minutes out (BDL needs a moment to list the next series' games);
//   b. a systemd timer at 10:00Z, the safety net.
// systemd never runs one oneshot unit twice at once, and the job takes its own
// lock (lib/ops/runLock.js) so a manual run cannot overlap either.
//
// THIS FILE IS PURE: the day-done rule, the import's output parsed into one
// summary, and the journal line. The query, the lock and the process live
// elsewhere so these can be tested without any of them.

/** Statuses that mean a game will not be played later that day. */
const DONE = new Set(['final', 'cancelled', 'not_needed', 'postponed', 'suspended']);

/**
 * IS THIS ET DAY'S SLATE OVER? `games` is every MLB game on one ET day (a
 * doubleheader is simply two rows). Over means at least one final and nothing
 * live or still scheduled - a day of only postponements never "ends" into an
 * advance, because nothing was decided.
 */
export function slateDone(games = []) {
  if (!games.length) return false;
  if (!games.some((g) => g?.status === 'final')) return false;
  return games.every((g) => DONE.has(g?.status));
}

const num = (s) => (s == null ? 0 : Number(s) || 0);

/**
 * THE IMPORT'S OUTPUT, READ. The script prints a fixed shape
 * (scripts/mlb-postseason-import.mjs); this reads the numbers back out of it.
 *   staged    games placed in a round (the round table's rows, not unstaged)
 *   refused   games the writer would not write (unknown clubs: BDL's
 *             placeholder rows for series not yet decided)
 *   opened    what this run CREATED: october days, run rounds, boards
 *   unplaced  series with two KNOWN clubs that could not be given a round -
 *             the failure that needs a human. A key with UNK in it is a
 *             placeholder and is expected, never reported.
 */
export function parseImportOutput(text = '') {
  const lines = String(text).split('\n');
  const out = { applied: false, staged: 0, unstaged: 0, inserted: 0, updated: 0, refused: 0,
    opened: { octoberDays: 0, runRounds: 0, boards: 0 }, unplaced: [], refusedToRun: null, notNeeded: [] };
  let section = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const refuse = /^REFUSE: (.*)$/.exec(line.trim());
    if (refuse && !out.refusedToRun) out.refusedToRun = refuse[1];
    const round = /^ {2}(Wild Card|Division Series|Championship Series|World Series)\s+(\d+)\s+(\d+)/.exec(line);
    if (round) { out.staged += num(round[2]); continue; }
    const uns = /^ {2}\(unstaged\)\s+(\d+)/.exec(line);
    if (uns) { out.unstaged = num(uns[1]); continue; }
    const app = /^APPLIED\s+inserted (\d+) \| updated (\d+) \| refused (\d+)/.exec(line);
    if (app) { out.applied = true; out.inserted = num(app[1]); out.updated = num(app[2]); out.refused = num(app[3]); continue; }
    // NOT NEEDED (thu-26): our own decision, so the journal names each game.
    if (/^ {2}not needed \d+/.test(line)) { section = 'notNeeded'; continue; }
    if (section === 'notNeeded') {
      const m = /^ {4}(mlb-\S+)\s/.exec(line);
      if (m) { out.notNeeded.push(m[1]); continue; }
      if (/^ {4}october contest/.test(line)) continue;
      section = null;
    }
    if (/^ {2}COULD NOT PLACE/.test(line)) { section = 'unplaced'; continue; }
    if (/^ {2}october days/.test(line)) { section = 'october'; continue; }
    if (/^ {2}the run/.test(line)) { section = 'run'; continue; }
    if (/^ {2}round boards/.test(line)) { section = 'boards'; continue; }
    if (/^ {2}\S/.test(line) && !/^ {4}/.test(line)) section = section === 'unplaced' ? null : section;
    if (section === 'unplaced') {
      const m = /^ {4}(\S+)\s+\[/.exec(line);
      if (m && !/UNK/i.test(m[1]) && !out.unplaced.includes(m[1])) out.unplaced.push(m[1]);
      continue;
    }
    if (/\bCREATED\b/.test(line)) {
      if (section === 'october') out.opened.octoberDays += 1;
      else if (section === 'run') out.opened.runRounds += 1;
      else if (section === 'boards') out.opened.boards += 1;
    }
  }
  return out;
}

/**
 * ONE JOURNAL LINE PER RUN, fixed shape so a grep over a month reads as a table:
 *   [mlb-advance] staged 12 / opened {october days 3, run rounds 1, boards 1} / refused 41 / unplaced none
 * A run that did not apply says why instead of pretending to counts.
 */
export function journalLine(s, { trigger = 'manual' } = {}) {
  if (s.refusedToRun) return `[mlb-advance] ${trigger} REFUSED: ${s.refusedToRun}`;
  if (!s.applied) return `[mlb-advance] ${trigger} DID NOT APPLY (no APPLIED line in the import output)`;
  const o = s.opened;
  const unplaced = s.unplaced.length ? `UNPLACED ${s.unplaced.join(', ')}` : 'unplaced none';
  const moot = s.notNeeded?.length ? ` / not needed ${s.notNeeded.join(', ')}` : '';
  return `[mlb-advance] ${trigger} staged ${s.staged} / opened {october days ${o.octoberDays}, run rounds ${o.runRounds}, boards ${o.boards}} / refused ${s.refused} / ${unplaced}${moot}`;
}

/** The ET calendar day of an instant, YYYY-MM-DD - the day October files a game under. */
export function etDay(iso) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(iso)).reduce((a, x) => (a[x.type] = x.value, a), {});
  return `${p.year}-${p.month}-${p.day}`;
}

/** The transient unit that kicks the job for one day - its name is what makes "once per day" hold across poller restarts. */
export const kickUnitName = (day) => `sportsvyn-mlb-advance-kick-${day}`;
export const ADVANCE_UNIT = 'sportsvyn-mlb-advance@event.service';
export const KICK_DELAY_SEC = 300;
