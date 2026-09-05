// lib/push/copy.js - what the three notifications say. PURE, so the words are
// testable - including the house hyphen rule, which applies to a lock screen
// exactly as it applies to a mail client: an em dash pasted from a draft
// renders differently everywhere and nobody proofreads a push.
//
// SHORT IS THE SPEC. A lock screen truncates a title around 30-40 characters
// and a body around 110-150 depending on device; everything here fits the
// tightest cut, so no device ever shows half a sentence.
//
// THE URL IS WHERE THE TAP LANDS, inside the app (the shell opens it as an
// in-app navigation, not Safari).

import { DAILY_V2_PATH } from '../daily/boardShape.js';

/** eventId prefix -> the notification. Date/board suffixes carry identity. */
export const PUSH_COPY = {
  // v2 (season-roster board) copy, relay 5a/5b - WIRED (lib/daily/
  // seasonBoardTick.js calls notifyEvent directly with these prefixes).
  // url is DAILY_V2_PATH (lib/daily/boardShape.js), not a typed literal -
  // one constant for every surface that names this board (relay 5b item 7).
  'daily-live': {
    title: 'The Daily is live',
    body: 'Your board is ready. Twelve teams, eight slots, one player from each. Three minutes when you are.',
    url: DAILY_V2_PATH,
  },
  'daily-revealed': {
    title: 'The board is settled',
    body: 'Midnight. The field is in. See the best roster, the leaderboard and where you landed.',
    url: DAILY_V2_PATH,
  },
  // v1's OWN, ORIGINAL copy, restored under its own event-id namespace
  // (relay 5b item 4) - 'daily-live'/'daily-revealed' above were RETARGETED
  // to v2 wholesale, which meant v1's still-running daily-close cron
  // (app/api/cron/daily-close/route.js, calling notifyDailyLive/
  // notifyDailyRevealed) was about to send v2's copy and url to v1 players
  // the next time it fired. notifyDailyLive/notifyDailyRevealed (below in
  // this file's sibling notify.js) now build their eventId under THIS
  // prefix instead, and are killed outright from DAILY_V2_EPOCH so the two
  // systems never both push the same morning.
  'daily-v1-live': {
    title: 'The Daily is live',
    body: 'A new board just opened - 64 performances, one hidden week. Three minutes when you are.',
    url: '/daily',
  },
  'daily-v1-revealed': {
    title: 'The answer is up',
    body: 'The Daily just revealed. See the week, the perfect six and where you landed.',
    url: '/daily',
  },
  'pickem-open': {
    title: "Pick 'em is open",
    body: 'The first board is up - make your picks before kickoff.',
    // Retargeted from /games when /pickem shipped (relay 2): the tap lands
    // on the board itself, not a lobby with one more tap in it.
    url: '/pickem',
  },
  'pickem-reminder': {
    title: 'Picks lock at kickoff',
    body: 'First game is close - every pick seals when its game kicks. Call the rest now.',
    url: '/pickem',
  },
  'pickem-settled': {
    title: "Your Pick 'em result is in",
    body: 'The board settled. See your record and where you landed.',
    url: '/pickem',
  },
  // The Weekly / The Draft, relay D1. UNLIKE every entry above, these carry
  // {placeholder} tokens - open is a GLOBAL fact (the contest's own lock
  // time, same for every recipient), reminder and settled are PER-RECIPIENT
  // (n_set/seat_state/pts/pct/rank differ by who is reading), so their body
  // is rendered fresh per send via renderCopy(), never sent as one shared
  // payload the way pickem's static trio is.
  'weekly-open': {
    title: 'The Weekly is open',
    body: 'The Weekly is open. Six slots, no clock. Locks {lock_local}.',
    url: '/weekly',
  },
  'weekly-reminder': {
    title: 'One hour to lock',
    body: 'One hour to lock. {n_set} of 6 set.',
    url: '/weekly',
  },
  'weekly-settled': {
    title: 'Your Weekly result is in',
    body: 'Week {week} is graded. {pts} pts, {pct}% of the best six. {rank} of {field}.',
    url: '/weekly',
  },
  'draft-open': {
    title: 'The Draft is open',
    body: 'Rooms are open. Eight rounds, no bench. Lock {lock_local}.',
    url: '/draft',
  },
  'draft-reminder': {
    title: 'One hour to lock',
    body: 'One hour to lock. {seat_state}.',
    url: '/draft',
  },
  'draft-settled': {
    title: 'Your Draft result is in',
    body: 'Week {week} is graded. {pts} pts, {rank} of {field}.',
    url: '/draft',
  },
};

/**
 * The payload copy for an event id like 'daily-live:2026-08-19'.
 * @returns {object|null} null for an unknown prefix - the caller skips, not throws.
 */
export function copyFor(eventId) {
  const prefix = String(eventId ?? '').split(':')[0];
  return PUSH_COPY[prefix] ?? null;
}

/**
 * copyFor() PLUS {placeholder} substitution - for the entries above that
 * carry tokens.
 *
 * NO BRACE EVER LEAVES THIS FUNCTION (ruling). A missing param used to be
 * left as the literal "{key}" text - visible, but still a SEND: a real
 * push notification reading "...{room_rank} in your room..." on someone's
 * lock screen. Now a leftover brace after substitution THROWS instead, so
 * the caller must skip that send rather than deliver broken text -
 * RenderCopyError carries eventId and the missing key names so the catch
 * site can name exactly what happened in an alert.
 * @returns {object|null} {title, body, url} with every {key} replaced, or
 *   null for an unknown prefix (same refusal as copyFor).
 * @throws {RenderCopyError} if any {key} remains unfilled after substitution.
 */
export class RenderCopyError extends Error {
  constructor(eventId, missing) {
    super(`renderCopy(${eventId}): missing param(s) for ${missing.join(', ')}`);
    this.name = 'RenderCopyError';
    this.eventId = eventId;
    this.missing = missing;
  }
}

export function renderCopy(eventId, params = {}) {
  const copy = copyFor(eventId);
  if (!copy) return null;
  const fill = (s) => s.replace(/\{(\w+)\}/g, (m, key) => (params[key] != null ? String(params[key]) : m));
  const title = fill(copy.title);
  const body = fill(copy.body);
  const missing = [...new Set([...title.matchAll(/\{(\w+)\}/g), ...body.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];
  if (missing.length) throw new RenderCopyError(eventId, missing);
  return { ...copy, title, body };
}
