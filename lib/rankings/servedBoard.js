// lib/rankings/servedBoard.js - THE BOARD EACH LEAGUE SERVES, in one place.
//
// ONE ANSWER TO "WHICH LIST IS THE RANKING" (tue-13 / wed-1). The NFL serves
// nfl-power-z - the z-score model Derik chose on 27 Sep - and the Elo board
// (nfl-power) keeps computing every Tuesday but is no longer shown. CFB serves
// cfb-top25 (Elo + AP). The rankings hub, its arcade board and the team hero all
// read SERVED, so a future switch is one line here rather than three surfaces
// that each remember a slug and one that forgets.
//
// BY SLUG, NOT BY is_active. nfl-power-z was created inactive (migration 115)
// while it was reviewed on a hidden tab, and the flag is a database write this
// relay does not make; the current published edition of the named list is what
// is served, the same rule lib/rankings/nflPowerZReads.js has always read by.
//
// THE DATA IS THE EDITION'S OWN. The weights printed under the board are the
// ones the edition stored (notes.weights for the z model; the editorial/sites
// columns for the Elo+AP blend), the week is notes.forWeek, the working is the
// entry's inputs blob. Nothing here recomputes a number or types one in.

import { sql as defaultSql } from '../db.js';
import { COMPONENT_LABELS, SEASON_SCOPE } from './nflPowerZ.js';
import { formatRecord } from '../standings/view.js';

// THE CONFIG LIVES IN ./served.js (no database import) and is re-exported
// here, so every existing `import { SERVED, servedList } from servedBoard`
// keeps working.
import { SERVED, servedList, powerRating, tiedRanks, rankLabel } from './served.js';
export { SERVED, servedList, powerRating, tiedRanks, rankLabel };

const num = (v) => (v == null || v === '' ? null : Number(v));

/** ranking_editions.notes is JSON for every computed edition and prose for edition 0. */
export function parseNotes(notes) {
  if (notes == null) return null;
  if (typeof notes === 'object') return notes;
  try { const o = JSON.parse(notes); return o && typeof o === 'object' ? o : null; } catch { return null; }
}

/**
 * PURE. The weights the edition stored, as [{ key, label, weight, pct }] in the
 * stored order. pct is each weight's share of the stored sum, so a set that
 * stops summing to 100 still prints honest percentages.
 */
export function storedWeights(league, ed) {
  let pairs = [];
  if (SERVED[league]?.model === 'z') {
    const w = parseNotes(ed?.notes)?.weights ?? null;
    pairs = w ? Object.entries(w).map(([key, weight]) => [key, COMPONENT_LABELS[key] ?? key, Number(weight)]) : [];
  } else {
    // THE ELO+AP BLEND'S WEIGHTS ARE COLUMNS on the edition (editorial_weight,
    // sites_weight) - the same pair composeOuterScores applied.
    const e = num(ed?.editorial_weight); const s = num(ed?.sites_weight);
    if (e != null) pairs.push(['editorial', 'Model', e]);
    if (s != null && s > 0) pairs.push(['sites', 'AP', s]);
  }
  const sum = pairs.reduce((a, [, , w]) => a + (Number.isFinite(w) ? w : 0), 0);
  return pairs.map(([key, label, weight]) => ({ key, label, weight, pct: sum ? Math.round((weight / sum) * 100) : null }));
}

/**
 * PURE. The working behind one row, as label/value lines, from the entry's
 * stored inputs blob - never recomputed.
 *
 * NFL (z): one line per stored weight key: the raw component, its z-score and
 * its weight. adjPA is STORED RAW (lower is better) and shown NEGATED, the
 * convention the model's own table uses (PowerZBoard, nflPowerZReads), so every
 * line reads higher-is-better. The sum line is the stored power.
 *
 * CFB (Elo + AP): the Elo rating, the model score it became, the AP rank and
 * the curved AP score, each blend term with its stored weight.
 */
