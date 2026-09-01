// lib/live/handshake.js — who owns live scoring right now, the droplet or the
// Vercel tick.
//
// THE PROBLEM. Both want to write the same four columns on the same rows. They
// cannot both run: two writers at different cadences produce a score that goes
// forwards on one tick and backwards on the next, and the slower one wins half
// the races by arriving last.
//
// THE HANDSHAKE. The droplet takes a per-league advisory lock for as long as it
// is polling a live window and releases it when the window closes. The Vercel
// tick's live-score arm tries the same lock; if it cannot get it, the droplet
// has it, and the tick SKIPS that arm - it does not fail, it does not retry, it
// records that it yielded.
//
// YIELDED IS NOT A FAILURE, AND THE DIFFERENCE IS THE WHOLE POINT OF THE
// LEDGER. A tick that yields did exactly the right thing; ledgering it as a
// failure would train the alert to fire every Saturday, and an alert that fires
// every Saturday is one nobody reads. It gets its own decision string.
//
// WHAT THE TICK STILL DOES WHILE YIELDING. Everything else: the schedule
// baseline, broadcasts, the stuck-live sweep. Only the live-score arm yields,
// because only the live-score arm collides. plays-live and cfb-player-stats
// take different locks and are untouched.

export const LIVE_LOCK = (league) => `live-scores-${league}`;
export const YIELDED = 'yielded-to-droplet';
