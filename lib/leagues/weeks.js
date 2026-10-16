// lib/leagues/weeks.js - a league's calendar, PURE (no DB): the Tuesday-to-
// Monday ET week every weekly surface uses, and whether a bucket's time is up.
// results.js and guillotine.js re-export these; they live here so the pure
// modules (home.js, crew.js) can use them without importing the database.

/** The Tuesday on or before an ET date ('YYYY-MM-DD'). */
export function tuesdayOf(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const back = (t.getUTCDay() - 2 + 7) % 7;
  return new Date(t.getTime() - back * 86_400_000).toISOString().slice(0, 10);
}

/** The ET date of an instant. */
export function etDate(now = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).reduce((a, x) => (a[x.type] = x.value, a), {});
  return `${p.year}-${p.month}-${p.day}`;
}

/** Has a bucket's time run out? week: its Tuesday + 7 days; day: the next day (ET dates). */
export function bucketOver(bucket, unit, now = new Date()) {
  const today = etDate(now);
  const [y, m, d] = bucket.split('-').map(Number);
  const end = new Date(Date.UTC(y, m - 1, d) + (unit === 'week' ? 7 : 1) * 86_400_000).toISOString().slice(0, 10);
  return today >= end;
}
