'use client';

/**
 * LocalTime — client island that renders a UTC ISO timestamp as a
 * SHORT DATETIME in the VISITOR's local timezone, with the zone
 * abbreviation appended ("Thu, 7:00 PM PDT").
 *
 * For TIME-BEARING cells where ambiguity matters: a sports site read
 * across timezones can't render a bare "7:00 PM" — readers in PT and
 * ET would each read it as theirs. Zone abbreviation is the load-
 * bearing piece.
 *
 * Distinct from KickoffTime: that component is the match-page meta
 * strip's "premier" full datetime ("Thu, Jun 4, 12:00 PM PDT"). This
 * one is the compact form ("Thu, 7:00 PM PDT") used in cells where
 * the date is already in an adjacent column (schedule rows,
 * next-match scoreline) or where a full datetime would overflow.
 *
 * Same SSR-stable hydration pattern as LocalDate + KickoffTime:
 *   1. useState initializer formats UTC ("Thu, 7:00 PM UTC") on both
 *      SSR and first client render — identical bytes, no hydration
 *      content-mismatch warning.
 *   2. useEffect on mount swaps to the visitor's local zone via
 *      undefined locale + no timeZone option in Intl.DateTimeFormat.
 */

import { useEffect, useState } from 'react';

const OPTIONS = {
  weekday: 'short',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
};

function formatUtc(iso) {
  return new Intl.DateTimeFormat('en-US', { ...OPTIONS, timeZone: 'UTC' }).format(new Date(iso));
}

function formatLocal(iso) {
  return new Intl.DateTimeFormat(undefined, OPTIONS).format(new Date(iso));
}

export default function LocalTime({ iso }) {
  const [label, setLabel] = useState(() => formatUtc(iso));
  useEffect(() => { setLabel(formatLocal(iso)); }, [iso]);
  return <>{label}</>;
}
