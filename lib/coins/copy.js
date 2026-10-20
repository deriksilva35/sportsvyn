// lib/coins/copy.js - THE WORDS the Drum, the strip and the reveal print, PURE.
// Hyphens only. Points, not whole coins (ruling coins-2: the rules' meter).

const GAME = Object.freeze({ daily: 'The Daily', weekly: 'The Weekly', draft: 'The Draft', pickem: "Pick'em", run: 'The Run', october: 'October' });
const EVENT = Object.freeze({
  'first-play': 'Showed up', settled: 'Finished', top25: 'Top 25%', top10: 'Top 10%', top3: 'Top 3', win: 'Won it', streak3: '3 weeks in a row',
});

/** "1d 14h", "3h 20m", "12m"; "closing" once past. */
export function countdown(until, now = new Date()) {
  const ms = new Date(until) - new Date(now);
  if (ms <= 0) return 'closing';
  const m = Math.floor(ms / 60_000); const h = Math.floor(m / 60); const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${Math.max(1, m)}m`;
}

/** "$25" / "CAP" for a drum's tile. */
export const tileLabel = (p) => (p.kind === 'gift_card' ? `$${Math.round(p.value_cents / 100)}` : String(p.title).split(' ').pop().toUpperCase().slice(0, 4));

/** "2 × $25 GIFT CARDS" / "1 × SPORTSVYN CAP". */
export function drumTitle(p) {
  const t = p.count > 1 && p.kind === 'gift_card' ? `${p.title}s` : p.title;
  return `${p.count} × ${t}`.toUpperCase();
}

/** "212 coins in · about 1 in 107 per coin" / "No coins in yet". */
export function drumMeta(p) {
  if (!p.coins) return 'No coins in yet';
  return `${p.coins} coin${p.coins === 1 ? '' : 's'} in · about 1 in ${p.odds} per coin`;
}

/** One "HOW YOU EARNED THEM" line: { title, sub, points }. */
export function earningLine(r) {
  const game = GAME[r.detail?.game] ?? null;
  const ev = EVENT[r.event] ?? r.event;
  if (r.event === 'first-play') return { title: ev, sub: 'First game this week', points: r.points };
  if (r.event === 'streak3') return { title: ev, sub: `${r.detail?.weeks ?? 3} weeks running`, points: r.points };
  const place = r.detail?.rank && r.detail?.of ? `${ordinal(r.detail.rank)} of ${r.detail.of}` : null;
  return { title: game ? `${game} · ${ev}` : ev, sub: place ?? 'Settled', points: r.points };
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd']; const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/** The strip's second line: "2 in the drum · 2 not dropped yet". */
export function stripLine({ dropped = 0, inHand = 0, eligible = true }) {
  if (!eligible) return `${inHand + dropped} earned · 18+ to win`;
  if (!dropped && !inHand) return 'Play any game for your first coin';
  return `${dropped} in the drum · ${inHand} not dropped yet`;
}
