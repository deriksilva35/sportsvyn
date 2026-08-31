// lib/wire/read.js — reading the wire. PURE of JSX.
//
// THE CLUB ALLOWLIST IS APPLIED HERE, AT READ TIME, and nowhere near the
// ingest. Everything a club publishes is stored; what a reader sees is a
// separate decision, so the ruling can change without a re-ingest and the
// stored row remains the evidence for what the club actually said.
//
// NON-ENGLISH ITEMS ARE DROPPED BY THE SAME FILTER, and that is a DECISION
// rather than an accident. Several clubs publish German and Spanish editions on
// the same feed - Seattle put "Mit diesem Kader gehen die Seahawks in die
// Saison 2026" on the wire's first live tick. The allowlist is an English
// pattern, so those fall out. They are real news and we are choosing not to
// carry them, because a wire that mixes languages without labelling them reads
// as broken rather than international. Revisit when there is a locale to serve.

import { sql } from '../db.js';
import { clubAllowed } from './allowlist.js';

/** The lanes a reader can filter by, and what they are called. */
export const WIRE_LANES = Object.freeze([
  { key: 'line', label: 'Lines' },
  { key: 'injury', label: 'Injuries' },
  { key: 'club', label: 'Club' },
  { key: 'final', label: 'Games' },
  { key: 'milestone', label: 'Games' },
  { key: 'contest', label: 'Board' },
  { key: 'record', label: 'Games' },
  { key: 'poll', label: 'Games' },
]);

/** The chip vocabulary - several lanes collapse into one chip. */
export const WIRE_CHIPS = Object.freeze([
  { key: 'lines', label: 'Lines', lanes: ['line'] },
  { key: 'injuries', label: 'Injuries', lanes: ['injury'] },
  { key: 'club', label: 'Club', lanes: ['club'] },
  { key: 'games', label: 'Games', lanes: ['final', 'milestone', 'record', 'poll'] },
  { key: 'board', label: 'Board', lanes: ['contest'] },
]);

export function lanesForChip(chip) {
  const c = WIRE_CHIPS.find((x) => x.key === chip);
  return c ? c.lanes : null;
}

/**
 * A CHIP IS ABSENT WHEN THE LEAGUE HAS NO SOURCE FOR IT, not greyed out. There
 * is no NCAAF injury feed and no college club-site RSS pattern, so /cfb/wire
 * offers neither chip - the same absent-not-disabled rule the nav pills keep.
 */
export function chipsForLeague(leagueSlug) {
  return WIRE_CHIPS.filter((c) => {
    if (leagueSlug === 'cfb' && (c.key === 'injuries' || c.key === 'club')) return false;
    return true;
  });
}

/** Applied to CLUB rows only: every other lane is our own writing. */
export function renderable(rows) {
  return (rows ?? []).filter((r) => (r.lane === 'club' ? clubAllowed(r.headline) : true));
}

/**
 * The wire for one league.
 *
 * OVER-READ THEN FILTER. The club allowlist drops roughly four of five club
 * items, so asking the database for exactly `limit` rows would return a short
 * page. We read a multiple and slice after filtering.
 */
export async function leagueWire(leagueSlug, { limit = 30, offset = 0, chip = null } = {}) {
  const lanes = chip ? lanesForChip(chip) : null;
  if (chip && !lanes) return { items: [], hasMore: false };
  const rows = await sql`
    SELECT n.id, n.lane, n.headline, n.url, n.source, n.published_at, n.seen_at,
           n.take, n.take_generated_at, n.team_ids, n.payload
      FROM news_items n
      JOIN leagues l ON l.id = n.league_id
     WHERE l.slug = ${leagueSlug}
       AND (${lanes}::text[] IS NULL OR n.lane = ANY(${lanes}))
     -- ORDER BY WHEN IT HAPPENED, NOT WHEN WE SAW IT. The day headers group on
     -- published_at, so ordering by seen_at made them jump and repeat -
     -- "Aug 25, Aug 29, Aug 30, Jul 31" down one page, because a backfill saw
     -- three weeks of club items in the same second. Sort and group on the
     -- same clock.
     ORDER BY COALESCE(n.published_at, n.seen_at) DESC, n.id DESC
     -- THE MULTIPLIER IS SIZED TO THE CLUB REJECTION RATE. Roughly four in
     -- five club items are dropped at render, and club is the busiest lane, so
     -- a narrow window returns a short page - measured: 24 rows in, 11 out.
     LIMIT ${limit * 12} OFFSET ${offset}`;
  const kept = renderable(rows);
  return { items: kept.slice(0, limit), hasMore: kept.length > limit };
}

/**
 * The landing module: the newest few, across every lane.
 *
 * "UPDATED N AGO" READS THE SAME CLOCK THE LIST IS SORTED BY. It read seen_at
 * while the list sorted on published_at, so a wire whose newest item was
 * minutes old announced "updated 9 h ago" - the backfill's sighting time. The
 * same two-clock mistake as the day headers, in a different place.
 */
export async function wireTeaser(leagueSlug, { limit = 4 } = {}) {
  const { items } = await leagueWire(leagueSlug, { limit });
  const top = items[0];
  return { items, newest: top ? (top.published_at ?? top.seen_at) : null };
}

/** "updated 4 min ago" / "updated 2 h ago". PURE. */
export function updatedLabel(newest, now = new Date()) {
  if (!newest) return null;
  const mins = Math.floor((new Date(now) - new Date(newest)) / 60000);
  if (mins < 1) return 'updated just now';
  if (mins < 60) return `updated ${mins} min ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `updated ${h} h ago`;
  return `updated ${Math.floor(h / 24)} d ago`;
}

/**
 * THE AGE ON AN ITEM: relative under a day, then the day and the time.
 * PT because that is the clock the product speaks in elsewhere.
 */
export function ageLabel(when, now = new Date()) {
  if (!when) return null;
  const d = new Date(when);
  if (Number.isNaN(d.getTime())) return null;
  const mins = Math.floor((new Date(now) - d) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h`;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', weekday: 'short', hour: 'numeric', minute: '2-digit',
  }).format(d).replace(',', '');
}

/** Sticky day headers group by PT calendar day. PURE. */
export function dayKey(when) {
  if (!when) return 'Undated';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', weekday: 'long', month: 'short', day: 'numeric',
  }).format(new Date(when)).replace(',', '');
}

/**
 * SPLIT A HEADLINE INTO WORDS AND FIGURES. Pure, and it lives here rather than
 * in the component for the same reason the standings columns do: a claim that
 * can only be exercised by rendering a React tree is a claim nobody tests. The
 * component maps these parts to spans.
 *
 * A wire is read by scanning for numbers, so the figures get the mono face and
 * tabular numerals - which makes a column of them line up even inside prose.
 */
export function headlineParts(text) {
  return String(text ?? '')
    .split(/(\d[\d,.:%-]*)/g)
    .filter((p) => p !== '')
    .map((p) => ({ t: p, num: /^\d/.test(p) }));
}
