// scripts/replay-live-watch-score.mjs — DEV-only replay of the Live
// Watch Score formula across a finished match's is_current=true events.
//
// Reads match_events from whatever DATABASE_URL points at, walks the
// timeline minute-by-minute, applies lib/liveWatchScore.js, and prints:
//   - match meta
//   - chronology of events
//   - per-minute composite table (only minutes where state changes or
//     the composite shifts; skips long flatlines but always shows
//     boundaries so the curve is legible)
//   - ASCII sparkline across 0-90' (or longer for AET)
//
// READ-ONLY. No --save mode. No writes. Replay is for eyeballing the
// formula before migration 025 + capture ship.
//
// Run:  node --env-file=.env.local scripts/replay-live-watch-score.mjs <slug-or-id>

import { sql } from '../lib/db.js';
import { computeLiveWatchScore, accumulateState, FORMULA_VERSION } from '../lib/liveWatchScore.js';

const SPARK_CHARS = ['▁','▂','▃','▄','▅','▆','▇','█'];

function sparkChar(value) {
  const idx = Math.max(0, Math.min(7, Math.round((value / 10) * 7)));
  return SPARK_CHARS[idx];
}

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: replay-live-watch-score.mjs <slug-or-id>');
  process.exit(1);
}

const isNumeric = /^\d+$/.test(arg);

const matchRows = isNumeric
  ? await sql`SELECT * FROM matches WHERE id = ${Number(arg)} LIMIT 1`
  : await sql`SELECT * FROM matches WHERE slug = ${arg} LIMIT 1`;

const match = matchRows[0];
if (!match) {
  console.error(`No match found for: ${arg}`);
  process.exit(1);
}

const homeTeam = (await sql`SELECT name, abbreviation FROM teams WHERE id = ${match.home_team_id}`)[0];
const awayTeam = (await sql`SELECT name, abbreviation FROM teams WHERE id = ${match.away_team_id}`)[0];

const events = await sql`
  SELECT id, minute, minute_extra, event_type, detail, team_side, player_name, assist_name, is_current
    FROM match_events
   WHERE match_id = ${match.id} AND is_current = true
   ORDER BY minute ASC, minute_extra ASC NULLS LAST, id ASC
`;

console.log('═══════════════════════════════════════════════════════════════════════════');
console.log(`MATCH:     ${homeTeam?.name ?? '?'} ${match.home_score ?? '-'}-${match.away_score ?? '-'} ${awayTeam?.name ?? '?'}`);
console.log(`SLUG:      ${match.slug}`);
console.log(`STATUS:    ${match.status}`);
console.log(`EVENTS:    ${events.length} is_current=true`);
console.log(`FORMULA:   ${FORMULA_VERSION}`);
console.log('═══════════════════════════════════════════════════════════════════════════');

// Event chronology — only the meaningful ones (Goals + Cards drive the score).
console.log('\n--- EVENT CHRONOLOGY (is_current=true) ---');
let runHome = 0;
let runAway = 0;
for (const e of events) {
  const mLabel = e.minute_extra ? `${e.minute}+${e.minute_extra}'` : `${e.minute}'`;
  let scoreChange = '';
  if (e.event_type === 'Goal' && e.detail !== 'Missed Penalty') {
    if (e.team_side === 'home') runHome++; else if (e.team_side === 'away') runAway++;
    scoreChange = `  →  ${runHome}-${runAway}`;
  }
  const tag = (e.event_type === 'Goal'
    ? (e.detail === 'Missed Penalty' ? 'MISS' : 'GOAL')
    : e.event_type === 'Card'
      ? (e.detail === 'Yellow Card' ? 'YELLOW' : e.detail === 'Red Card' ? 'RED' : 'CARD')
      : e.event_type === 'subst' ? 'SUB'
      : e.event_type === 'Var'   ? 'VAR'
      : e.event_type).padEnd(7);
  const side = (e.team_side === 'home' ? 'H' : e.team_side === 'away' ? 'A' : '?');
  console.log(`  ${mLabel.padStart(6)}  ${tag} ${side}  ${e.player_name ?? '—'}${e.assist_name ? ` (${e.assist_name})` : ''}${scoreChange}`);
}

