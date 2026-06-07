// scripts/verify-live-watch-score.mjs
//
// Verifies the LiveWatchScore data path WITHOUT instantiating JSX (bare
// Node can't load .js files containing JSX). Mirrors the same trend,
// caption, peak, sparkline-bool, and goal-marker computations as
// components/match/LiveWatchScore.js so the rendered values can be
// confirmed against the real prod tick history.
//
// Read-only. Host-guard winter-dawn.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function loadEnvLocal(p) {
  let text;
  try { text = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('=');
    if (eq < 0) continue;
    const k = s.slice(0, eq).trim();
    let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnvLocal(path.resolve(__dirname, '..', '.env.local'));
if (process.env.PROD_DATABASE_URL) process.env.DATABASE_URL = process.env.PROD_DATABASE_URL;

const host = new URL(process.env.DATABASE_URL).hostname;
if (!host.includes('winter-dawn')) throw new Error('REFUSE: not winter-dawn: ' + host);
console.log('✓ host (READ-ONLY):', host);

const { sql } = await import('../lib/db.js');

function describeTrend(delta) {
  if (delta > 0.3)  return `▲ Climbing · +${delta.toFixed(1)} from kickoff`;
  if (delta < -0.3) return `▼ Cooling · ${delta.toFixed(1)} from kickoff`;
  return '● Steady';
}

function describeCaption({ status, goals, leadChanges, minute }) {
  let leftPart;
  if (goals === 0) {
    leftPart = 'Scoreless';
  } else {
    const goalsText = `${goals} goal${goals === 1 ? '' : 's'}`;
    if (leadChanges > 0) {
      leftPart = `${goalsText}, ${leadChanges} lead change${leadChanges === 1 ? '' : 's'}`;
    } else {
      leftPart = goalsText;
    }
  }
  const rightPart = status === 'final'
    ? 'final'
    : minute != null ? `${minute}' played` : 'in play';
  return `${leftPart} · ${rightPart}`;
}

async function fetchSeries(matchId) {
  return await sql`
    SELECT minute, status_short, goals_count, lead_changes,
           composite_score::float AS composite_score, recorded_at
      FROM match_watch_score_history
     WHERE match_id = ${matchId}
     ORDER BY recorded_at ASC, id ASC
  `;
}

async function getMatch(slug) {
  const r = await sql`SELECT id, slug, status FROM matches WHERE slug = ${slug} LIMIT 1`;
  return r[0] ?? null;
}

async function simulate(slug, label, { forceStatus = null } = {}) {
  const m = await getMatch(slug);
  if (!m) {
    console.log(`\n[${label}] ${slug} — not in DB`);
    return;
  }
  const status = forceStatus ?? m.status;

  console.log(`\n========== ${label} ==========`);
  console.log(`  match.slug:                  ${slug}`);
  console.log(`  match.status (DB):           ${m.status}` + (forceStatus ? `  (rendering under FORCED ${forceStatus})` : ''));

  if (status !== 'live' && status !== 'final') {
    console.log(`  COMPONENT RETURNS:           null  (scheduled / postponed / cancelled — Preview tab owns this state)`);
    return;
  }

  const series = await fetchSeries(m.id);
  if (series.length === 0) {
    console.log(`  COMPONENT RETURNS:           null  (no tick history — graceful skip)`);
    return;
  }

  const isLive = status === 'live';
  let displayComposite, trendLine, captionSource;

  if (isLive) {
    const latest = series[series.length - 1];
    const baseline = series[0].composite_score;
    const delta = latest.composite_score - baseline;
    displayComposite = latest.composite_score;
    captionSource = latest;
    trendLine = describeTrend(delta);
    console.log(`  baseline (first tick):       ${baseline.toFixed(2)}`);
    console.log(`  latest tick composite:       ${latest.composite_score.toFixed(2)}`);
    console.log(`  delta from kickoff:          ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`);
  } else {
    const peak = series.reduce((max, r) => (r.composite_score > max ? r.composite_score : max), -Infinity);
    const ftRow = series.find((r) => ['FT', 'AET', 'PEN'].includes(r.status_short));
    displayComposite = peak;
    captionSource = ftRow ?? series[series.length - 1];
    trendLine = `● Final · peaked at ${peak.toFixed(1)}`;
    console.log(`  peak composite:              ${peak.toFixed(2)}`);
    console.log(`  ft-row found?                ${ftRow ? 'yes (' + ftRow.status_short + ' at minute=' + ftRow.minute + ')' : 'no (using last tick)'}`);
  }

  const caption = describeCaption({
    status,
    goals: captionSource.goals_count,
    leadChanges: captionSource.lead_changes,
    minute: captionSource.minute,
  });

  // Sparkline thin-data guard.
  const sparkOk = series.length >= 3;
  let goalMarkerCount = 0;
  if (sparkOk) {
    for (let i = 1; i < series.length; i++) {
      if (series[i].goals_count > series[i - 1].goals_count) goalMarkerCount++;
    }
  }

  console.log(`  ╶─ RENDERED VALUES ─────────────────────────────────────────────`);
  console.log(`  rail-card classes:           rail-card${isLive ? ' live-card' : ''}  ${isLive ? '(redPulse on)' : '(static, no pulse)'}`);
  console.log(`  rail-card-kicker:            Live Watch Score`);
  console.log(`  "Live Now" tag rendered?     ${isLive ? 'YES (pulsing dot)' : 'no'}`);
  console.log(`  ws-number:                   ${displayComposite.toFixed(1)}`);
  console.log(`  ws-outof:                    /10`);
  console.log(`  ws-trend:                    ${trendLine}`);
  console.log(`  ws-caption:                  ${caption}`);
  console.log(`  ws-footer:                   Updates every minute · peak preserved after full time`);
  console.log(`  sparkline drawn?             ${sparkOk ? 'YES (' + series.length + ' ticks)' : 'no (' + series.length + ' tick' + (series.length === 1 ? '' : 's') + ', under thin-data threshold of 3)'}`);
  if (sparkOk) {
    console.log(`  goal markers (volt rings):   ${goalMarkerCount}`);
    console.log(`  current-tick dot (filled):   1`);
  }
}

// 1. argentina-honduras — both as DB sees it (final) and forced-live for live framing.
await simulate('argentina-vs-honduras-2026-06-07', '1a. argentina-honduras  (DB final — peak freeze)');
await simulate('argentina-vs-honduras-2026-06-07', '1b. argentina-honduras  (FORCED live — verifies trend + Live Now + redPulse path)', { forceStatus: 'live' });

// 2. usa-germany final
await simulate('usa-vs-germany-2026-06-06', '2. usa-germany  (final — peak freeze)');

// 3. Thin-data (1 tick) — sparkline must skip
await simulate('venezuela-vs-turkiye-2026-06-06', '3. venezuela-turkiye  (1-tick thin data — no sparkline)');

// 4. Pre-kickoff scheduled — component must return null
await simulate('denmark-vs-ukraine-2026-06-07', '4. denmark-ukraine  (scheduled — component returns null)');

console.log('\n✓ verification complete');
