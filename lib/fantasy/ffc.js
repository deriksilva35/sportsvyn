// lib/fantasy/ffc.js — Fantasy Football Calculator ADP client + snapshot writer
// for the mock draft sim. FFC is free for commercial use, ATTRIBUTION REQUIRED.
//
//   ┌───────────────────────────────────────────────────────────────────────┐
//   │ ATTRIBUTION (REQUIRED): any surface that renders this ADP data MUST     │
//   │ show "ADP data courtesy of Fantasy Football Calculator" linking to      │
//   │ https://fantasyfootballcalculator.com/ . The UI session must not forget │
//   │ this — it is a condition of the free commercial license.                │
//   └───────────────────────────────────────────────────────────────────────┘
//
// Gentle-client discipline (FFC publishes no rate limit; we self-limit):
//   · Only the launch preset pairs per run (snapshotPool caps at 4).
//   · Calls spaced; a failed call retries at most once, no tighter than 30s.
//   · During dev, set FFC_CACHE_DIR to cache raw responses (inert in prod —
//     no env, no filesystem write).
//
// FFC vocab notes (recon ~/scratch/sim-spike/): the ADP path uses our own format
// tokens (ppr/half-ppr/standard/2qb). Player positions come in FFC vocab
// QB/RB/WR/TE/PK/DEF (PK = kicker, DEF = team defense); stored verbatim in the
// pool. FFC fields high/low normalize to adp_high/adp_low; stdev/bye/adp_formatted
// are returned but not stored (out of v1 spec).

import { sql } from '../db.js';

export const FFC_ATTRIBUTION = {
  text: 'ADP data courtesy of Fantasy Football Calculator',
  url: 'https://fantasyfootballcalculator.com/',
};

const FFC_BASE = 'https://fantasyfootballcalculator.com/api/v1/adp';
const FORMAT_TO_FFC = { ppr: 'ppr', 'half-ppr': 'half-ppr', standard: 'standard', '2qb': '2qb' };
const RETRY_DELAY_MS = 30_000;
const SPACING_MS = 2_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalize(p) {
  return {
    ffcPlayerId: String(p.player_id),
    name: p.name,
    position: p.position,      // FFC vocab: QB/RB/WR/TE/PK/DEF (verbatim)
    team: p.team ?? null,
    adp: p.adp,
    adpHigh: p.high ?? null,   // FFC 'high'
    adpLow: p.low ?? null,     // FFC 'low'
    timesDrafted: p.times_drafted ?? null,
  };
}

async function cacheRaw(name, json) {
  const dir = process.env.FFC_CACHE_DIR;
  if (!dir) return;
  try {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(`${dir}/${name}.json`, JSON.stringify(json, null, 2));
  } catch (e) { console.error('[ffc] cache write failed (non-fatal):', e.message); }
}

// Fetch one ADP feed. Returns { meta, rows } with normalized rows. Retries once
// on failure, no tighter than 30s.
export async function fetchAdp(scoringFormat, teamsCount, year = new Date().getUTCFullYear()) {
  const ffcFormat = FORMAT_TO_FFC[scoringFormat];
  if (!ffcFormat) throw new Error(`fetchAdp: unknown scoring format '${scoringFormat}'`);
  const url = `${FFC_BASE}/${ffcFormat}?teams=${teamsCount}&year=${year}&position=all`;

  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAY_MS);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`FFC ${res.status} for ${scoringFormat}/${teamsCount}`);
      const json = await res.json();
      await cacheRaw(`ffc_${scoringFormat}_${teamsCount}_${year}`, json);
      const players = Array.isArray(json.players) ? json.players : [];
      return { meta: json.meta ?? {}, rows: players.map(normalize) };
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// Fetch each preset pair and upsert into sim_player_pool for one snapshot_date.
// Idempotent within a day (ON CONFLICT the natural key -> refresh adp fields).
// pairs: [{ scoringFormat, teamsCount }]; capped at 4 (the launch presets).
export async function snapshotPool(snapshotDate, pairs, { year } = {}) {
  if (!Array.isArray(pairs) || pairs.length === 0) throw new Error('snapshotPool: pairs required');
  if (pairs.length > 4) throw new Error('snapshotPool: refusing more than the 4 preset pairs per run');

  const summary = { snapshotDate, perPair: [], totalUpserted: 0 };
  for (let i = 0; i < pairs.length; i++) {
    const { scoringFormat, teamsCount } = pairs[i];
    if (i > 0) await sleep(SPACING_MS);
    const { meta, rows } = await fetchAdp(scoringFormat, teamsCount, year);
    let n = 0;
    for (const r of rows) {
      await sql`
        INSERT INTO sim_player_pool (
          snapshot_date, scoring_format, teams_count, ffc_player_id, name, position, team,
          adp, adp_high, adp_low, times_drafted
        ) VALUES (
          ${snapshotDate}, ${scoringFormat}, ${teamsCount}, ${r.ffcPlayerId}, ${r.name}, ${r.position}, ${r.team},
          ${r.adp}, ${r.adpHigh}, ${r.adpLow}, ${r.timesDrafted}
        )
        ON CONFLICT (snapshot_date, scoring_format, teams_count, ffc_player_id) DO UPDATE SET
          name = EXCLUDED.name, position = EXCLUDED.position, team = EXCLUDED.team,
          adp = EXCLUDED.adp, adp_high = EXCLUDED.adp_high, adp_low = EXCLUDED.adp_low,
          times_drafted = EXCLUDED.times_drafted`;
      n += 1;
    }
    summary.perPair.push({ scoringFormat, teamsCount, players: n, ffcMeta: meta });
    summary.totalUpserted += n;
  }
  return summary;
}
