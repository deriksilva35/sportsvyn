// lib/draftGame/nightlyCopy.js - THE NBA NIGHTLY DRAFT'S WORDS (tue-6). PURE,
// client-safe (no database). Every clock the Nightly Draft prints is PACIFIC,
// per Derik's spec ("locks 4:00 PM PT", "vs NYK · 4:00 PM PT"), so the one zone
// rule lives here and nowhere else (lib/time/zoneGuard.test.mjs ALLOW).
import { timeLabel } from '../time/display.js';

const PACIFIC = 'America/Los_Angeles';

/** "4:00 PM PT". */
export const ptClock = (iso) => `${timeLabel(iso, { tz: PACIFIC, zone: false })} PT`;

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const dayLabel = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).replace(',', '').toUpperCase();

/** The room header: "TUE OCT 20 · 2 games · 4 drafters · 3 picks · locks 4:00 PM PT". */
export function nightlyHeader({ dayEt, games = [], shape, kickoffAt, phase }) {
  const head = `${dayLabel(dayEt)} · ${plural(games.length, 'game')}`;
  if (phase === 'final') return `${head} · FINAL`;
  if (phase === 'void') return `${head} · OFF`;
  if (phase === 'live') return `${head} · LIVE`;
  return `${head} · ${shape.seats} drafters · ${shape.rounds} picks · locks ${ptClock(kickoffAt)}`;
}

/** A pool row's line: "vs NYK · 4:00 PM PT · avg 45.2". */
export const rowLine = (p) => `${p.home ? 'vs' : '@'} ${p.opp} · ${ptClock(p.tip)} · avg ${Number(p.proj).toFixed(1)}`;

/** The Play card's status: "2 games · locks 4:00 PM PT" (or "· locked"). */
export const cardStatus = ({ games, locksAt, locked }) => (locked ? `${plural(games, 'game')} · locked` : `${plural(games, 'game')} · locks ${ptClock(locksAt)}`);

// ---- wed-1b: the room header, the finish screen and their small words --------

/** The header's two lines: line 1 "TUE OCT 20 · 2 games", line 2 "4 drafters · 3 picks · locks 4:00 PM PT". */
export function nightlyHeadLines({ dayEt, games = [], shape, kickoffAt }) {
  return { line1: `${dayLabel(dayEt)} · ${plural(games.length, 'game')}`, line2: `${shape.seats} drafters · ${plural(shape.rounds, 'pick')} · locks ${ptClock(kickoffAt)}` };
}

/** "Round 1 of 3 · your pick" / "Round 1 of 3 · Bot A's pick". `onClockLabel` is the seat label on the clock. */
export function roundLine({ round, rounds, yourTurn, onClockLabel = null }) {
  const head = `Round ${round} of ${rounds}`;
  if (yourTurn) return `${head} · your pick`;
  return onClockLabel ? `${head} · ${onClockLabel}'s pick` : head;
}

/** "G · F · UTIL · all 3 count". */
export const lineupLine = (shape) => `${(shape.slots ?? []).join(' · ')} · all ${shape.count ?? shape.rounds} count`;

/** The clock pill: 24 -> "0:24", 125 -> "2:05". */
export const clockText = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;
/** The clock pill turns red under 0:05. */
export const clockLow = (s) => s < 5;

const WORDS = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN'];
/** 3 -> "THREE"; past ten, the digit. */
export const numberWord = (n) => WORDS[n] ?? String(n);
/** "YOUR THREE ARE IN". */
export const finishTitle = (rounds) => `YOUR ${numberWord(rounds)} ARE IN`;

/** "in 2 h 07 m", "in 7 m", "in 40 s", "now". */
export function countdownText(ms) {
  if (!(ms > 0)) return 'now';
  const mins = Math.floor(ms / 60000);
  if (mins >= 60) return `in ${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')} m`;
  if (mins >= 1) return `in ${mins} m`;
  return `in ${Math.max(1, Math.floor(ms / 1000))} s`;
}

/** A seat's total of averages (sum of proj). */
export const avgTotal = (picks) => (picks ?? []).reduce((a, p) => a + Number(p.proj ?? 0), 0);
/** The best total of averages among seats ([{ picks }]). */
export const roomBest = (seats) => Math.max(0, ...(seats ?? []).map((s) => avgTotal(s.picks)));

/** "Shai Gilgeous-Alexander" -> "Gilgeous-Alexander"; a suffix stays with it ("Jaren Jackson Jr." -> "Jackson Jr."). */
export function surname(name) {
  const parts = String(name ?? '').trim().split(/\s+/);
  if (parts.length <= 1) return parts[0] ?? '';
  const last = parts[parts.length - 1];
  return /^(jr\.?|sr\.?|ii|iii|iv)$/i.test(last) && parts.length > 2 ? `${parts[parts.length - 2]} ${last}` : last;
}
/** "Maxey · Bridges · Brunson". */
export const surnames = (picks) => (picks ?? []).map((p) => surname(p.name)).join(' · ');

/** A taken row's line: "taken by Bot A · Rd 1". */
export const takenLine = (p) => `taken by ${p.takenBy}${p.takenRound ? ` · Rd ${p.takenRound}` : ''}`;

/** The ET day after `day` ("2026-10-20" -> "2026-10-21"). */
export function nextDay(day) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** "Tomorrow: 11 games · 6 drafters · 5 picks", or null when tomorrow has no room. */
export function tomorrowLine(meta) {
  const n = Array.isArray(meta?.games) ? meta.games.length : 0;
  if (!n || !meta?.seats || !meta?.rounds) return null;
  return `Tomorrow: ${plural(n, 'game')} · ${meta.seats} drafters · ${plural(meta.rounds, 'pick')}`;
}

/** The share sheet's text. */
export const shareThree = (picks) => `My NBA Nightly Draft on Sportsvyn: ${surnames(picks)}.`;
