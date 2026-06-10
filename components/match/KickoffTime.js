'use client';

/**
 * KickoffTime — client island that renders the match kickoff in the
 * VISITOR's local timezone with the zone abbreviation appended.
 *
 * Storage is clean UTC (matches.kickoff_at is timestamptz). The server
 * doesn't know the visitor's zone, so it can't safely render a local
 * time during SSR — guessing the visitor's zone and overwriting after
 * hydration would (a) cause a hydration-content mismatch warning and
 * (b) flash one time-shifted value before settling on another.
 *
 * Render strategy:
 *   1. SSR + first client render: both produce the UTC time labeled
 *      "UTC" via the deterministic formatUtc(kickoffAt). Identical
 *      bytes → no hydration warning.
 *   2. After mount, useEffect computes the visitor-local time via
 *      formatLocal(kickoffAt) and setState updates the rendered value.
 *      The swap happens AFTER hydration completes; React doesn't treat
 *      it as a mismatch.
 *
 * The UTC pre-hydration value is informative on its own (a reader on
 * a JS-disabled browser still sees a real kickoff time, just labeled
 * UTC), and length-stable so the layout doesn't shift on swap:
 *   pre:  "Thu, Jun 4, 7:00 PM UTC"
 *   post: "Thu, Jun 4, 12:00 PM PDT"
 * Same fonts (parent .match-meta-value mono treatment), same color
 * (parent .volt), same approximate length.
 *
 * Locale: undefined on formatLocal → uses the visitor's browser locale.
 * formatUtc explicitly pins 'en-US' so the SSR string is deterministic
 * regardless of the runtime's default locale.
 */

import { useEffect, useState } from 'react';

// Assemble the formatted string from parts ourselves rather than calling
// .format() — the locale-specific connector between date and time
// ("Thu, Jun 11, 7:00 PM" vs "Thu, Jun 11 at 7:00 PM") varies between
// ICU versions, and Node 20 + a recent Chrome happen to pick different
// connectors. That landed as a hydration warning on /schedule once the
// WC slate started rendering MatchCards. formatToParts is deterministic
// across runtimes for the parts we ask for; the join template is ours.
function formatFromParts(parts, zoneLabel) {
  const v = (t) => parts.find((p) => p.type === t)?.value ?? '';
  const weekday = v('weekday');
  const month   = v('month');
  const day     = v('day');
  const hour    = v('hour');
  const minute  = v('minute');
  const period  = v('dayPeriod');
  return `${weekday}, ${month} ${day}, ${hour}:${minute} ${period} ${zoneLabel}`;
}

function formatUtc(iso) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC',
  });
  return formatFromParts(fmt.formatToParts(new Date(iso)), 'UTC');
}

function formatLocal(iso) {
  // Pin 'en-US' for the part labels (the visible text stays consistent
  // with the SSR string format). Visitor's local zone comes from
  // resolvedOptions(); the zone label is the short name in that zone.
  const fmt = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });
  const parts = fmt.formatToParts(new Date(iso));
  const zoneLabel = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  return formatFromParts(parts, zoneLabel);
}

export default function KickoffTime({ kickoffAt }) {
  // useState initializer runs once per render path (SSR + first client
  // render). Both compute the same UTC string via the deterministic
  // formatter, so the hydration content matches.
  const [label, setLabel] = useState(() => formatUtc(kickoffAt));

  useEffect(() => {
    setLabel(formatLocal(kickoffAt));
  }, [kickoffAt]);

  return <>{label}</>;
}
