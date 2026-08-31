// lib/wire/records.js — a team's record changed.
//
// EMITTED AT WRITE TIME, NOT DIFFED AFTERWARDS. team_records is 275 rows and
// 275 unique keys: one row per team-season, rewritten in place, with no
// history. Every one of them already has updated_at > created_at, so flips have
// happened and left no trace. The options were a history table or emitting from
// the sync that already holds both values in hand - and the sync is both
// cheaper and more truthful, because it knows the before without inferring it.
//
// SO THIS FILE EXPORTS A SHAPER, NOT A READER. lib/standings/* calls
// recordFlipRows() with what it is about to write and what is already there;
// there is nothing here to poll.

import { wireKey } from './hash.js';

/** "USC to 2-0" / "TCU to 0-1". PURE. */
export function recordHeadline(t, after) {
  const who = t.abbreviation ?? t.name;
  if (!who) return null;
  const w = after.wins; const l = after.losses; const ties = after.ties;
  if (w == null || l == null) return null;
  const rec = ties ? `${w}-${l}-${ties}` : `${w}-${l}`;
  return `${who} to ${rec}`;
}

/**
 * @param {Array<{team, before, after, leagueId, leagueSlug, season}>} changes
 *   `before` is null the first time a team is written this season.
 */
export function recordFlipRows(changes) {
  const out = [];
  for (const c of changes ?? []) {
    const b = c.before; const a = c.after;
    if (!a) continue;
    // THE FIRST WRITE OF A SEASON IS NOT A FLIP. Nothing changed; a row simply
    // appeared. And a rewrite that did not move the record is not news either -
    // the sync rewrites every row every run.
    if (!b) continue;
    const same = (b.wins ?? 0) === (a.wins ?? 0)
      && (b.losses ?? 0) === (a.losses ?? 0)
      && (b.ties ?? 0) === (a.ties ?? 0);
    if (same) continue;
    const headline = recordHeadline(c.team, a);
    if (!headline) continue;
    out.push({
      league_id: c.leagueId ?? null,
      team_ids: [c.team?.id].filter(Boolean),
      lane: 'record',
      headline,
      url: `/${c.leagueSlug}/standings`,
      source: 'Sportsvyn',
      published_at: null,
      // ONE PER TEAM PER RECORD. Keying on the record itself rather than a
      // clock means a re-run of the same sync is a no-op, and a team that
      // reaches 2-0 twice in a season cannot happen.
      dedupe_hash: wireKey('record', c.leagueSlug, c.season, c.team?.id,
        `${a.wins}-${a.losses}-${a.ties ?? 0}`),
      payload: {
        before: b ? { w: b.wins, l: b.losses, t: b.ties ?? 0 } : null,
        after: { w: a.wins, l: a.losses, t: a.ties ?? 0 },
      },
    });
  }
  return out;
}
