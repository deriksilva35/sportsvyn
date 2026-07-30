/**
 * /api/cron/adp-snapshot — daily FFC ADP snapshot into sim_player_pool. 11:00 UTC
 * (~06-07 ET), clear of every other cron hour: refresh-odds owns :00 of each hour
 * but nothing else claims 11, the editions run 12:00/12:30, map-ko-fixtures 08:00,
 * nfl-stats-sweep Tue 08:00, gridiron-teams Wed 07:00. Early-morning ET also means
 * the previous day's drafts are fully inside FFC's trailing ADP window before we
 * read it, and the fresh pool is in place before US daytime traffic.
 *
 * Once a day is the correct cadence: FFC recomputes ADP daily, and sim_player_pool
 * is keyed by snapshot_date — a second tick in the same day would only overwrite
 * the same row set (harmless, but no new information, and it burns upstream calls).
 *
 * Three steps, the first two in order because a snapshot is not usable until both
 * have run:
 *   1. snapshotPool()        — fetch each preset feed, upsert the ADP rows.
 *   2. matchPoolIdentities() — resolve each pool identity to an nfl_players row
 *                              and write sim_player_pool.matched_player_id.
 *   3. measureCalibration()  — record the full-auto grade distribution over the
 *                              new pool into the run summary, and alert on a
 *                              SUSTAINED drift past the A-rate ceiling. Read-only
 *                              and non-fatal; see the block where it runs.
 * Step 2 is NOT optional. snapshotPool leaves matched_player_id NULL, and the
 * draft room's stat lines join through exactly that column
 * (lib/fantasy/playerStats.js resolveIdentities). Ship step 1 alone and every new
 * snapshot lands unmatched: the pool looks fresh while every stat line behind it
 * goes dark. Matching is name+position based and idempotent, so it also heals
 * older snapshots on each run.
 *
 * WRITES ONLY sim_player_pool — both steps. Step 2 READS nfl_players/teams to
 * resolve identity (that is what matched_player_id is for) but writes nothing
 * outside the pool.
 *
 * The standing fan-out rule still holds and this route obeys it: never join STATS
 * through the pool. The pool is an ADP price list with one row per player PER
 * preset pair, so a stat join through it multiplies every player by the pair count
 * and reads a per-player stat lookup for each copy. Stat reads belong in
 * lib/fantasy/playerStats.js, which collapses the pair fan-out with DISTINCT ON
 * before touching nfl_player_game_stats. Nothing here reads a stat table.
 *
 * Heavy-ish and strictly sequential by design: snapshotPool self-limits to the 4
 * launch preset pairs, spaces the fetches 2s apart, retries a failed fetch once no
 * tighter than 30s, and upserts row-by-row over Neon's one-shot HTTP driver
 * (~850 rows => ~850 round trips), then matching adds one UPDATE per identity
 * (~260). Measured 69s for step 1 alone against DEV — which is why maxDuration is
 * 300 and not 60: a single 30s upstream retry would blow a 60s ceiling on its own.
 *
 * Under an advisory lock; failure -> throttled alert. Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { snapshotPool } from '@/lib/fantasy/ffc';
import { matchPoolIdentities } from '@/lib/gridiron/nameMatch';
import { LAUNCH_PRESET_PAIRS } from '@/lib/fantasy/config';
import {
  poolConfigs, measureCalibration, shouldAlertCalibration, breachStreak,
  A_CEILING_PCT, A_BREACH_STREAK,
} from '@/lib/fantasy/calibration';
import { resolveSeasonYear } from '@/lib/pollers/seasonResolver';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const now = new Date();
  // snapshot_date is a UTC calendar day (the pool's natural-key component and what
  // getAdpMovers diffs on); season year is the football season, so July onward is
  // already the coming season's ADP board.
  const snapshotDate = now.toISOString().slice(0, 10);
  const year = resolveSeasonYear(now);

  const outcome = await withAdvisoryLock('adp-snapshot', async () =>
    recordRun(sql, {
      source: 'adp-snapshot',
      kind: 'adp',
      run: async () => {
        const s = await snapshotPool(snapshotDate, LAUNCH_PRESET_PAIRS, { year });
        const m = await matchPoolIdentities(sql, { log: console.log });

        // Grade calibration against the pool we just wrote. This is MONITORING,
        // not a gate: the corpus the bands were tuned on is a checked-in fixture
        // (grade.test.mjs), because the realized A-rate moves with FFC's board and
        // a live number cannot be asserted. We record it daily so a persistent
        // drift is visible, and alert only on a sustained run (below). A bad
        // reading never fails the run — the snapshot itself is still good.
        let calibration = null;
        try {
          const presets = await sql`
            SELECT name, teams_count, scoring_format, roster_slots
              FROM draft_configs WHERE is_preset = true ORDER BY id`;
          const rows = await sql`
            SELECT scoring_format, teams_count, ffc_player_id, name, position, team, adp, stdev, bye
              FROM sim_player_pool WHERE snapshot_date = ${snapshotDate}`;
          calibration = { ...measureCalibration(poolConfigs(presets, rows)), ceiling: A_CEILING_PCT };
        } catch (e) {
          calibration = { error: String(e?.message ?? e).slice(0, 200) };
        }
        // Flatten FFC's per-pair meta into the summary counts we actually want to
        // read back out of sync_runs: rows written per pair, and the draft volume
        // + window each ADP figure was computed over (ffcMeta is kept whole for
        // provenance). match carries only counts — the unmatched/ambiguous NAME
        // lists can run to dozens of entries and sync_runs.summary is not the place
        // for a roster dump; rerun matchPoolIdentities by hand to see them.
        return {
          snapshotDate: s.snapshotDate,
          year,
          pairs: s.perPair.length,
          totalUpserted: s.totalUpserted,
          perPair: s.perPair.map((p) => ({
            scoringFormat: p.scoringFormat,
            teamsCount: p.teamsCount,
            players: p.players,
            ffcDrafts: p.ffcMeta?.total_drafts ?? null,
            ffcWindow: [p.ffcMeta?.start_date ?? null, p.ffcMeta?.end_date ?? null],
          })),
          match: m.counts,
          calibration,
        };
      },
    }),
  );

  if (outcome.locked) {
    await recordDecision(sql, { source: 'adp-snapshot', kind: 'skipped-locked', summary: { snapshotDate, year } });
    return Response.json({ decision: 'skipped-locked', snapshotDate, year });
  }

  const res = outcome.result;
  if (!res.ok) {
    await maybeAlert(sql, {
      source: 'adp-snapshot',
      subject: '[pollers] adp-snapshot FAILED',
      body: `source: adp-snapshot\nsnapshot_date: ${snapshotDate}\nyear: ${year}\n\n${res.error}`,
    });
  }

  // Sustained calibration drift. One day over the ceiling is FFC's board turning
  // over; A_BREACH_STREAK days running is a trend worth a deliberate look. Alerted
  // under its OWN source key so it shares no rate-limit window with the failure
  // alert above — a week of ingest failures must not silently swallow this.
  //
  // If this fires, the response is a recalibration SESSION (retune the band edges,
  // regenerate calibrationPool.fixture.json, update
  // docs/design/sim-methodology-draft.md), never a threshold edit.
  const aPct = res.summary?.calibration?.aPct ?? null;
  if (res.ok && typeof aPct === 'number') {
    const priors = (await sql`
      SELECT (summary -> 'calibration' ->> 'aPct')::float AS a
        FROM sync_runs
       WHERE source = 'adp-snapshot' AND kind = 'adp' AND ok = true AND id < ${res.id}
       ORDER BY started_at DESC LIMIT ${A_BREACH_STREAK - 1}`).map((r) => r.a);
    const series = [aPct, ...priors]; // newest-first
    if (shouldAlertCalibration(series)) {
      await maybeAlert(sql, {
        source: 'adp-calibration',
        subject: `[sim] grade calibration over ceiling ${breachStreak(series)} days running`,
        body: [
          `The full-auto A-rate has been above ${A_CEILING_PCT}% for ${breachStreak(series)} consecutive snapshots.`,
          '',
          `readings (newest first): ${series.map((v) => (v == null ? 'n/a' : `${v}%`)).join(', ')}`,
          `latest snapshot: ${snapshotDate}`,
          `median band: ${res.summary.calibration.medianBand} (${res.summary.calibration.median})`,
          `histogram: ${JSON.stringify(res.summary.calibration.histogram)}`,
          '',
          'The stated principle is "an unattended draft is an average draft": median',
          `B-/C+ with A at most ${A_CEILING_PCT}% of auto-drafts.`,
          '',
          'This is the signal for a recalibration session — retune the band edges in',
          'lib/fantasy/grade.js, regenerate lib/fantasy/calibrationPool.fixture.json,',
          'and update docs/design/sim-methodology-draft.md together. Do NOT loosen the',
          'assertion in grade.test.mjs.',
        ].join('\n'),
      });
    }
  }
  return Response.json({
    snapshotDate,
    year,
    ok: res.ok,
    id: res.id,
    totalUpserted: res.summary?.totalUpserted ?? null,
    match: res.summary?.match ?? null,
    calibration: res.summary?.calibration ?? null,
  });
}
