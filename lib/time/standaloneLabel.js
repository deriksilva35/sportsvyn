// lib/time/standaloneLabel.js - THE TIME STRING, PURE.
//
// Extracted from components/StandaloneTime.js (weekly-hdr relay). The
// component is a client component and cannot be imported by a test without a
// JSX transform; the first version of that test compiled it into a temp module
// inside components/, which `npx eslint` running beside the suite read and
// then failed on when it vanished. A formatter five surfaces depend on should
// be callable directly.
//
// THE DAY AND THE HOUR COME FROM ONE Intl CALL, always. Asking a second
// formatter for the weekday is how "Sun 11:30 PM" becomes "Mon 11:30 PM" for a
// reader whose zone crosses midnight between the two calls.

function formatFromParts(parts, zoneLabel) {
  const v = (t) => parts.find((p) => p.type === t)?.value ?? '';
  const day = v('weekday');
  const time = `${v('hour')}:${v('minute')} ${v('dayPeriod')}`;
  return `${day ? `${day} ` : ''}${time}${zoneLabel ? ` ${zoneLabel}` : ''}`;
}

/**
 * @param {string} iso
 * @param {{weekday?: boolean, zone?: boolean, tz?: string|null}} opts
 *   weekday  prepend "Thu " - for boards whose rows span days (the Weekly).
 *   zone     false drops " PDT" - the suffix belongs once per screen.
 *   tz       null renders the ET fallback the SERVER emits; undefined renders
 *            the viewer's own zone with its short name; a string forces one.
 */
export function standaloneTimeLabel(iso, opts = {}) {
  const { weekday = false, zone = true } = opts;
  // NO DEFAULT ON tz, AND THAT IS THE FIX (thu-26). It used to be `tz = null`,
  // and a destructuring default fires for undefined too - so the client's
  // "viewer's own zone" call (tz: undefined) rendered the ET fallback. Every
  // StandaloneTime on the site printed "5:00 PM ET" after mount, under a
  // /scores header that said "all times Pacific". Absent key = ET fallback,
  // as before; undefined passed on purpose = the viewer's zone, as documented.
  const tz = 'tz' in opts ? opts.tz : null;
  const useEastern = tz === null;
  const fmt = new Intl.DateTimeFormat('en-US', {
    ...(weekday ? { weekday: 'short' } : {}),
    hour: 'numeric', minute: '2-digit', hour12: true,
    ...(useEastern ? { timeZone: 'America/New_York' } : {}),
    ...(tz ? { timeZone: tz } : {}),
    ...(useEastern ? {} : { timeZoneName: 'short' }),
  });
  const parts = fmt.formatToParts(new Date(iso));
  const label = useEastern ? 'ET' : (parts.find((p) => p.type === 'timeZoneName')?.value ?? '');
  return formatFromParts(parts, zone ? label : '');
}
