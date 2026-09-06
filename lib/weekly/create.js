// lib/weekly/create.js - making a week's board.
//
// THE POOL AND THE DEADLINE ARE BOTH SNAPSHOTTED HERE, and neither moves
// again. See pool.js for why the pool freezes; locks_at freezes for the same
// class of reason - a deadline that chases a rescheduled kickoff either steals
// time from someone who set an alarm or locks them out early, and both break a
// promise already made.
//
// THE WEEK IS DERIVED FROM THE CALENDAR, never trusted from a caller (the
// preseason rehearsal's F1: asked for 'week 2' in August, the old builder
// quietly built SEPTEMBER's REG week 2 with a stale August pool - no refusal,
// a landmine in the unique slot the real creation would need). The window is
// the week of the NEXT REG kickoff, the Pick'em builder's pattern applied to
// a schedule whose week numbers the provider actually owns. A caller-supplied
// season/week is at most an assertion: derived != asked refuses loudly.

import { sql } from '../db.js';
import { activePool, firstKickoff } from './pool.js';
import { easternLocalToUtc } from '../gridiron/ingest.js';
// CIRCULAR, ON PURPOSE, SAFE: lib/draft/contest.js imports tuesdayBefore from
// THIS file already. Both directions only ever touch the other's export
// inside a function body, never at module top-level, so by the time either
// export is actually READ (a real call, long after both modules finished
// loading) the live binding is fully resolved - the standard, well-supported
// shape of an ES module cycle. DRAFT_CONFIG is a plain object, not a function
// that runs at import time, so there is nothing here that could observe a
// half-initialized module either way.
import { DRAFT_CONFIG } from '../draft/contest.js';

/**
 * The 9am ET Tuesday on or before a kickoff, as a naive ET timestamp string.
 *
 * ON OR BEFORE, not "the previous Tuesday": a Tuesday kickoff would otherwise
 * open its own board a week early. The NFL has played on Tuesday (weather
 * reschedules, and the 2020 season did it twice), so this is not hypothetical.
 */
export function tuesdayBefore(kickoffIso, hour = 9) {
  const d = new Date(kickoffIso);
  // getUTCDay on the kickoff instant is close enough to pick the weekday: the
  // result is anchored to a DATE, and the exact ET time of day is applied by
  // easternLocalToUtc afterwards.
  const back = (d.getUTCDay() - 2 + 7) % 7;   // 2 = Tuesday
  const t = new Date(d.getTime() - back * 86_400_000);
  const day = t.toISOString().slice(0, 10);
  return `${day} ${String(hour).padStart(2, '0')}:00:00`;
}

/**
 * THE CURRENT NFL REG WEEK, DERIVED, NEVER TYPED (see the file header) - the
 * (season, week) of the next REG kickoff at or after `now`. THE ONE
 * DERIVATION, called from here by weeklyBoardPlan() and from Pick'em's own
 * NFL board builder (lib/pickem/create.js, relay 2c item 5) - two games
 * naming the same "current week" must never risk disagreeing because one of
 * them re-derived it its own way.
 */
export async function nextNflRegWeek(now = new Date()) {
  const next = (await sql`
    SELECT m.season_year, m.week FROM matches m JOIN leagues l ON l.id = m.league_id
     WHERE l.slug = 'nfl' AND m.season_phase = 'REG'
       AND m.kickoff_at >= ${new Date(now).toISOString()}
     ORDER BY m.kickoff_at ASC LIMIT 1`)[0];
  return next ? { season: next.season_year, week: next.week } : null;
}

/**
 * Everything the next board would be, WITHOUT writing - the Pick'em
 * boardPlan shape. The window: the (season, week) of the next REG kickoff.
 */
export async function weeklyBoardPlan({ now = new Date() } = {}) {
  const next = await nextNflRegWeek(now);
  if (!next) return { plan: null, reason: 'no-upcoming-games' };
  const season = next.season;
  const week = next.week;

  // The WEEK'S first kickoff, which can precede `now` mid-week - correct:
  // the deadline is the week's, not the tick's.
  const ko = await firstKickoff(season, week);
  const board = await activePool();
  if (!board.length) return { plan: null, reason: 'empty-pool' };

  // OPENS TUESDAY MORNING ET, because that is what every surface promises.
  //
  // TUESDAY IS THE RIGHT ANCHOR because it is when the PREVIOUS week settles
  // (settles_at is Tuesday morning too). The season reads as one loop: last
  // week's result and next week's board arrive together.
  //
  // DST-AWARE VIA THE SANCTIONED HELPER. easternLocalToUtc is the only place
  // this codebase converts ET-local to UTC, and a hand-rolled offset here
  // would be off by an hour for every board after the November change.
  const opens = new Date(await easternLocalToUtc(tuesdayBefore(ko)));
  const last = (await sql`
    SELECT max(m.kickoff_at) ko FROM matches m JOIN leagues l ON l.id = m.league_id
     WHERE l.slug='nfl' AND m.season_year=${season} AND m.season_phase='REG' AND m.week=${week}`)[0]?.ko;
  // Settles when the week's last game is comfortably done. Advisory only -
  // the settle gate decides, not the clock.
  const settles = new Date(new Date(last ?? ko).getTime() + 12 * 3_600_000);
  return { plan: { season, week, ko, opens, settles, board }, reason: null };
}

