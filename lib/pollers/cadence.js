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

// Odds poller (The Odds API) — pre-kickoff only, freeze-at-kickoff. The odds cron
// fires every ODDS_TICK_MIN. It polls BOTH gridiron sports at that cadence when
// any scheduled game kicks off within ODDS_FINAL_WINDOW_HOURS; otherwise it takes
// a single hourly baseline poll on the top-of-hour tick; otherwise noop. Credit
// cost is 3 per sport per poll (h2h,spreads,totals x us), budget headroom is huge
// (~9K/mo of a 100K plan), so the tight window is deliberately generous.
export const ODDS_TICK_MIN = 15;
export const ODDS_FINAL_WINDOW_HOURS = 6;
