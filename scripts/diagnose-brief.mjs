// scripts/diagnose-brief.mjs — DEV-only post-mortem of generateBriefFromDb.
//
// Runs the SAME assemble + generate + gate path the auto-brief cron
// uses (lib/aiBrief.js), but READ-ONLY: no INSERT into match_briefs.
// For each of the 2 attempts, prints:
//   - raw model output (headline + paragraphs) + word counts
//   - per-gate PASS/FAIL with the reason string
// Then prints the final disposition: which gate triggered fallback,
// or which attempt passed.
//
// Run:  node --env-file=.env.local scripts/diagnose-brief.mjs <matchDbId>

import { generateBriefFromDb, assembleEnvelopeFromDb } from '../lib/aiBrief.js';

const matchDbId = Number(process.argv[2]);
if (!Number.isInteger(matchDbId) || matchDbId <= 0) {
  console.error('Usage: diagnose-brief.mjs <matchDbId>');
  process.exit(1);
}

function countWords(s) {
  if (!s || typeof s !== 'string') return 0;
  return s.trim().split(/\s+/).filter(Boolean).length;
}

console.log(`═══════════════════════════════════════════════════════════════════════════`);
console.log(`DIAGNOSTIC: generateBriefFromDb(${matchDbId})`);
console.log(`═══════════════════════════════════════════════════════════════════════════`);

// 1. Pre-flight envelope inspection (what generateBriefFromDb feeds the model).
const envelope = await assembleEnvelopeFromDb(matchDbId);
const m = envelope.match ?? {};
console.log(`\n--- ENVELOPE SHAPE (what the model receives) ---`);
console.log(`  ${m.teams?.home ?? '?'} ${m.score?.home ?? '-'}-${m.score?.away ?? '-'} ${m.teams?.away ?? '?'}`);
console.log(`  league:        ${m.league ?? '(none)'}`);
console.log(`  round:         ${m.round ?? '(none)'}`);
console.log(`  venue:         ${m.venue ?? '(none)'}`);
console.log(`  status:        ${m.status ?? '(none)'}`);
console.log(`  events:        ${envelope.events?.length ?? 0} is_current rows`);
console.log(`  lineups:       ${envelope.lineups?.length ?? 0} sides`);
console.log(`  stats sides:   ${envelope.statistics ? Object.keys(envelope.statistics).join(', ') : '(none)'}`);

console.log(`\n--- INVOKING generateBriefFromDb (2 attempts, 5 gates each) ---`);
const t0 = Date.now();
const result = await generateBriefFromDb(matchDbId);
console.log(`took: ${Date.now() - t0}ms`);

// 2. Per-attempt trace.
for (const a of result.attempts) {
  console.log(`\n═══════════════════ ATTEMPT ${a.attempt} ═══════════════════`);
  if (a.error) {
    console.log(`  API CALL ERRORED: ${a.error}`);
  } else if (!a.parsed_output) {
    console.log(`  NO PARSEABLE JSON in response`);
  } else {
    const p = a.parsed_output;
    console.log(`  HEADLINE   (${countWords(p.headline).toString().padStart(2)} words):  ${p.headline}`);
    console.log(`  PARA 1     (${countWords(p.paragraph_1).toString().padStart(3)} words):`);
    console.log(`    ${p.paragraph_1}`);
    console.log(`  PARA 2     (${countWords(p.paragraph_2).toString().padStart(3)} words):`);
    console.log(`    ${p.paragraph_2}`);
    console.log(`  PARA 3     (${p.paragraph_3 === null ? 'null' : countWords(p.paragraph_3) + ' words'}):`);
    if (p.paragraph_3 !== null) console.log(`    ${p.paragraph_3}`);
  }

  console.log(`\n  GATES (by name):`);
  for (const g of a.gates) {
    const tag = g.pass ? 'PASS ✓' : 'FAIL ✗';
    const reason = g.reason ? `  — ${g.reason}` : '';
    console.log(`    ${tag}  ${g.name}${reason}`);
  }
  const firstFail = a.gates.find((g) => !g.pass);
  if (firstFail) {
    console.log(`\n  DISPOSITION: REJECTED at gate '${firstFail.name}' (reason: ${firstFail.reason || '—'})`);
  } else {
    console.log(`\n  DISPOSITION: ACCEPTED — all gates passed`);
  }
}

// 3. Final disposition.
console.log(`\n═══════════════════ FINAL ═══════════════════`);
console.log(`  validation_status: ${result.validation_status}`);
if (result.validation_status === 'passed') {
  const winningAttempt = result.attempts.find((a) => a.gates.every((g) => g.pass));
  console.log(`  path: MODEL BRIEF (attempt ${winningAttempt?.attempt})`);
} else {
  // Identify the LAST attempt's first failing gate — the deterministic
  // trigger that drove the fallback (since both attempts must fail for
  // fallback to fire).
  const lastAttempt = result.attempts[result.attempts.length - 1];
  const firstFail = lastAttempt?.gates?.find((g) => !g.pass);
  const allFails = result.attempts.map((a, i) => {
    const f = a.gates?.find((g) => !g.pass);
    return `attempt ${a.attempt}: ${f ? f.name + ' (' + (f.reason || '—') + ')' : 'ALL PASSED?'}`;
  }).join('\n           ');
  console.log(`  path: TEMPLATED FALLBACK`);
  console.log(`  per-attempt first failing gate:`);
  console.log(`           ${allFails}`);
  if (firstFail) {
    console.log(`  triggering gate (last attempt): '${firstFail.name}' — ${firstFail.reason || '—'}`);
  }
}
console.log(`\n  Headline shipped:   ${result.headline}`);
console.log(`  Paragraph 1 shipped (${countWords(result.paragraph_1)} words):`);
console.log(`    ${result.paragraph_1}`);
console.log(`  Paragraph 2 shipped (${countWords(result.paragraph_2)} words):`);
console.log(`    ${result.paragraph_2}`);

console.log(`\n--- WRITE CHECK: this script does NOT insert. Confirm match_briefs unchanged. ---`);
import { sql } from '../lib/db.js';
const briefRows = await sql`SELECT count(*)::int n FROM match_briefs WHERE match_id = ${matchDbId}`;
console.log(`  DEV match_briefs rows for match ${matchDbId}: ${briefRows[0].n}  (expected 0 — diagnostic is read-only)`);

console.log(`═══════════════════════════════════════════════════════════════════════════`);
