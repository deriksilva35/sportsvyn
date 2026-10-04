// lib/time/standaloneLabel.js - kept as a name, no longer as a formatter.
//
// The time string moved into lib/time/display.js (sun-16 item B), the ONE
// module every displayed clock time goes through. This re-export keeps the
// existing importers - and the tz contract they rely on, which display.js
// states in full - exactly as they were.

export { timeLabel as standaloneTimeLabel } from './display.js';