export function workingFor(league, row, weights = []) {
  const inp = row?.inputs;
  if (!inp) return null;
  if (SERVED[league]?.model === 'z') {
    const comps = inp.components ?? {}; const z = inp.z ?? {};
    const lines = weights.map((w) => {
      const rawStored = comps[w.key];
      const raw = rawStored == null ? null : (w.key === 'adjPA' ? -rawStored : rawStored);
      return { key: w.key, label: w.label, value: fmtComponent(w.key, raw), z: signed(z[w.key], 2), weight: w.pct == null ? null : `${w.pct}%` };
    });
    // THE TOTAL IS THE 0-100 RATING the row shows, with the stored z beside
    // it, so the working ends on the number the reader tapped.
    const rating = powerRating(inp.power ?? row.score);
    return { lines, total: { label: 'Power', value: rating == null ? null : String(rating), z: signed(inp.power, 2) } };
  }
  const ap = inp.ap ?? null;
  const wEd = weights.find((w) => w.key === 'editorial'); const wAp = weights.find((w) => w.key === 'sites');
  // AN UNRANKED TEAM IS SCORED ON THE MODEL ALONE (composeOuterScores falls
  // back to editorial-only when there is no sites score), so its model line
  // carries the whole weight and the AP line says unranked.
  // THE EDITOR'S RANK LEADS for a listed team: since wed-6 it IS the team's
  // published rank (rankBySort), so it is the first fact of the working.
  const editor = inp.editor ?? null;
  const lines = [
    ...(editor?.rank != null ? [{ key: 'editor', label: 'Editor rank', value: `#${editor.rank}`, z: null, weight: null }] : []),
    { key: 'elo', label: 'Elo', value: inp.elo == null ? null : Number(inp.elo).toFixed(1),
      z: inp.delta3 == null ? null : `${signed(inp.delta3, 1)} last 3`, weight: null },
    { key: 'model', label: 'Model score', value: inp.composite?.value == null ? null : Number(inp.composite.value).toFixed(2),
      z: null, weight: ap ? (wEd?.pct == null ? null : `${wEd.pct}%`) : '100%' },
    { key: 'apRank', label: 'AP rank', value: ap ? `#${ap.rank}` : 'unranked', z: null, weight: null },
    { key: 'apCurved', label: inp.field ? `AP curved (${inp.field} teams)` : 'AP curved',
      value: ap?.score == null ? null : Number(ap.score).toFixed(2), z: null,
      weight: ap ? (wAp?.pct == null ? null : `${wAp.pct}%`) : null },
  ];
  return { lines, total: { label: 'Score', value: row.score == null ? null : Number(row.score).toFixed(2) } };
}

function fmtComponent(key, v) {
  if (v == null) return null;
  if (key === 'win') return Number(v).toFixed(3);
  if (key === 'qorB') return signed(v, 2);
  return signed(v, 1);
}

export function signed(v, d = 1) {
  if (v == null || !Number.isFinite(Number(v))) return null;
  const n = Number(v);
  const s = Math.abs(n).toFixed(d);
  return Number(s) === 0 ? s : `${n > 0 ? '+' : '−'}${s}`;
}

/** PURE. The rows and header facts of a board from the reader's result sets. */
export function shapeBoard(league, rows, recordByTeam = new Map()) {
  if (!rows?.length) return null;
  const ed = rows[0];
  const notes = parseNotes(ed.notes);
  const weights = storedWeights(league, ed);
  return {
    league,
    list: SERVED[league]?.list ?? null,
    editionNumber: ed.edition_number,
    editionLabel: ed.edition_label,
    publishedAt: ed.published_at,
    forWeek: notes?.forWeek ?? null,
    // CFB's edition names the AP poll it blended; the NFL's names its scope.
    scope: SERVED[league]?.model === 'z' ? SEASON_SCOPE : null,
    apWeek: notes?.ap?.week ?? null,
    weights,
    rows: rows.map((r) => {
      const inputs = r.inputs && Object.keys(r.inputs).length ? r.inputs : null;
      const rec = inputs?.record?.text ?? recordByTeam.get(Number(r.team_id)) ?? null;
      return {
        rank: r.rank,
        score: num(r.score),
        teamId: r.team_id == null ? null : Number(r.team_id),
        name: r.short_name ?? r.name ?? r.selection_label ?? null,
        fullName: r.name ?? r.selection_label ?? null,
        abbreviation: r.abbreviation ?? null,
        slug: r.slug ?? null,
        colors: { primary: r.color_primary ?? null, secondary: r.color_secondary ?? null },
        previousRank: r.previous_rank ?? null,
        rankMovement: r.rank_movement ?? null,
        record: rec,
        inputs,
      };
    }),
  };
}

