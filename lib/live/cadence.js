// lib/live/cadence.js — how often the droplet loop should look, and why.
// PURE: no clock of its own, no database, no network. `now` is an argument for
// the reason every other pure module in this tree takes one - a state machine
// that reads the machine's time can only be tested on the day it was written.

/**
 * FOUR STATES, AND THE COST OF EACH IS THE POINT.
 *
 *   live      a game is in progress            -> 30s
 *   pre-kick  within PRE_KICK_MIN of a kickoff -> 30s
 *   post      a game ended inside POST_MIN     -> 30s
 *   idle      none of the above                -> 300s
 *
 * PRE-KICK EXISTS BECAUSE THE PROVIDER FLIPS BEFORE WE DO. Our status only
 * becomes 'live' when a poll sees it, so a loop that waited for a live row
 * would not start looking until something else had already noticed - which on
 * this design is nothing. Ten minutes of 30s polling before kickoff costs 20
 * calls and is the only thing that makes the first score of a game fast.
 *
 * POST EXISTS FOR THE SAME REASON IN REVERSE. A game's last score, the final
 * flip and final_seen_at all land after the last whistle, and dropping to a
 * 5-minute cadence the instant our table says 'final' would put up to five
 * minutes between the whistle and the Wire's final event. Three minutes of
 * continued polling closes it.
 */
export const LIVE_SEC = 30;
export const IDLE_SEC = 300;
export const PRE_KICK_MIN = 10;
export const POST_MIN = 3;

const MIN = 60000;

/**
 * @param games [{ status, kickoffAt, finalSeenAt }] — this league's slate today
 * @param now   Date
 * @returns { state, sleepSec, liveCount, nextKickoffAt }
 */
export function cadence(games, now = new Date(), opts = {}) {
  const t = new Date(now).getTime();
  const preKickMin = opts.preKickMin ?? PRE_KICK_MIN;
  const postMin = opts.postMin ?? POST_MIN;
  const liveSec = opts.liveSec ?? LIVE_SEC;
  const idleSec = opts.idleSec ?? IDLE_SEC;

  let live = 0, preKick = false, post = false, nextKickoff = null;
  for (const g of games ?? []) {
    if (g?.status === 'live') { live += 1; continue; }
    const k = g?.kickoffAt ? new Date(g.kickoffAt).getTime() : NaN;
    if (g?.status === 'scheduled' && Number.isFinite(k)) {
      // The window opens PRE_KICK_MIN early and does NOT close at kickoff: a
      // game whose start slipped is still the game we are waiting for, and the
      // provider is the only thing that can tell us it began.
      if (k - t <= preKickMin * MIN) preKick = true;
      if (k > t && (nextKickoff == null || k < nextKickoff)) nextKickoff = k;
    }
    const f = g?.finalSeenAt ? new Date(g.finalSeenAt).getTime() : NaN;
    if (Number.isFinite(f) && t - f <= postMin * MIN) post = true;
  }

  // THE ORDER IS THE PRIORITY. A slate with one live game and twelve finals is
  // live; the states are not exclusive and the fastest applicable one wins.
  const state = live > 0 ? 'live' : preKick ? 'pre-kick' : post ? 'post' : 'idle';
  return {
    state,
    sleepSec: state === 'idle' ? idleSec : liveSec,
    liveCount: live,
    nextKickoffAt: nextKickoff == null ? null : new Date(nextKickoff).toISOString(),
  };
}

/**
 * How long to sleep when idle and the next kickoff is known: until the pre-kick
 * window opens, clamped so the loop still checks in.
 *
 * THE CLAMP IS NOT PARANOIA. The slate is read from our own table, which
 * another writer changes - a postponement, a corrected kickoff, a game added.
 * A loop that slept nine hours on one reading would act on a fact that stopped
 * being true eight hours ago.
 */
export function sleepUntilNext({ state, sleepSec, nextKickoffAt }, now = new Date(), maxSec = 1800) {
  if (state !== 'idle' || !nextKickoffAt) return sleepSec;
  const wake = new Date(nextKickoffAt).getTime() - PRE_KICK_MIN * MIN;
  const secs = Math.floor((wake - new Date(now).getTime()) / 1000);
  return Math.max(sleepSec, Math.min(maxSec, secs));
}
