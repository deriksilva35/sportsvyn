// scripts/verify-key-moments-headlines.mjs
//
// Verifies the deterministic templated headlines in
// components/match/KeyMoments.js against real prod event sequences.
// JSX is stripped — we extract the pure deriveHeadlines function via
// regex/eval rather than importing the .js (bare Node can't parse JSX).
//
// Read-only against prod (winter-dawn). Host-guard enforced.

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

// Inline copy of deriveHeadlines + helpers — keeps this script
// independent of JSX-loading complications. Logic MUST stay byte-equal
// to components/match/KeyMoments.js; any change there needs to land
// here too. (Tracked by the "headline correctness gate" — diffing the
// two copies is the manual check before a ship.)
function goalHeadline({ side, scorer, teamName, detail, before, after, hasLedBefore }) {
  const isOwnGoal = detail === 'Own Goal';
  const namePart = isOwnGoal
    ? 'OWN GOAL'
    : (scorer && scorer.length > 0 ? scorer.toUpperCase() : null);
  const scoringSide = side;
  const otherSide = scoringSide === 'home' ? 'away' : 'home';
  const beforeScoring = before[scoringSide];
  const beforeOther   = before[otherSide];
  const afterScoring  = after[scoringSide];
  const afterOther    = after[otherSide];
  const wasZeroZero = beforeScoring === 0 && beforeOther === 0;
  const wasTied     = beforeScoring === beforeOther;
  const wasLeading  = beforeScoring > beforeOther;
  const wasTrailing = beforeScoring < beforeOther;
  const nowTied     = afterScoring === afterOther;
  const nowLeading  = afterScoring > afterOther;
  const margin      = afterScoring - afterOther;

  let template;
  if (wasZeroZero) template = 'OPENS THE SCORING';
  else if (wasTrailing && nowTied) template = 'EQUALISES';
  else if (wasTied && nowLeading) template = hasLedBefore[scoringSide] ? 'RESTORES THE LEAD' : `PUTS ${teamName} AHEAD`;
  else if (wasLeading && nowLeading) template = margin === 2 ? 'DOUBLES THE LEAD' : 'EXTENDS THE LEAD';
  else if (wasTrailing && afterScoring < afterOther) template = 'PULLS ONE BACK';
  else template = `MAKES IT ${after.home}-${after.away}`;

  return namePart ? `${namePart} ${template}` : template;
}

function describeNonGoal(e) {
  const player = e.player_name && e.player_name.length > 0 ? e.player_name.toUpperCase() : null;
  const assist = e.assist_name && e.assist_name.length > 0 ? e.assist_name.toUpperCase() : null;
  if (e.event_type === 'Card') {
    if (e.detail === 'Yellow Card') return { kind: 'yellow', headline: player ? `${player} BOOKED` : 'BOOKING' };
    if (e.detail === 'Red Card' || e.detail === 'Second Yellow card') return { kind: 'red', headline: player ? `${player} SENT OFF` : 'RED CARD' };
    return { kind: 'yellow', headline: player ? `${player} — ${(e.detail ?? 'CARD').toUpperCase()}` : (e.detail ?? 'CARD').toUpperCase() };
  }
  if (e.event_type === 'subst') {
    if (assist && player) return { kind: 'sub', headline: `${assist} ON FOR ${player}` };
    if (player) return { kind: 'sub', headline: `${player} SUBSTITUTED OFF` };
    return { kind: 'sub', headline: 'SUBSTITUTION' };
  }
  if (e.event_type === 'Var') {
    const outcome = e.detail ? e.detail.toUpperCase() : null;
    return { kind: 'var', headline: outcome ? `VAR CHECK — ${outcome}` : 'VAR CHECK' };
  }
  return { kind: 'sub', headline: player ? `${player} — ${(e.event_type ?? 'EVENT').toUpperCase()}` : (e.event_type ?? 'EVENT').toUpperCase() };
}

