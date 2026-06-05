// scripts/dryrun-live-gloss.mjs
//
// Offline dry run of lib/liveGloss.js against PROD's real match_events
// for the four finished friendlies. Read-only, host-guarded. NOTHING is
// stored; NOTHING goes live. The output is a readable per-event report
// Derik reads to decide whether the prompt + gates are calibrated before
// we proceed to storage/live-wiring.
//
// Run:
//   vercel env pull /tmp/sv-prod-env.tmp --environment=production
//   DATABASE_URL=<extracted-PROD_DATABASE_URL> \
//   ANTHROPIC_API_KEY=<from-.env.local> \
//   node scripts/dryrun-live-gloss.mjs
//
// The script ITSELF does the host-guard (refuses to run if DATABASE_URL
// doesn't hit the winter-dawn host). Belt-and-suspenders.

// Env source: caller is expected to have ANTHROPIC_API_KEY + API_SPORTS_KEY
// + DATABASE_URL (pointing at PROD's winter-dawn branch) in process.env
// before invoking. The .env.local file is *not* auto-loaded here — see
// the run command in the file header for the wiring.
import { sql } from '../lib/db.js';
import {
  buildGlossEnvelope,
  generateGloss,
  validateGloss,
  isQualifyingEvent,
} from '../lib/liveGloss.js';

const SLUGS = [
  'spain-vs-iraq-2026-06-04',
  'france-vs-ivory-coast-2026-06-04',
  'czech-republic-vs-guatemala-2026-06-05',
  'mexico-vs-serbia-2026-06-05',
];

// ============================================================================
// Host-guard. Refuse to run if the DB connection isn't pointing at the
// winter-dawn prod branch. Same pattern as the manual ops in this
// codebase — script defends itself.
// ============================================================================
function assertProdHost() {
  const u = process.env.DATABASE_URL;
  if (!u) throw new Error('DATABASE_URL missing');
  const host = new URL(u).hostname;
  if (!host.includes('winter-dawn')) {
    throw new Error(`DATABASE_URL host "${host}" is not winter-dawn — refusing to run`);
  }
  console.log(`✓ host-guard pass: ${host}`);
}

// ============================================================================
// Pull match + ordered events for one slug.
// ============================================================================
async function loadMatch(slug) {
  const matchRows = await sql`
    SELECT
      m.id, m.slug, m.status, m.stage, m.group_code,
      m.home_score, m.away_score, m.kickoff_at,
      m.home_team_id, m.away_team_id,
      ht.name AS home_name, ht.abbreviation AS home_abbreviation,
      at.name AS away_name, at.abbreviation AS away_abbreviation,
      l.name AS league_name
    FROM matches m
    JOIN teams ht ON ht.id = m.home_team_id
    JOIN teams at ON at.id = m.away_team_id
    JOIN leagues l ON l.id = m.league_id
    WHERE m.slug = ${slug}
  `;
  if (matchRows.length === 0) return null;
  const match = matchRows[0];

  // is_current = true filter is load-bearing: superseded rows
  // (VAR-cancelled goals, corrected events) must NOT be counted into
  // scoreAt's running tally or the model gets fed wrong cumulative
  // scores. Previous dry-run ran without this filter and the model
  // narrated the inflated state ("Serbia 2-0" when actual was 0-1).
  // Same is_current discipline the live phantom-protection uses.
  const events = await sql`
    SELECT
      id, minute, minute_extra, event_type, detail,
      team_side, team_api_id, player_name, assist_name,
      is_current
    FROM match_events
    WHERE match_id = ${match.id}
      AND is_current = true
    ORDER BY minute ASC, COALESCE(minute_extra, 0) ASC, id ASC
  `;
  return { match, events };
}

