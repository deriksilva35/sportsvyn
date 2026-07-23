/**
 * lib/pollers/cadence.js — the one place to tune poller cadence + live-window
 * padding. Imported by the cron routes and lib/pollers/liveWindow.js.
 */

// Smart-tick cadence: the games cron fires every LIVE_INTERVAL_MIN, but only
// actually syncs a source when it's in a live window; otherwise it syncs at most
// once per BASELINE_INTERVAL_MIN.
export const LIVE_INTERVAL_MIN = 5;
export const BASELINE_INTERVAL_MIN = 30;

// Live-window padding around a scheduled kickoff. A game counts as "live" from
// LIVE_WINDOW_PRE_MIN before kickoff until LIVE_WINDOW_POST_HOURS after it. The
// POST pad must cover a whole game (~3.5h of play + stoppages + OT) so 5-min
// cadence holds through the 4th quarter and overtime, not just the opening drive.
export const LIVE_WINDOW_PRE_MIN = 45;
export const LIVE_WINDOW_POST_HOURS = 5;