// Per-minute walk. Cap at the higher of: last event minute, 90 for a final
// match (assume regulation), current event horizon for live matches.
const lastEventMinute = events.length > 0 ? Math.max(...events.map(e => (e.minute ?? 0) + (e.minute_extra ?? 0))) : 0;
const finalMinute = match.status === 'final' ? Math.max(90, lastEventMinute) : Math.max(0, lastEventMinute);

const series = [];
let eventIdx = 0;
const sorted = [...events].sort((a, b) => {
  if (a.minute !== b.minute) return a.minute - b.minute;
  return (a.minute_extra ?? 0) - (b.minute_extra ?? 0);
});

for (let m = 0; m <= finalMinute; m++) {
  // Apply events at minute <= m (we treat minute as inclusive — by end-of-minute-N).
  // Iterate one-shot (idx pointer advances).
  while (eventIdx < sorted.length && (sorted[eventIdx].minute ?? 0) <= m) {
    eventIdx++;
  }
  const eventsSoFar = sorted.slice(0, eventIdx);
  const state = accumulateState(eventsSoFar);
  const { composite, components } = computeLiveWatchScore({ ...state, minute: m });
  series.push({ minute: m, state, composite, components });
}

// Per-minute table — print only rows where state changes OR composite shifts vs prior.
console.log('\n--- PER-MINUTE COMPOSITE TABLE (only change rows) ---');
console.log('  min   H-A   G LC  Y R   composite  (components: base+goals+close+LC+cards+late = raw → clipped)');
let prevSig = '';
for (let i = 0; i < series.length; i++) {
  const s = series[i];
  const sig = `${s.state.home_score}-${s.state.away_score}|${s.state.goals_count}|${s.state.lead_changes}|${s.state.yellow_cards}|${s.state.red_cards}|${s.composite}`;
  const isLast = i === series.length - 1;
  const isFirst = i === 0;
  if (sig !== prevSig || isLast || isFirst) {
    const c = s.components;
    const compTxt = `(${c.base}+${c.goals}+${c.closeness}+${c.lead_changes}+${c.cards}+${c.late_drama}=${c.raw_total} → ${c.clipped})`;
    console.log(
      `  ${String(s.minute).padStart(3)}'  ` +
      `${String(s.state.home_score)}-${String(s.state.away_score)}   ` +
      `${String(s.state.goals_count).padStart(1)} ${String(s.state.lead_changes).padStart(2)}  ` +
      `${String(s.state.yellow_cards).padStart(1)} ${String(s.state.red_cards).padStart(1)}   ` +
      `${s.composite.toFixed(1).padStart(4)}      ${compTxt}`,
    );
  }
  prevSig = sig;
}

// ASCII sparkline — one char per minute. Truncate the leading flat zone
// for legibility (start from 5 mins before first event, or minute 0 if no
// events). At the end, show the value alongside the curve.
console.log('\n--- ASCII SPARKLINE (composite 0-10 → ▁▂▃▄▅▆▇█) ---');
const spark = series.map(s => sparkChar(s.composite)).join('');
const labelEvery = 15;
let xAxis = '';
for (let m = 0; m <= finalMinute; m++) {
  xAxis += (m % labelEvery === 0 ? '|' : ' ');
}
let xLabels = '';
for (let m = 0; m <= finalMinute; m++) {
  if (m % labelEvery === 0) {
    const lbl = `${m}'`;
    xLabels += lbl;
    // Pad to next label position
    for (let i = 0; i < labelEvery - lbl.length; i++) xLabels += ' ';
  }
}
console.log(`  ${spark}    final: ${series[series.length - 1].composite.toFixed(1)}`);
console.log(`  ${xAxis}`);
console.log(`  ${xLabels}`);

console.log('\n--- HEADLINE ---');
const final = series[series.length - 1];
console.log(`  composite at end: ${final.composite.toFixed(1)}`);
console.log(`  components:       ${JSON.stringify(final.components)}`);
console.log(`  state:            ${JSON.stringify(final.state)}`);
console.log('═══════════════════════════════════════════════════════════════════════════\n');