/** The current edition of the league's SERVED list, shaped for a board. null when none. */
export async function getServedBoard(league, { sql = defaultSql } = {}) {
  const list = servedList(league);
  if (!list) return null;
  const rows = await sql`
    SELECT ed.edition_number, ed.edition_label, ed.published_at, ed.notes,
           ed.editorial_weight, ed.sites_weight,
           e.rank, e.score, e.team_id, e.selection_label, e.previous_rank, e.rank_movement, e.inputs,
           t.slug, t.name, t.short_name, t.abbreviation, t.color_primary, t.color_secondary
      FROM ranking_lists rl
      JOIN ranking_editions ed ON ed.ranking_list_id = rl.id AND ed.is_current AND ed.status = 'published'
      JOIN ranking_entries e ON e.ranking_edition_id = ed.id
      LEFT JOIN teams t ON t.id = e.team_id
     WHERE rl.slug = ${list}
     ORDER BY e.rank ASC, e.id ASC`;
  if (!rows.length) return null;
  // THE RECORD, when the entry did not store one. The z model stores its own
  // (inputs.record, as of the edition); the Elo board does not, so CFB reads
  // the REG record of the season the edition is FOR - never a calendar guess.
  let recordByTeam = new Map();
  const season = parseNotes(rows[0].notes)?.forWeek?.season ?? null;
  const missing = rows.filter((r) => !r.inputs?.record?.text && r.team_id != null).map((r) => Number(r.team_id));
  if (season != null && missing.length) {
    const recs = await sql`
      SELECT tr.team_id, tr.wins, tr.losses, tr.ties
        FROM team_records tr
        JOIN leagues l ON l.id = tr.league_id AND l.slug = ${league}
       WHERE tr.season = ${season} AND tr.season_type = 'regular'
         AND tr.team_id = ANY(${missing}::bigint[])`;
    recordByTeam = new Map(recs.map((r) => [Number(r.team_id), formatRecord(r.wins, r.losses, r.ties)]));
  }
  return shapeBoard(league, rows, recordByTeam);
}

/**
 * THE TEAM HERO'S NUMBERS, from the SERVED list's current edition. Returns
 * { rank, score, movement, label } or null when the team is not on it - and
 * null is final: the hero draws no rank block rather than falling back to
 * teams.current_power_*, which the retired Elo board still writes for the NFL.
 */
export async function servedRankFor(league, teamId, { sql = defaultSql } = {}) {
  const list = servedList(league);
  if (!list || teamId == null) return null;
  const [r] = await sql`
    SELECT e.rank, e.score, e.rank_movement
      FROM ranking_lists rl
      JOIN ranking_editions ed ON ed.ranking_list_id = rl.id AND ed.is_current AND ed.status = 'published'
      JOIN ranking_entries e ON e.ranking_edition_id = ed.id
     WHERE rl.slug = ${list} AND e.team_id = ${teamId}
     LIMIT 1`;
  if (!r) return null;
  // THE NFL SCORE IS SHOWN AS ITS 0-100 RATING (wed-6); `rating` says so to
  // the hero, which then prints it as a whole number. CFB is unchanged.
  const z = SERVED[league].model === 'z';
  return { rank: r.rank, score: z ? powerRating(r.score) : num(r.score), rating: z, movement: r.rank_movement ?? null, label: SERVED[league].scoreLabel };
}
