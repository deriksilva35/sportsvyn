// lib/ops/cronExpr.js - a five-field cron expression, read the way Vercel
// reads vercel.json: in UTC, minute granularity. PURE.
//
// WHY IT EXISTS. The cron watchdog (lib/ops/cronWatchdog.js) has to know when
// a job SHOULD last have produced a row, and for a windowed schedule like
// pickem-settle's "0 6-20 * * 0,1,2" that is not "now minus an hour": on a
// Wednesday the last expected fire is Tuesday 20:00Z. Typing an interval next
// to each job would be a second copy of the schedule that drifts the first
// time somebody edits vercel.json; deriving it from the expression cannot.
//
// SUPPORTED: numbers, '*', lists (a,b), ranges (a-b), steps (*/n, a-b/n,
// a/n). Day-of-week 0-7 with 7 = Sunday. When BOTH day-of-month and
// day-of-week are restricted, a day matches if EITHER does (the classic cron
// rule). NOT SUPPORTED, and refused loudly rather than misread: names (MON,
// JAN), '?', 'L', 'W', '#', and anything out of range.

const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day-of-month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'day-of-week', min: 0, max: 7 },
];

const MINUTE = 60_000;
const DAY = 86_400_000;

function parseField(text, { name, min, max }) {
  const out = new Set();
  for (const part of text.split(',')) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new Error(`cron ${name}: cannot read '${part}'`);
    const step = m[2] == null ? 1 : Number(m[2]);
    if (!(step >= 1)) throw new Error(`cron ${name}: step must be >= 1 in '${part}'`);
    let lo; let hi;
    if (m[1] === '*') { lo = min; hi = max; }
    else if (m[1].includes('-')) { [lo, hi] = m[1].split('-').map(Number); }
    else { lo = Number(m[1]); hi = m[2] == null ? lo : max; }   // 'a/n' runs a..max
    if (lo < min || hi > max || lo > hi) throw new Error(`cron ${name}: '${part}' is outside ${min}-${max}`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

/** Parse a five-field expression. Throws on anything it cannot read exactly. */
export function parseCron(expr) {
  const parts = String(expr ?? '').trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`cron: expected 5 fields, got ${parts.length} in '${expr}'`);
  const [minutes, hours, doms, months, dowsRaw] = parts.map((p, i) => parseField(p, FIELDS[i]));
  const dows = new Set([...dowsRaw].map((d) => (d === 7 ? 0 : d)));
  return {
    minutes: [...minutes].sort((a, b) => a - b),
    hours: [...hours].sort((a, b) => a - b),
    doms, months, dows,
    // "Restricted" is about what was WRITTEN, not the resulting set: '*' and
    // '*/1' leave the field open, which is what the either-or rule keys on.
    domOpen: /^\*(\/1)?$/.test(parts[2]),
    dowOpen: /^\*(\/1)?$/.test(parts[4]),
  };
}

function dayMatches(c, dayMs) {
  const d = new Date(dayMs);
  if (!c.months.has(d.getUTCMonth() + 1)) return false;
  const dom = c.doms.has(d.getUTCDate());
  const dow = c.dows.has(d.getUTCDay());
  if (c.domOpen && c.dowOpen) return true;
  if (c.domOpen) return dow;
  if (c.dowOpen) return dom;
  return dom || dow;
}

const asCron = (expr) => (typeof expr === 'string' ? parseCron(expr) : expr);

/**
 * The latest fire time at or before `t` (a fire AT t counts), or null when
 * there is none in the `lookbackDays` before it.
 */
export function prevFire(expr, t, { lookbackDays = 800 } = {}) {
  const c = asCron(expr);
  const at = Math.floor(new Date(t).getTime() / MINUTE) * MINUTE;
  if (!Number.isFinite(at)) throw new Error(`prevFire: bad time '${t}'`);
  const startDay = Math.floor(at / DAY) * DAY;
  const minsDesc = [...c.minutes].reverse();
  const hoursDesc = [...c.hours].reverse();
  for (let i = 0; i <= lookbackDays; i++) {
    const day = startDay - i * DAY;
    if (!dayMatches(c, day)) continue;
    for (const h of hoursDesc) {
      for (const m of minsDesc) {
        const f = day + h * 3_600_000 + m * MINUTE;
        if (f <= at) return new Date(f);
      }
    }
  }
  return null;
}

/** Every fire in [from, to], ascending. For tests and the interval below. */
export function firesBetween(expr, from, to) {
  const c = asCron(expr);
  const lo = new Date(from).getTime();
  const hi = new Date(to).getTime();
  const out = [];
  for (let day = Math.floor(lo / DAY) * DAY; day <= hi; day += DAY) {
    if (!dayMatches(c, day)) continue;
    for (const h of c.hours) {
      for (const m of c.minutes) {
        const f = day + h * 3_600_000 + m * MINUTE;
        if (f >= lo && f <= hi) out.push(f);
      }
    }
  }
  return out.map((f) => new Date(f));
}

// A fixed reference so the answer is a property of the expression alone and
// never of the day it is asked on. Fifteen days holds two fires of any weekly
// schedule; a rarer one falls through to a wider look.
const REF = Date.UTC(2026, 0, 1);

/**
 * The schedule's NOMINAL interval in ms: the SHORTEST gap between two
 * consecutive fires. "0 6-20 * * 0,1,2" is hourly (its overnight and
 * mid-week gaps are the window being closed, not the cadence); "0 15 * * 1"
 * is a week; "30 20,2 * * *" is six hours. null when it fires at most once in
 * the look.
 */
export function minIntervalMs(expr) {
  for (const days of [15, 800]) {
    const fires = firesBetween(expr, REF, REF + days * DAY);
    if (fires.length < 2) continue;
    let best = Infinity;
    for (let i = 1; i < fires.length; i++) best = Math.min(best, fires[i] - fires[i - 1]);
    return best;
  }
  return null;
}
