// lib/leagues/home.js - the league home's numbers and words (Leagues Phase 1,
// slice 1, thu-4; Derik's approved mock "League home: standings, chat,
// members"). PURE: no DB, no clock but the one passed in.
//
//   fmtNum        thousands separators, one decimal at most: 42,126.1 · 1,912 · 0
//   statTiles     YOU (place) · LEAD +margin over 2nd when 1st, else BACK OF 1ST
//                 gap · TODAY (or THIS WEEK in a weekly league)
//   periodChips   Season · This week · the last two final days (a weekly league:
//                 Season · the last two final weeks); ?period= picks one
//   windowFor     the chip -> the final buckets its table counts
//   rowExtras     the sub-line: days played · best score
//   moveMark      ▲2 / ▼1 since the previous period, or nothing
//   lastColLabel  YESTERDAY when the window's last bucket was yesterday, else its date
//   eventLine     one "Latest in the league" line

import { ordinal } from './standings.js';
import { tuesdayOf } from './weeks.js';

const nf1 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** 42126.08 -> "42,126.1"; 1912 -> "1,912"; null -> "—". Never wider than it must be. */
export function fmtNum(x) {
  if (x == null || !Number.isFinite(Number(x))) return '—';
  const n = Math.round(Number(x) * 10) / 10;
  return Number.isInteger(n) ? nf0.format(n) : nf1.format(n);
}

/** "+2,245.7" for a positive margin, "0" for none. */
const signed = (x) => (x > 0 ? `+${fmtNum(x)}` : fmtNum(x));

/**
 * The three tiles. rows: a standings table's rows ({userId, place, total});
 * now: the reader's score in the live bucket (null = not in yet).
 * -> [{ key, label, value }]
 */
export function statTiles({ rows = [], uid, unit = 'day', now = null, hasTable = true, nowLabel = null }) {
  const me = rows.find((r) => r.userId === uid) ?? null;
  const third = { key: 'now', label: nowLabel ?? (unit === 'week' ? 'This week' : 'Today'), value: now == null ? '—' : fmtNum(now) };
  if (!me || !hasTable || !rows.length) {
    return [{ key: 'you', label: 'You', value: '—' }, { key: 'gap', label: 'Back of 1st', value: '—' }, third];
  }
  const you = { key: 'you', label: 'You', value: ordinal(me.place).toUpperCase() };
  const others = rows.filter((r) => r.userId !== uid);
  if (me.place === 1) {
    const best = others.length ? Math.max(...others.map((r) => r.total)) : null;
    // TIED FOR 1ST is not a lead of +0: it says so.
    if (best != null && best >= me.total) return [you, { key: 'lead', label: 'Lead', value: 'Tied' }, third];
    return [you, { key: 'lead', label: 'Lead', value: best == null ? '—' : signed(me.total - best) }, third];
  }
  const lead = Math.max(...rows.map((r) => r.total));
  return [you, { key: 'gap', label: 'Back of 1st', value: fmtNum(Math.max(0, lead - me.total)) }, third];
}

/** ▲2 (up, jade) / ▼1 (down, terra) / '' (no move or nothing to compare). */
export function moveMark(move) {
  if (move == null || move === 0) return { text: '', dir: null };
  return move > 0 ? { text: `▲${move}`, dir: 'up' } : { text: `▼${-move}`, dir: 'down' };
}

const shortDay = (iso) => {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
};
const prevDay = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - 86_400_000).toISOString().slice(0, 10);
};

/**
 * The period chips over a league's FINAL buckets (oldest first).
 * today: the ET date. labels: bucket -> its label (lib/leagues/results.js).
 * -> [{ key, label }] - the first is the default.
 */
export function periodChips({ span, unit, finalBuckets = [], labels = {} }) {
  const last2 = finalBuckets.slice(-2).reverse()
    .map((b) => ({ key: b, label: unit === 'week' ? (labels[b] ?? `Week of ${shortDay(b)}`) : shortDay(b) }));
  if (span !== 'season') {
    // A daily or weekly league names a winner each bucket: its chips ARE the buckets.
    return finalBuckets.slice(-3).reverse()
      .map((b) => ({ key: b, label: unit === 'week' ? (labels[b] ?? `Week of ${shortDay(b)}`) : shortDay(b) }));
  }
  const chips = [{ key: 'season', label: 'Season' }];
  if (unit === 'day') chips.push({ key: 'week', label: 'This week' });
  return [...chips, ...last2];
}

