// scripts/fix-prod-ranking-blurbs-emdash.mjs
//
// Removes em dashes from the 10 live PROD ranking_row_blurbs.
// PUNCTUATION-ONLY surgery — every word and name preserved. Grounding
// preserved by construction (no name strings changed).
//
// Two modes:
//   default (dry-run): reads each PROD body, verifies it matches the
//     EXPECTED_BEFORE text byte-for-byte (refuses if not — protects
//     against editing a body that's been hand-tweaked since migration),
//     prints before/after side by side. WRITES NOTHING.
//   --write: same verification, then transactional UPDATE of all 6
//     bodies that have rewrites pending. ROLLBACK if any rowCount
//     isn't 1.
//
// Run:
//   PROD_DATABASE_URL="postgresql://..." node scripts/fix-prod-ranking-blurbs-emdash.mjs
//   PROD_DATABASE_URL="postgresql://..." node scripts/fix-prod-ranking-blurbs-emdash.mjs --write

import { neon } from '@neondatabase/serverless';
import pkg from 'pg';
const { Client } = pkg;

const PROD_URL = process.env.PROD_DATABASE_URL;
if (!PROD_URL) throw new Error('PROD_DATABASE_URL missing — export it in your shell, do not inline.');
if (!new URL(PROD_URL).hostname.includes('winter-dawn')) {
  throw new Error('REFUSE: PROD_DATABASE_URL does not look like PROD (winter-dawn).');
}
const WRITE = process.argv.includes('--write');
console.log('prod host:', new URL(PROD_URL).hostname);
console.log('mode     :', WRITE ? 'WRITE' : 'dry-run');