/**
 * Create the next week's board if its open has arrived and it is not already
 * there. IDEMPOTENT the Pick'em way: existence check + ON CONFLICT DO NOTHING
 * against 067's partial unique index; a double fire is a no-op, a race loses
 * to the row that won and says so. season/week params are ASSERTIONS only.
 */
export async function ensureWeek(season = null, week = null, { sport = 'nfl', opensAt = null, now = new Date() } = {}) {
  const { plan, reason } = await weeklyBoardPlan({ now });
  if (!plan) return { created: false, reason };

  // F1'S LAW: the caller's week is verified, never obeyed. A mismatch is a
  // wrong ask (the August 'week 2' that meant preseason), and the answer is
  // a loud refusal, not somebody else's board.
  if ((season != null && Number(season) !== Number(plan.season))
    || (week != null && Number(week) !== Number(plan.week))) {
    return {
      created: false, reason: 'week_mismatch',
      derived: { season: plan.season, week: plan.week },
      asked: { season, week },
    };
  }

  const existing = await sql`
    SELECT id FROM contests
     WHERE game_type = 'weekly' AND sport = ${sport}
       AND season_year = ${plan.season} AND week = ${plan.week}`;
  // NOT RE-CHECKING DRAFT HERE, ON PURPOSE: both rows are created together in
  // one transaction below, so once the weekly row exists the draft row does
  // too - re-verifying it on every idempotent no-op call would be a query
  // this invariant does not need. See the transaction below for where the
  // guarantee actually lives.
  if (existing.length) return { id: existing[0].id, created: false, reason: 'exists' };

  // THE OPEN GATE (Pick'em pattern): a live cron must not un-ghost the lobby
  // card before the promised Tuesday morning.
  const opens = opensAt ? new Date(opensAt) : plan.opens;
  if (new Date(now) < opens) {
    return { created: false, reason: 'before-open', opensAt: opens.toISOString() };
  }

  // BOTH ROWS OR NEITHER (ruling): the draft contest shares this exact board,
  // opens_at, locks_at and settles_at - two games, one week, one board, per
  // lib/draft/contest.js's own header. Checked for existence BEFORE the
  // transaction, same as the weekly row above, so a retry after a partial
  // prior failure inserts only whichever row is still actually missing.
  // sql.transaction() takes an array of statements with no control flow
  // between them (see lib/membership.js's own note on this) - both inserts
  // qualify, since neither needs the other's result to know what to write.
  const existingDraft = await sql`
    SELECT id FROM contests
     WHERE game_type = 'draft' AND sport = ${sport}
       AND season_year = ${plan.season} AND week = ${plan.week}`;

  const stmts = [sql`
    INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at, settles_at)
    VALUES ('weekly', ${sport}, ${plan.season}, ${plan.week}, ${JSON.stringify(plan.board)}::jsonb,
            ${opens.toISOString()}, ${new Date(plan.ko).toISOString()}, ${plan.settles.toISOString()})
    ON CONFLICT DO NOTHING
    RETURNING id`];
  if (!existingDraft.length) {
    stmts.push(sql`
      INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at, settles_at, meta)
      VALUES ('draft', ${sport}, ${plan.season}, ${plan.week}, ${JSON.stringify(plan.board)}::jsonb,
              ${opens.toISOString()}, ${new Date(plan.ko).toISOString()}, ${plan.settles.toISOString()},
              ${JSON.stringify({ config: DRAFT_CONFIG })}::jsonb)
      ON CONFLICT DO NOTHING
      RETURNING id`);
  }
  const results = await sql.transaction(stmts);
  const [weeklyRows, draftRows] = results;

  if (!weeklyRows.length) {
    const again = await sql`
      SELECT id FROM contests WHERE game_type='weekly' AND sport=${sport}
        AND season_year=${plan.season} AND week=${plan.week}`;
    return { id: again[0]?.id, created: false, reason: 'raced' };
  }

  const draft = existingDraft.length
    ? { id: existingDraft[0].id, created: false, reason: 'exists' }
    : draftRows.length
      ? { id: draftRows[0].id, created: true }
      : { id: null, created: false, reason: 'raced' };

  return { id: weeklyRows[0].id, created: true, week: plan.week, poolSize: plan.board.length, locksAt: plan.ko, draft };
}
