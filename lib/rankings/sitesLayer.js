// lib/rankings/sitesLayer.js — Sites Layer (FIFA + ESPN rank → score)
//
// Per Methodology §5 (Intentional Asymmetry), Team Power rankings mix in
// a "Sites Layer" derived from external authority ranks. Phase 1: FIFA +
// ESPN are the only sources; the layer blends them 50/50.
//
// Pure functions only. No DB, no I/O. Pipeline:
//   raw rank (int)  →  normalizeRankToScore(rank, fieldSize)  →  per-source score (0–10)
//   per-source scores  →  sitesComposite({ fifa_score, espn_score })  →  combined score (0–10)
//
// THE CURVE — power-floor blend (configurable, locked here at p=2 / floor=2):
//   score = floor + (10 - floor) * ((N - r + 1) / N) ^ p
//
//   floor = 2.0  → guarantees the worst rank doesn't crash to ~0.
//   p     = 2.0  → top has meaningful separation (#1 vs #5 = ~1.3 gap),
//                  long tail compresses near the floor (#32 vs #48 = ~1.0 gap).
//
// Outputs for the locked WC field size (N=48) at the eyeball checkpoints:
//   rank   1 →  10.00     (#1 anchors the top)
//   rank   5 →   8.72
//   rank  10 →   7.28
//   rank  20 →   4.92
//   rank  32 →   3.00
//   rank  48 →   2.00     (compressed near floor)
//
// If the curve shape needs tuning, change the two constants below and
// re-eyeball — keep the constants here, not threaded as args, so a
// future change is a single-file-edit auditable by diff.

const POWER_EXPONENT = 2.0;
const FLOOR = 2.0;

// Normalize a rank within a field to a 0–10 score using the power-floor
// curve described above. Returns null on invalid input rather than NaN
// so callers can treat it as "no signal" cleanly.
export function normalizeRankToScore(rank, fieldSize) {
  if (rank == null || fieldSize == null) return null;
  const r = Number(rank);
  const N = Number(fieldSize);
  if (!Number.isFinite(r) || !Number.isFinite(N)) return null;
  if (r < 1 || r > N) return null;
  if (N < 2) return null;

  const headroomFraction = (N - r + 1) / N;        // 1.0 for #1, 1/N for #N
  const shaped = Math.pow(headroomFraction, POWER_EXPONENT);
  const raw = FLOOR + (10 - FLOOR) * shaped;
  return round2(raw);
}

// Equal-thirds blend of the three sites-layer sources into a single
// sites_composite. Sources accepted: fifa_score, espn_score, athletic_score.
//
// Missing-source graceful behavior: nulls are dropped; the composite is
// the arithmetic mean over the SOURCES PRESENT. With 3-of-3 present the
// formula reduces to (fifa + espn + athletic) / 3 (the locked Phase 1
// blend). With 2-of-3 it's a 50/50 between the present pair. With 1-of-3
// it's that source verbatim. With 0-of-3 it returns null so the caller
// can record "sites layer not applied" rather than poison the outer
// composite with a fabricated value.
//
// For the WC 2026 Pre-tournament edition we expect 3-of-3 on every team;
// the missing-source paths are forward-coverage for future runs where
// (e.g.) The Athletic doesn't publish a Power 48 ahead of a knockout
// edition.
export function sitesComposite({ fifa_score, espn_score, athletic_score }) {
  const present = [fifa_score, espn_score, athletic_score]
    .filter((s) => s != null && Number.isFinite(Number(s)))
    .map(Number);
  if (present.length === 0) return null;
  const mean = present.reduce((a, b) => a + b, 0) / present.length;
  return round2(mean);
}

// Exposed for tests / eyeball — generates the rank→score table the
// caller pastes in to verify the curve shape before trusting it.
export function curveSamples(fieldSize, ranks = [1, 5, 10, 20, 32, 48]) {
  return ranks
    .filter((r) => r >= 1 && r <= fieldSize)
    .map((r) => ({ rank: r, score: normalizeRankToScore(r, fieldSize) }));
}

// Real seed → sites ranks. The FIFA input is a GLOBAL rank (1..N where N
// can be ~85+ across all FIFA members); this function sorts the field by
// FIFA global ASC and assigns each team a WITHIN-FIELD FIFA rank
// (1..fieldSize), then normalizes that within-field rank. ESPN and
// Athletic ranks are passed in as ALREADY within-field 1..fieldSize and
// used directly.
//
// Inputs:
//   teams:     [{ id, ... }, ...]  (the field's team_id list)
//   seedData:  [{ team_id, fifa_rank_global, espn_rank, athletic_rank }, ...]
//   fieldSize: integer (typically 48 for WC)
//
// Returns Map<team_id, { fifa_rank_global, fifa_rank, fifa_score,
//   espn_rank, espn_score, athletic_rank, athletic_score,
//   sites_composite }>.
//
// Provenance: fifa_rank_global is preserved on each output entry so the
// edition's notes blob can record it (a future reader sees BOTH the raw
// global rank and the within-field re-rank).
export function buildSitesRanksFromSeed(teams, seedData, fieldSize = 48) {
  // Step 1: sort by FIFA global rank ASC → assign within-field rank 1..N.
  // Teams missing a global FIFA rank are left out of the within-field
  // ordering and get fifa_rank=null + fifa_score=null (sitesComposite
  // falls back to the 2-source mean per its graceful-missing path).
  const seedByTeamId = new Map();
  for (const s of seedData) seedByTeamId.set(s.team_id, s);

  const withFifa = seedData
    .filter((s) => s.fifa_rank_global != null && Number.isFinite(Number(s.fifa_rank_global)))
    .slice()
    .sort((a, b) => Number(a.fifa_rank_global) - Number(b.fifa_rank_global));

  const fifaWithinField = new Map();
  withFifa.forEach((s, i) => fifaWithinField.set(s.team_id, i + 1));

  // Step 2: assemble each team's sites layer.
  const out = new Map();
  for (const t of teams) {
    const s = seedByTeamId.get(t.id);
    if (!s) continue;  // team is in the field but not in the seed — caller decides
    const fifa_rank = fifaWithinField.get(t.id) ?? null;
    const fifa_score = fifa_rank != null ? normalizeRankToScore(fifa_rank, fieldSize) : null;
    const espn_score = s.espn_rank != null ? normalizeRankToScore(s.espn_rank, fieldSize) : null;
    const athletic_score = s.athletic_rank != null ? normalizeRankToScore(s.athletic_rank, fieldSize) : null;
    out.set(t.id, {
      fifa_rank_global: s.fifa_rank_global ?? null,
      fifa_rank,
      fifa_score,
      espn_rank: s.espn_rank ?? null,
      espn_score,
      athletic_rank: s.athletic_rank ?? null,
      athletic_score,
      sites_composite: sitesComposite({ fifa_score, espn_score, athletic_score }),
    });
  }
  return out;
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}