// Each entry: id, team, expected_before, after. Entries with after===null
// are already clean (no em dashes) — the script verifies the body still
// matches expected and skips the UPDATE.
const REWRITES = [
  {
    id: 50, team: 'Spain',
    before: `Lamine Yamal and Nico Williams give Spain the most dangerous wide pairing in the field, but the real structural advantage is a midfield anchored by Rodri — the deepest, most technically complete unit at this tournament. A back line that blends experience with Pau Cubarsí's exceptional youth, and a settled attacking structure built on genuine positional depth, make Spain the composite's clear number one.`,
    after:  `Lamine Yamal and Nico Williams give Spain the most dangerous wide pairing in the field, but the real structural advantage is a midfield anchored by Rodri, the deepest, most technically complete unit at this tournament. A back line that blends experience with Pau Cubarsí's exceptional youth, and a settled attacking structure built on genuine positional depth, make Spain the composite's clear number one.`,
  },
  {
    id: 51, team: 'Argentina',
    before: `Messi and Lautaro Martínez give Argentina an attacking spine that no other squad in the field can match on paper, and the midfield — anchored by Mac Allister and De Paul — has won together long enough to function as a unit rather than a collection of individuals. E. Martínez behind a settled back line makes this a complete structure, not just a front-end talent story.`,
    after:  `Messi and Lautaro Martínez give Argentina an attacking spine that no other squad in the field can match on paper, and the midfield, anchored by Mac Allister and De Paul, has won together long enough to function as a unit rather than a collection of individuals. E. Martínez behind a settled back line makes this a complete structure, not just a front-end talent story.`,
  },
  {
    id: 52, team: 'France',
    before: `Mbappé leads an attack that nobody in the field can match for individual ceiling, but France's rank is built on something wider: a back line anchored by Saliba that is among the most settled in the tournament, and a midfield deep enough that Kanté's return feels like a bonus rather than a necessity. The talent spine is legitimate from one to eleven.`,
    after: null, // clean — no em dashes
  },
  {
    id: 53, team: 'Portugal',
    before: `The midfield is the argument for Portugal at four — Bernardo Silva anchoring a unit with genuine depth across every profile, supported by a back line built around Rúben Dias that concedes very little structure. Ronaldo remains the forward line's gravitational centre, but it's the density of quality in the middle third that makes this squad genuinely hard to dismantle.`,
    after:  `The midfield is the argument for Portugal at four: Bernardo Silva anchoring a unit with genuine depth across every profile, supported by a back line built around Rúben Dias that concedes very little structure. Ronaldo remains the forward line's gravitational centre, but it's the density of quality in the middle third that makes this squad genuinely hard to dismantle.`,
  },
  {
    id: 54, team: 'Germany',
    before: `Wirtz and Musiala give Germany a creative midfield spine that few squads can match at this level, and Kimmich's experience threading defense and buildup adds structural assurance behind them. The attacking line is deep enough that Havertz isn't the only answer up top. Coherence, not raw talent, is the question — and this squad's profile suggests that gap has narrowed.`,
    after:  `Wirtz and Musiala give Germany a creative midfield spine that few squads can match at this level, and Kimmich's experience threading defense and buildup adds structural assurance behind them. The attacking line is deep enough that Havertz isn't the only answer up top. Coherence, not raw talent, is the question, and this squad's profile suggests that gap has narrowed.`,
  },
  {
    id: 55, team: 'England',
    before: `Kane anchors a front line with genuine depth behind it, and Bellingham gives the midfield a profile few squads can match at this level. The back line is settled if not spectacular, and Rice provides the structural base that lets England play on the front foot. The question is coherence across the whole squad, not individual talent.`,
    after: null, // clean
  },
  {
    id: 56, team: 'Brazil',
    before: `Vinícius Júnior leads an attack with more depth than any squad in the field, and the midfield anchored by Bruno Guimarães gives Brazil a structural core few can match. Marquinhos marshals a settled back line in front of a goalkeeper of genuine pedigree. The profile is undeniably top-tier; the rank reflects open questions about coherence and whether the returning pieces fit the system's current shape.`,
    after: null, // clean (hand-tightened version)
  },
  {
    id: 57, team: 'Morocco',
    before: `Hakimi and Amrabat form the spine Morocco's system is built around — a ball-carrying fullback and a disruptive holding midfielder who together set the tempo and absorb pressure. Behind them, a back line with genuine top-division experience; ahead, a midfield deep enough to rotate without drop-off. The structure is the point here, not a single name.`,
    after:  `Hakimi and Amrabat form the spine Morocco's system is built around: a ball-carrying fullback and a disruptive holding midfielder who together set the tempo and absorb pressure. Behind them, a back line with genuine top-division experience; ahead, a midfield deep enough to rotate without drop-off. The structure is the point here, not a single name.`,
  },
  {
    id: 58, team: 'Netherlands',
    before: `Van Dijk anchors a back line that combines experience and genuine pace — Van de Ven's range and Timber's athleticism give it a shape most defenses at this level lack. The midfield is deep enough to absorb an absentee without losing structure, and Gakpo leads an attack with real width. The concern is whether the pieces cohere under tournament pressure.`,
    after:  `Van Dijk anchors a back line that combines experience and genuine pace: Van de Ven's range and Timber's athleticism give it a shape most defenses at this level lack. The midfield is deep enough to absorb an absentee without losing structure, and Gakpo leads an attack with real width. The concern is whether the pieces cohere under tournament pressure.`,
  },
  {
    id: 59, team: 'Uruguay',
    before: `A midfield anchored by Valverde gives Uruguay rare control and creativity across a full tournament. The central-defensive pairing of R. Araújo and J. Giménez is built for knockout pressure, and Núñez leads a forward line with genuine top-level profile. The settled spine has won together; the depth behind it is what holds the rank.`,
    after: null, // clean (hand-tightened version)
  },
];

const prod = neon(PROD_URL);