/** The chip -> the buckets its table counts (a subset of finalBuckets, oldest first). */
export function windowFor(period, { span, unit, finalBuckets = [], today }) {
  if (span !== 'season') {
    return finalBuckets.includes(period) ? [period] : finalBuckets.slice(-1);
  }
  if (period === 'week' && unit === 'day') {
    const wk = tuesdayOf(today);
    return finalBuckets.filter((b) => tuesdayOf(b) === wk);
  }
  if (period && period !== 'season' && finalBuckets.includes(period)) return [period];
  return finalBuckets;
}

/** A chip key from the URL, kept only if it is one of the chips. */
export function parsePeriod(raw, chips = []) {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return chips.some((c) => c.key === v) ? v : (chips[0]?.key ?? 'season');
}

/** YESTERDAY when the window ends yesterday (ET), else its date; a week league says LAST WK. */
export function lastColLabel({ unit, window = [], today }) {
  const last = window[window.length - 1];
  if (unit === 'week') return 'Last wk';
  if (!last) return 'Yesterday';
  return last === prevDay(today) ? 'Yesterday' : shortDay(last);
}

/**
 * Per member over a window: how many buckets they played and their best bucket.
 * results: final results; byBucket comes from a computeStandings row.
 * -> Map<userId, { played, best }>
 */
export function rowExtras(rows = [], results = [], window = []) {
  const inWin = new Set(window);
  const played = new Map();
  for (const r of results) {
    if (!inWin.has(r.bucket) || r.score == null) continue;
    const u = Number(r.userId);
    if (!played.has(u)) played.set(u, new Set());
    played.get(u).add(r.bucket);
  }
  const out = new Map();
  for (const row of rows) {
    const set = played.get(row.userId) ?? new Set();
    const best = set.size ? Math.max(...[...set].map((b) => row.byBucket?.[b] ?? 0)) : null;
    out.set(row.userId, { played: set.size, best });
  }
  return out;
}

/** "11 days played · best 2,412.0" / "Joined Oct 12 · nothing played yet". */
export function subLine({ played = 0, best = null, unit = 'day', joined = null }) {
  const word = unit === 'week' ? 'week' : 'day';
  if (!played) return joined ? `Joined ${joined} · nothing played yet` : 'Nothing played yet';
  return `${played} ${word}${played === 1 ? '' : 's'} played${best != null && best > 0 ? ` · best ${fmtNum(best)}` : ''}`;
}

/** The tab rail: STANDINGS · TODAY (THIS WEEK in a weekly league) · CHAT · MEMBERS. */
export function tabLabel(key, unit) {
  if (key === 'today') return unit === 'week' ? 'This week' : 'Today';
  return { standings: 'Standings', chat: 'Chat', members: 'Members' }[key] ?? key;
}

/**
 * One feed line. ev: { kind, userId, payload, periodLabel }; name(userId) gives
 * "You" / "@handle". -> string
 */
export function eventLine(ev, name, gameLabel = (g) => g) {
  const who = name(ev.userId);
  const p = ev.payload ?? {};
  switch (ev.kind) {
    case 'join': return p.owner ? `${who} started the league` : `${who} joined the league`;
    case 'period_winner':
      return p.game
        ? `${who} won ${gameLabel(p.game)}, ${ev.periodLabel}${p.score != null ? ` · ${fmtNum(p.score)}` : ''}`
        : `${who} won ${ev.periodLabel}${p.score != null ? ` · ${fmtNum(p.score)}` : ''}`;
    case 'took_first': return `${who} took 1st${p.from != null ? ` from ${name(p.from)}` : ''}`;
    case 'chopped': return `${who} was chopped · ${ev.periodLabel}`;
    default: return '';
  }
}