// ============================================================================
// Pretty-print one event row + the gloss result.
// ============================================================================
function formatEventRow(event, match) {
  const team = event.team_side === 'home' ? (match.home_abbreviation ?? match.home_name) : (match.away_abbreviation ?? match.away_name);
  const minute = event.minute_extra ? `${event.minute}+${event.minute_extra}'` : `${event.minute}'`;
  const player = event.player_name ?? '?';
  const assist = event.assist_name ? ` (assist: ${event.assist_name})` : '';
  const detail = event.detail ? ` · ${event.detail}` : '';
  return `${minute.padStart(5)}  ${event.event_type.padEnd(5)}${detail.padEnd(20)}  ${team.padEnd(3)}  ${player}${assist}`;
}

// ============================================================================
// Process one match — print a section, then per-qualifying-event the
// envelope summary, the model output, the validation result.
// ============================================================================
async function processMatch(slug) {
  const data = await loadMatch(slug);
  if (!data) {
    console.log(`\n--- ${slug}: MATCH NOT FOUND ---`);
    return { generated: 0, kept: 0, dropped: 0 };
  }
  const { match, events } = data;
  const qualifying = events.filter(isQualifyingEvent);

  console.log(`\n${'═'.repeat(80)}`);
  console.log(`${match.home_name} ${match.home_score}–${match.away_score} ${match.away_name}`);
  console.log(`  slug:        ${match.slug}`);
  console.log(`  league:      ${match.league_name}`);
  console.log(`  events:      ${events.length} total, ${qualifying.length} qualifying`);
  console.log('═'.repeat(80));

  let kept = 0;
  let dropped = 0;

  for (let i = 0; i < qualifying.length; i++) {
    const event = qualifying[i];
    console.log('');
    console.log(`  [${i + 1}/${qualifying.length}]  ${formatEventRow(event, match)}`);

    const envelope = buildGlossEnvelope(event, {
      match,
      events,
      prematch_angle: null,
    });
    // Sanity peek at the score we computed at the moment
    const s = envelope.state_at_moment.score;
    console.log(`         state: ${s.home}-${s.away} (${envelope.state_at_moment.period})  recent: ${envelope.recent_events.length} events`);

    const result = await generateGloss(envelope);
    if (result.error) {
      console.log(`         ERROR (model): ${result.error}`);
      dropped++;
      continue;
    }

    if (result.gloss == null) {
      console.log(`         GLOSS: (model returned null)`);
      const v = validateGloss(null, envelope);
      console.log(`         GATE:  ${v.ok ? 'OK' : 'FAIL'} · ${v.reason ?? 'no gloss kept'}`);
      dropped++;
      continue;
    }

    console.log(`         GLOSS: "${result.gloss}"`);
    const valid = validateGloss(result.gloss, envelope);
    if (valid.ok && valid.kept) {
      console.log(`         GATES: PASS (kept)`);
      kept++;
    } else {
      console.log(`         GATES: DROP — ${valid.reason}`);
      dropped++;
    }
  }

  return { generated: qualifying.length, kept, dropped };
}

// ============================================================================
// Main
// ============================================================================
(async () => {
  assertProdHost();
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY missing — generateGloss cannot run');
  }
  console.log(`✓ ANTHROPIC_API_KEY present`);

  let total = { generated: 0, kept: 0, dropped: 0 };
  for (const slug of SLUGS) {
    const r = await processMatch(slug);
    total.generated += r.generated;
    total.kept += r.kept;
    total.dropped += r.dropped;
  }

  console.log('');
  console.log('═'.repeat(80));
  console.log('DRY-RUN SUMMARY');
  console.log('═'.repeat(80));
  console.log(`  qualifying events processed:  ${total.generated}`);
  console.log(`  gloss kept (passed all gates): ${total.kept}`);
  console.log(`  gloss dropped (null / gate-fail / error): ${total.dropped}`);
  console.log(`  retention rate: ${total.generated > 0 ? Math.round(100 * total.kept / total.generated) : 0}%`);
  console.log('');
  console.log('NOTHING WAS STORED. NOTHING WAS WIRED LIVE. Read the per-event glosses');
  console.log('above and adjust the SYSTEM_PROMPT in lib/liveGloss.js if needed.');
})().catch((e) => {
  console.error('ERR:', e?.stack || e?.message || e);
  process.exit(1);
});
