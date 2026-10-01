// lib/eplWeekly5/labels.js - the gameweek's date window, PURE.
//
// "Sat 10 – Mon 12 Oct", in a zone the caller names: tz null renders the ET
// fallback the server emits (the StandaloneTime law - lib/time/standaloneLabel.js),
// undefined the viewer's own zone, a string forces one. The client component
// (components/eplWeekly5/WindowLabel.js) renders the fallback, then the
// viewer's zone after mount.

function parts(iso, tz) {
  const useEastern = tz === null;
  const f = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
    ...(useEastern ? { timeZone: 'America/New_York' } : {}),
    ...(tz ? { timeZone: tz } : {}),
  }).formatToParts(new Date(iso));
  const v = (t) => f.find((p) => p.type === t)?.value ?? '';
  return { wd: v('weekday'), d: v('day'), m: v('month') };
}

export function windowLabel(firstIso, lastIso, opts = {}) {
  if (!firstIso) return '';
  const tz = 'tz' in opts ? opts.tz : null;
  const a = parts(firstIso, tz);
  const b = parts(lastIso ?? firstIso, tz);
  if (a.wd === b.wd && a.d === b.d && a.m === b.m) return `${a.wd} ${a.d} ${a.m}`;
  return a.m === b.m ? `${a.wd} ${a.d} – ${b.wd} ${b.d} ${b.m}` : `${a.wd} ${a.d} ${a.m} – ${b.wd} ${b.d} ${b.m}`;
}