function deriveHeadlines(events, { homeName, awayName }) {
  const headlines = new Map();
  const state = { home: 0, away: 0, hasLed: { home: false, away: false } };
  const chronological = events.slice().sort((a, b) => {
    const am = a.minute ?? 0, bm = b.minute ?? 0;
    if (am !== bm) return am - bm;
    const ae = a.minute_extra ?? 0, be = b.minute_extra ?? 0;
    if (ae !== be) return ae - be;
    return (a.id ?? 0) - (b.id ?? 0);
  });
  for (const e of chronological) {
    if (e.event_type === 'Goal' && e.detail !== 'Missed Penalty') {
      const side = e.team_side === 'home' ? 'home' : 'away';
      const before = { home: state.home, away: state.away };
      const hasLedBefore = { home: state.hasLed.home, away: state.hasLed.away };
      state[side] += 1;
      const after = { home: state.home, away: state.away };
      const teamName = side === 'home' ? (homeName ?? 'HOME') : (awayName ?? 'AWAY');
      const headline = goalHeadline({ side, scorer: e.player_name, teamName: teamName.toUpperCase(), detail: e.detail, before, after, hasLedBefore });
      if (after.home > after.away) state.hasLed.home = true;
      if (after.away > after.home) state.hasLed.away = true;
      headlines.set(e.id, { kind: 'goal', headline, side, scorer: e.player_name ?? null, scoreAfter: `${after.home}-${after.away}` });
      continue;
    }
    if (e.event_type === 'Goal' && e.detail === 'Missed Penalty') {
      const player = e.player_name && e.player_name.length > 0 ? e.player_name.toUpperCase() : null;
      headlines.set(e.id, { kind: 'missed', headline: player ? `${player} MISSES THE PENALTY` : 'PENALTY MISSED' });
      continue;
    }
    const { kind, headline } = describeNonGoal(e);
    headlines.set(e.id, { kind, headline });
  }
  return headlines;
}

async function verifyMatch(slug) {
  const m = (await sql`SELECT id, status, home_score, away_score FROM matches WHERE slug = ${slug} LIMIT 1`)[0];
  if (!m) { console.log(`\n[${slug}] not found`); return; }

  const events = await sql`
    SELECT id, minute, minute_extra, event_type, detail, team_side,
           player_name, assist_name, gloss
      FROM match_events
     WHERE match_id = ${m.id} AND is_current = true
     ORDER BY minute ASC, minute_extra ASC NULLS LAST, id ASC
  `;

  // Pull team abbrs for the "PUTS {TEAM} AHEAD" template.
  const teams = (await sql`
    SELECT h.abbreviation AS home_abbr, a.abbreviation AS away_abbr,
           h.name AS home_name, a.name AS away_name
      FROM matches m
      JOIN teams h ON h.id = m.home_team_id
      JOIN teams a ON a.id = m.away_team_id
     WHERE m.id = ${m.id}
  `)[0];

  const headlines = deriveHeadlines(events, {
    homeName: teams.home_abbr ?? teams.home_name,
    awayName: teams.away_abbr ?? teams.away_name,
  });

  console.log(`\n================ ${slug} ================`);
  console.log(`  status=${m.status}  ·  ${teams.home_name} (${teams.home_abbr}) ${m.home_score ?? '?'} - ${m.away_score ?? '?'} ${teams.away_name} (${teams.away_abbr})`);
  console.log(`  events: ${events.length}  ·  (chronological order; running score derived event-by-event)`);
  console.log();
  console.log(`  min   type     detail              team   player         icon-kind  →  headline                                        gloss?`);
  console.log(`  ────  ───────  ──────────────────  ─────  ─────────────  ─────────  ──  ──────────────────────────────────────────────  ──────`);

  for (const e of events) {
    const h = headlines.get(e.id) ?? { kind: '?', headline: '' };
    const minStr = (e.minute_extra ? `${e.minute}+${e.minute_extra}` : `${e.minute}`) + "'";
    const teamLabel = e.team_side === 'home' ? (teams.home_abbr ?? 'H') : (teams.away_abbr ?? 'A');
    const detail = (e.detail ?? '').slice(0, 18);
    const player = (e.player_name ?? '—').slice(0, 13);
    const hasGloss = typeof e.gloss === 'string' && e.gloss.length > 0;
    const scoreAfter = h.scoreAfter ? `  [→ ${h.scoreAfter}]` : '';
    console.log('  ' +
      minStr.padEnd(5) +
      ' ' + e.event_type.padEnd(8) +
      ' ' + detail.padEnd(20) +
      ' ' + teamLabel.padEnd(5) +
      ' ' + player.padEnd(15) +
      ' ' + h.kind.padEnd(9) +
      '  →  ' + h.headline.padEnd(48) +
      ' ' + (hasGloss ? 'gloss' : '—   ') +
      scoreAfter);
  }
}

// Both tests:
//  - DENMARK-UKRAINE (LIVE 2-1, multiple lead changes — high signal)
//  - USA-GERMANY (FINAL 1-2, 3 lead changes — full headline vocabulary test)
//  - ARGENTINA-HONDURAS (FINAL 2-0, classic "extends/doubles" lead)
await verifyMatch('denmark-vs-ukraine-2026-06-07');
await verifyMatch('usa-vs-germany-2026-06-06');
await verifyMatch('argentina-vs-honduras-2026-06-07');

console.log('\n✓ verification complete');
