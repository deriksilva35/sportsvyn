// lib/time/zoneName.js - "Pacific", "Eastern", "Mountain": a zone's long name,
// without the Standard/Daylight half. ONE function for /scores' header on the
// server (app/scores/page.js) and in the browser (components/scores/ZoneLabel),
// so the two can only disagree about WHICH zone, never about how it is spelled.
//
// tz undefined = the running environment's own zone (the viewer's, in a
// browser). An unknown zone falls back to its own id rather than throwing.

export function zoneNameOf(tz = undefined, now = new Date()) {
  try {
    const name = new Intl.DateTimeFormat('en-US', { ...(tz ? { timeZone: tz } : {}), timeZoneName: 'long' })
      .formatToParts(now).find((p) => p.type === 'timeZoneName')?.value ?? tz;
    return String(name).replace(/ (Standard|Daylight) Time$/, '');
  } catch { return tz ?? ''; }
}
