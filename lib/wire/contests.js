// lib/wire/contests.js — a board opened, a board locks.
//
// THE ONLY EMITTER THAT DETECTS NOTHING. opens_at and locks_at are stored
// future timestamps, so this is not observation - it is a calendar read. It
// asks what crosses inside the tick window and says so.
//
// THE LEAGUE COMES FROM contests.sport, NOT A league_id COLUMN - contests has
// no such column, it stores the sport slug. Left-joined so a contest for a
// sport we do not hold as a league still emits, with a null league.
//
// THE WINDOW IS THE CRON'S, PASSED IN. A 15-minute cron asks for the next 15
// minutes; nothing here knows or assumes the cadence, which is what stops a
// schedule change from silently opening a gap.

import { sql } from '../db.js';
import { wireKey } from './hash.js';

const LABEL = { pickem: "Pick 'em", weekly: 'The Weekly', draft: 'The Draft', daily: 'The Daily' };

/** "Pick 'em board 2 locks in 15 min". PURE. */
export function contestHeadline(c, kind) {
  const name = LABEL[c.game_type] ?? c.game_type;
  const which = c.week ? ` week ${c.week}` : '';
  if (kind === 'locks') return `${name}${which} locks in ${c.minutes} min`;
  return `${name}${which} is open`;
}

export function toRows(rows, kind) {
  return (rows ?? []).map((c) => ({
    league_id: c.league_id ?? null,
    team_ids: [],
    lane: 'contest',
    headline: contestHeadline(c, kind),
    url: c.game_type === 'pickem' ? '/pickem' : `/${c.game_type}`,
    source: 'Sportsvyn',
    published_at: kind === 'locks' ? c.locks_at : c.opens_at,
    // ONE EVENT PER CONTEST PER KIND, EVER. A board opens once and locks once;
    // no time bucket, because a second emission would be a second claim about
    // the same moment.
    dedupe_hash: wireKey('contest', kind, c.id),
    payload: { contestId: c.id, gameType: c.game_type, week: c.week ?? null },
  }));
}

export async function contestEvents({ now = new Date(), windowMin = 15 } = {}) {
  const t = new Date(now).toISOString();
  const [opens, locks] = await Promise.all([
    sql`SELECT c.id, c.game_type, c.week, c.sport, l.id AS league_id, c.opens_at, c.locks_at
          FROM contests c LEFT JOIN leagues l ON l.slug = c.sport
         WHERE c.opens_at > ${t}::timestamptz - (${windowMin} || ' minutes')::interval
           AND c.opens_at <= ${t}::timestamptz`,
    sql`SELECT c.id, c.game_type, c.week, c.sport, l.id AS league_id, c.opens_at, c.locks_at,
               EXTRACT(EPOCH FROM (c.locks_at - ${t}::timestamptz))/60 AS minutes
          FROM contests c LEFT JOIN leagues l ON l.slug = c.sport
         WHERE NOT c.settled
           AND c.locks_at > ${t}::timestamptz
           AND c.locks_at <= ${t}::timestamptz + (${windowMin} || ' minutes')::interval`,
  ]);
  return [
    ...toRows(opens, 'opens'),
    ...toRows(locks.map((c) => ({ ...c, minutes: Math.max(1, Math.round(c.minutes)) })), 'locks'),
  ];
}
