// lib/gridiron/oddsFormat.js — pure, client-safe odds display helpers.
//
// NO db import: this module is bundled into the client (OddsStrip renders inside
// the Scoreboard client tree) and unit-tested directly with no env. All the
// odds READ logic lives in oddsReader.js (server); this is display math only.

// Re-normalize two de-vigged implied percentages so they sum to EXACTLY 100.0.
// The stored implied_probability values are already de-vigged (sum ~100) but each
// is rounded to 2dp independently, so they can drift to 99.99 / 100.01; the bar
// must fill. Returns { a, b } at 1dp summing to 100, or null if unusable.
export function normalizeTwoWayPct(aImplied, bImplied) {
  if (aImplied == null || bImplied == null) return null; // Number(null) is 0 — guard first
  const a = Number(aImplied);
  const b = Number(bImplied);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a + b <= 0) return null;
  const aPct = Math.round((a / (a + b)) * 1000) / 10;
  const bPct = Math.round((100 - aPct) * 10) / 10;
  return { a: aPct, b: bPct };
}

export function formatAmerican(n) {
  if (n == null) return null;
  return n > 0 ? `+${n}` : `${n}`;
}

export function formatSignedPct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
}

// Freeze-at-kickoff: the pre-kickoff consensus strip renders ONLY for scheduled
// games. Live/final surfaces never show it (the line is a pre-game read).
export function isPreGame(status) {
  return status === 'scheduled';
}

// Prob-axis movement direction. up = more favored (prob rose), down = less,
// flat = no move / missing (chip hidden — absence over inference).
export function probDirection(moveProb) {
  const v = Number(moveProb);
  if (moveProb == null || !Number.isFinite(v) || v === 0) return 'flat';
  return v > 0 ? 'up' : 'down';
}

// Relative "updated Nm/h ago" for the fine-print line. Client-safe (Date.now()).
export function relativeTime(date) {
  if (!date) return null;
  const then = new Date(date).getTime();
  if (!Number.isFinite(then)) return null;
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (diffSec < 60) return rtf.format(-diffSec, 'second');
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return rtf.format(-diffMin, 'minute');
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 48) return rtf.format(-diffHr, 'hour');
  return rtf.format(-Math.round(diffHr / 24), 'day');
}