// Phase 1: pull actual PROD bodies, verify match expected.
console.log('\n' + '='.repeat(80));
console.log('VERIFY ACTUAL PROD BODIES MATCH EXPECTED "BEFORE"');
console.log('='.repeat(80));
let mismatches = 0;
const pending = [];
for (const r of REWRITES) {
  const row = (await prod`SELECT id, body FROM editorial_blurbs WHERE id = ${r.id}`)[0];
  if (!row) {
    console.log(`  ✗ ${r.team.padEnd(14)} id=${r.id}: NOT FOUND ON PROD`);
    mismatches++;
    continue;
  }
  const matches = row.body === r.before;
  const hasEmDash = row.body.includes('—') || row.body.includes('–');
  if (!matches) {
    console.log(`  ✗ ${r.team.padEnd(14)} id=${r.id}: PROD body differs from expected — body was edited since migration`);
    console.log(`      diff: PROD has length=${row.body.length}, expected length=${r.before.length}`);
    mismatches++;
    continue;
  }
  if (r.after === null) {
    if (hasEmDash) {
      console.log(`  ✗ ${r.team.padEnd(14)} id=${r.id}: marked clean but body still has em dash`);
      mismatches++;
    } else {
      console.log(`  ✓ ${r.team.padEnd(14)} id=${r.id}: already clean, no UPDATE needed`);
    }
    continue;
  }
  console.log(`  ✓ ${r.team.padEnd(14)} id=${r.id}: matches expected, rewrite pending`);
  pending.push(r);
}
if (mismatches > 0) {
  console.log(`\n✗ ${mismatches} mismatch(es) — REFUSING to proceed. Investigate before write.`);
  process.exit(1);
}

console.log(`\n${pending.length} rewrite(s) ready to apply.`);

// Phase 2: print side-by-side.
console.log('\n' + '='.repeat(80));
console.log('REWRITES TO APPLY');
console.log('='.repeat(80));
for (const r of pending) {
  console.log(`\n--- id=${r.id} ${r.team} ---`);
  console.log('  before:');
  console.log('  ' + r.before);
  console.log('  after :');
  console.log('  ' + r.after);
}

if (!WRITE) {
  console.log('\n' + '='.repeat(80));
  console.log('DRY-RUN COMPLETE. Nothing written. Re-run with --write to apply.');
  console.log('='.repeat(80));
  process.exit(0);
}

// Phase 3 (--write): transactional UPDATE.
console.log('\n' + '='.repeat(80));
console.log('APPLYING REWRITES');
console.log('='.repeat(80));
const client = new Client({ connectionString: PROD_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query('BEGIN');
  for (const r of pending) {
    const res = await client.query(
      `UPDATE editorial_blurbs
          SET body = $1,
              updated_at = now()
        WHERE id = $2
          AND blurb_type = 'ranking_row_blurb'
        RETURNING id`,
      [r.after, r.id]
    );
    if (res.rowCount !== 1) {
      await client.query('ROLLBACK');
      throw new Error(`UPDATE id=${r.id} returned rowCount=${res.rowCount}; ROLLBACK fired.`);
    }
    console.log(`  ✓ updated id=${r.id} (${r.team})`);
  }
  await client.query('COMMIT');
  console.log('  ✓ COMMIT.');
} finally {
  await client.end();
}

// Phase 4: re-scan all 10 bodies for any remaining em dash.
console.log('\n' + '='.repeat(80));
console.log('POST-WRITE EM-DASH SCAN (all 10 bodies)');
console.log('='.repeat(80));
let dashHits = 0;
for (const r of REWRITES) {
  const row = (await prod`SELECT body FROM editorial_blurbs WHERE id = ${r.id}`)[0];
  const hasEm = row.body.includes('—');
  const hasEn = row.body.includes('–');
  if (hasEm || hasEn) {
    console.log(`  ✗ id=${r.id} ${r.team}: still contains ${hasEm ? 'em dash' : ''}${hasEm && hasEn ? ' + ' : ''}${hasEn ? 'en dash' : ''}`);
    dashHits++;
  }
}
if (dashHits === 0) {
  console.log('  ✓ 0 em/en dashes across all 10 PROD ranking_row_blurbs.');
} else {
  console.log(`\n✗ ${dashHits} body(ies) still carry a dash — investigate.`);
}
