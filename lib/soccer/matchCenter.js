// lib/soccer/matchCenter.js - the match center's view logic. PURE.
//
// Contract: sportsvyn-epl-matchcenter-mock-v0_1. Everything here reshapes
// data the platform ALREADY ingests (team statistics, match_events,
// match_lineups) - this relay adds no ingestion, and invents no metric.
//
// THE xG RULING, decided by evidence rather than a guess: expected_goals
// arrives inside the SAME team-statistics payload as possession and shots
// (verified on a stored EPL row: "expected_goals":"1.42"), so it cannot have
// a separate live/final delivery path of its own - either the payload is
// there or it is not. Rather than hardcode "live omits xG", every compare row
// RENDERS ONLY IF BOTH SIDES CARRY THE FIELD. A live match missing xG drops
// that row and keeps the rest; when the provider fills it, the row appears
// with no code change. Same rule protects every other stat.

/** The provider's label -> our compare-bar row. Order is the mock's. */
const COMPARE = [
  { key: 'Ball Possession', label: 'Possession', pct: true },
  { key: 'Total Shots', label: 'Shots' },
  { key: 'Shots on Goal', label: 'On target' },
  { key: 'expected_goals', label: 'xG' },
  { key: 'Corner Kicks', label: 'Corners' },
];

/** Everything else worth showing, for the full-stats tab. */
const FULL = [
  { key: 'Fouls', label: 'Fouls' },
  { key: 'Offsides', label: 'Offsides' },
  { key: 'Yellow Cards', label: 'Yellow cards' },
  { key: 'Red Cards', label: 'Red cards' },
  { key: 'Total passes', label: 'Passes' },
  { key: 'Passes accurate', label: 'Passes accurate' },
  { key: 'Passes %', label: 'Pass accuracy' },
  { key: 'Goalkeeper Saves', label: 'Saves' },
  { key: 'Shots insidebox', label: 'Shots inside box' },
  { key: 'Shots outsidebox', label: 'Shots outside box' },
  { key: 'Blocked Shots', label: 'Blocked shots' },
];

const present = (v) => v != null && v !== '';
const num = (v) => {
  if (!present(v)) return null;
  const n = Number(String(v).replace('%', ''));
  return Number.isFinite(n) ? n : null;
};

/**
 * Compare rows from the two stored stat documents. A row appears only when
 * BOTH sides carry the field - a half-known comparison is not a comparison.
 * @returns [{ key, label, home, away, homePct, awayPct, pct }]
 */
export function compareRows(homeStats, awayStats, spec = COMPARE) {
  const h = homeStats ?? {}; const a = awayStats ?? {};
  const out = [];
  for (const s of spec) {
    if (!present(h[s.key]) || !present(a[s.key])) continue;
    const hn = num(h[s.key]); const an = num(a[s.key]);
    const total = (hn ?? 0) + (an ?? 0);
    out.push({
      key: s.key,
      label: s.label,
      home: String(h[s.key]),
      away: String(a[s.key]),
      // The split bar is share-of-total, which for possession IS the number
      // and for shots is the honest visual of the same comparison.
      homePct: total > 0 ? Math.round(((hn ?? 0) / total) * 100) : 50,
      awayPct: total > 0 ? Math.round(((an ?? 0) / total) * 100) : 50,
      pct: !!s.pct,
    });
  }
  return out;
}

export function fullStatRows(homeStats, awayStats) {
  return compareRows(homeStats, awayStats, FULL);
}

/** The provider's event vocabulary -> the mock's icon + row treatment. */
export function eventGrammar(e) {
  const type = String(e?.event_type ?? '').toLowerCase();
  const detail = String(e?.detail ?? '').toLowerCase();
  if (type === 'goal') {
    return { icon: '⚽', kind: 'goal', note: detail.includes('penalty') ? 'Penalty'
      : detail.includes('own') ? 'Own goal'
        : e.assist_name ? `Assist: ${e.assist_name}` : null };
  }
  if (type === 'card') {
    return { icon: detail.includes('red') ? '🟥' : '🟨', kind: 'card',
      note: detail.includes('red') ? 'Sent off' : 'Booked' };
  }
  if (type === 'subst') return { icon: '🔁', kind: 'sub', note: null };
  if (type === 'var') return { icon: '📺', kind: 'var', note: e.detail ?? 'VAR' };
  return { icon: '•', kind: 'other', note: e.detail ?? null };
}

/** "67'" / "90+4'" from an event's minute + stoppage. */
export function eventMinute(e) {
  const m = e?.minute; if (m == null) return null;
  const x = e?.minute_extra;
  return x ? `${m}+${x}'` : `${m}'`;
}

/**
 * Timeline rows, NEWEST FIRST, with half-time inserted as its own row when
 * the match reached it - the mock's grammar. Events arrive oldest-first from
 * the reader; this owns the ordering so the component does not.
 */
export function timelineRows(events = [], { homeScoreAtHalf = null, awayScoreAtHalf = null, reachedHalfTime = false, homeAbbr = '', awayAbbr = '' } = {}) {
  const rows = (events ?? [])
    .filter((e) => e.is_current !== false)
    .map((e) => ({
      id: e.id,
      minute: eventMinute(e),
      minuteNum: Number(e.minute ?? 0) + (Number(e.minute_extra ?? 0) / 100),
      name: e.player_name ?? '—',
      side: e.team_side === 'home' ? homeAbbr : awayAbbr,
      ...eventGrammar(e),
    }));
  if (reachedHalfTime) {
    rows.push({
      id: 'half', minuteNum: 45.99, minute: '45\'', icon: '⏱', kind: 'half', side: null,
      name: `Half time · ${homeAbbr} ${homeScoreAtHalf ?? '—'}–${awayScoreAtHalf ?? '—'} ${awayAbbr}`,
      note: null,
    });
  }
  return rows.sort((a, b) => b.minuteNum - a.minuteNum);
}

/** Score at half time, counted from the events themselves - no extra read. */
export function halfTimeScore(events = []) {
  let h = 0; let a = 0;
  for (const e of events ?? []) {
    if (e.is_current === false) continue;
    if (String(e.event_type).toLowerCase() !== 'goal') continue;
    if (Number(e.minute ?? 0) > 45) continue;
    if (e.team_side === 'home') h += 1; else a += 1;
  }
  return { home: h, away: a };
}

/**
 * A formation string ('4-2-3-1') + the XI -> rows back-to-front, so the
 * keeper sits at the bottom of the pitch and the strikers at the top (the
 * mock's orientation). Bench is returned untouched for the list beneath.
 */
export function pitchRows(formation, players = []) {
  // The stored shape marks the XI with role:'starting'; everyone else is
  // bench. Verified against a real stored lineup rather than assumed.
  const xi = (players ?? []).filter((p) => p.role === 'starting');
  const bench = (players ?? []).filter((p) => p.role !== 'starting');
  const lines = String(formation ?? '').split('-').map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (!lines.length || xi.length === 0) return { rows: xi.length ? [xi] : [], bench, formation: formation ?? null };
  const rows = [];
  let i = 0;
  const keeper = xi[0] ? [xi[0]] : [];
  i = keeper.length;
  for (const n of lines) { rows.push(xi.slice(i, i + n)); i += n; }
  // Front line first (attack at the top), keeper last.
  return { rows: [...rows.reverse(), keeper], bench, formation: formation ?? null };
}
