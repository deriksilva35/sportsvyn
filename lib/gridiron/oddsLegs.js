// lib/gridiron/oddsLegs.js - when a gridiron-odds leg runs. PURE.
//
// Most legs follow the cron's own rhythm (hourly baseline, every tick inside a
// kickoff window). A leg with `hours` is on a FIXED CLOCK instead: it runs at
// the top of those UTC hours and at no other tick - MLB's postseason leg at
// 13:00Z and 21:00Z (thu-28), 2 credits a call, 4 a day.
import { ODDS_TICK_MIN } from '../pollers/cadence.js';

export const legDue = (lg, now = new Date()) => !lg?.hours
  || (now.getUTCMinutes() < ODDS_TICK_MIN && lg.hours.includes(now.getUTCHours()));
