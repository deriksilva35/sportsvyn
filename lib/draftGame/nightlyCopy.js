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
