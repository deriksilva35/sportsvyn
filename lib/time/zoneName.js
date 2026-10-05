// lib/time/zoneName.js - "Pacific", "Eastern", "Mountain", "UTC": a zone's SHORT
// name, without the Standard/Daylight half. ONE function for /scores' header on the
// server (app/scores/page.js) and in the browser (components/scores/ZoneLabel),
// so the two can only disagree about WHICH zone, never about how it is spelled.
//
// tz undefined = the running environment's own zone (the viewer's, in a
// browser). An unknown zone falls back to its own id rather than throwing.

// THE SHORT FORM, NEVER THE OFFICIAL NAME (mon-16). A reader in UTC was told
// "Coordinated Universal Time" on the Play page. The rule: the zone's short
// name ("Pacific", "Eastern", "Central European"), with UTC and GMT as their
// letters; and anything Intl can only spell as a long official name falls to
// its abbreviation (lib/time/display.js zoneAbbr's answer). lib/time/
// zoneName.test.mjs walks every zone the runtime knows and refuses a long name.
const EXACT = Object.freeze({
  'Coordinated Universal Time': 'UTC',
  'Greenwich Mean Time': 'GMT',
});

function shortAbbr(tz, now) {
  const opt = { ...(tz ? { timeZone: tz } : {}), timeZoneName: 'short' };
  const us = new Intl.DateTimeFormat('en-US', opt).formatToParts(now).find((p) => p.type === 'timeZoneName')?.value ?? '';
  if (us && !/^GMT[+-]/.test(us)) return us;
  const gb = new Intl.DateTimeFormat('en-GB', opt).formatToParts(now).find((p) => p.type === 'timeZoneName')?.value ?? '';
  return gb && !/^GMT[+-]/.test(gb) ? gb : (us || tz || '');
}

export function zoneNameOf(tz = undefined, now = new Date()) {
  try {
    const name = String(new Intl.DateTimeFormat('en-US', { ...(tz ? { timeZone: tz } : {}), timeZoneName: 'long' })
      .formatToParts(now).find((p) => p.type === 'timeZoneName')?.value ?? tz);
    if (EXACT[name]) return EXACT[name];
    const short = name.replace(/ (Standard|Daylight|Summer) Time$/, '');
    if (!/\bTime\b/.test(short) && !/^GMT[+-]/.test(short)) return short;
    return shortAbbr(tz, now);
  } catch { return tz ?? ''; }
}
