// lib/live/vocabulary.js — provider status -> ours, for the live poller only.
// PURE. Every mapping is explicit and an unrecognised token is COUNTED, never
// coerced.
//
// WHY A SECOND MAP AND NOT lib/gridiron/ingest.js's. That one reads the BDL
// field `status`, which for a not-yet-played NFL game is the kickoff datetime
// rendered as prose ("9/13 - 1:00 PM EDT") - one distinct value per game, so it
// cannot be a table key, and ingest carries a regex to catch it. The live
// payload also carries `status_state`, a machine field, and that is what a
// poller running every thirty seconds should switch on. Measured on the real
// feed 1 Sep 2026: every scheduled Week 1 row has status_state 'scheduled'
// while `status` is the prose.
//
// THE NFL LIVE TOKENS ARE STILL UNVERIFIED AND ARE NOT GUESSED. ingest.js says
// so in its own header and the reason holds here: the first live NFL game is
// Week 1, so no in-progress spelling has ever been observed. 'in_progress' and
// 'final' are mapped below because they are the documented values; anything
// else - including a spelling we got wrong - lands in `unmapped`, writes
// nothing, and alerts. A speculative key would map silently and defeat the one
// mechanism that can teach us the truth.

// ---------------------------------------------------------------------------
// SPORT. Added for MLB, and the football path below is untouched by it.
//
// THE FORK THE RECON NAMED. shortOf() is the derivation every live surface goes
// through - the scoreboard chip, the drive strip, the line score, the Pick'em
// row, the Live Activity - and it answered in quarters. A second label function
// for baseball would have been a second vocabulary, and the two would have
// drifted the first time either changed. So shortOf LEARNS A SPORT instead, and
// every existing caller passes nothing and gets exactly what it got before.
//
// THE DEFAULT IS FOOTBALL AND THAT IS A DELIBERATE NO-OP, not a guess about
// future leagues: it is what these functions already did, so an unmapped league
// behaves today exactly as it behaved yesterday. A new sport adds an entry here
// AND a branch below; adding only the entry changes nothing, which is the safe
// direction to be wrong in.
// ---------------------------------------------------------------------------

export const FOOTBALL = 'football';
export const BASEBALL = 'baseball';
export const SOCCER = 'soccer';

export const LEAGUE_SPORT = Object.freeze({
  nfl: FOOTBALL, cfb: FOOTBALL,
  mlb: BASEBALL,
  epl: SOCCER, 'fifa-wc-2026': SOCCER, 'international-friendlies': SOCCER,
  'concacaf-gold-cup': SOCCER, 'africa-cup-of-nations': SOCCER,
});

export function sportOf(leagueSlug) {
  return LEAGUE_SPORT[String(leagueSlug ?? '').trim().toLowerCase()] ?? FOOTBALL;
}

/** 1 -> "1st", 2 -> "2nd", 3 -> "3rd", 4 -> "4th", 11 -> "11th", 21 -> "21st". */
export function ordinal(n) {
  const i = Number(n);
  if (!Number.isFinite(i) || i < 1) return null;
  // 11th, 12th and 13th are the exceptions the naive rule gets wrong, and an
  // extra-inning game reaches them.
  const teen = i % 100;
  if (teen >= 11 && teen <= 13) return `${i}th`;
  const last = i % 10;
  return `${i}${last === 1 ? 'st' : last === 2 ? 'nd' : last === 3 ? 'rd' : 'th'}`;
}

/** BDL MLB's `inning_type` -> the word a card shows. */
const HALF_WORD = Object.freeze({ top: 'Top', bottom: 'Bot', mid: 'Mid', end: 'End' });

/** BDL `status_state` -> our status. The machine field, not the prose one. */
export const BDL_STATE = Object.freeze({
  scheduled: 'scheduled',
  in_progress: 'live',
  final: 'final',
  postponed: 'postponed',
  canceled: 'cancelled',
  cancelled: 'cancelled',
});

/** CFBD /scoreboard `status` -> our status. Small and fully observed. */
export const CFBD_SCOREBOARD = Object.freeze({
  scheduled: 'scheduled',
  in_progress: 'live',
  completed: 'final',
  postponed: 'postponed',
  cancelled: 'cancelled',
  canceled: 'cancelled',
});

/**
 * Map one token. Returns null and records the token when it is not known.
 *
 * NULL IS NOT 'unknown status', IT IS 'WRITE NOTHING'. The caller must leave
 * the row exactly as it found it: a status we cannot read is not evidence that
 * the game changed, and coercing it could take a live game off the board or
 * put points on a game in a state we do not understand.
 */
export function mapLiveStatus(provider, token, unmapped) {
  const table = provider === 'bdl' ? BDL_STATE
    : provider === 'cfbd' ? CFBD_SCOREBOARD
      : null;
  if (!table) { unmapped?.push(`(no table: ${provider})`); return null; }
  if (token == null || token === '') { unmapped?.push('(empty)'); return null; }
  const key = String(token).trim().toLowerCase();
  const mapped = table[key];
  if (mapped === undefined) { unmapped?.push(String(token)); return null; }
  return mapped;
}

/**
 * The live chip: period and clock, or null.
 *
 * NULL RATHER THAN A PARTIAL. A chip reading "Q2" with no clock is not half a
 * fact, it is a claim about where in the quarter we are that we cannot support.
 * Same rule the record chip keeps: claim knowledge or say nothing.
 *
 * THIS IS THE ONE WRITER. services/live-poller/poll.mjs is the process that
 * actually wins the write race (the Vercel cron's own live-score arm yields
 * to it on every tick it holds the advisory lock) so {period, clock} - not
 * the older {short, clock} apiSportsImport.js/cfbScoreboard.js shape - is
 * what a reader sees on any row written since. shortOf() below is the one
 * translation from either shape into the display grammar; no other function
 * may parse .short or .period off a live_state object again.
 */
/**
 * BDL'S PROSE STATUS, PARSED. The game object carries no period or clock
 * field; the in-game clock is the prose `status` - every tick of the Sep 9
 * NE-SEA opener logged one of "14:55 - 1st" … "5:45 - 4th" and "halftime".
 * Parsed into the {period, clock} shape every display already reads
 * (shortOf, liveChip, periodOf). A string that does not parse returns null:
 * the caller still writes the score and the quarters, only the chip is
 * withheld. Never a throw, never a block.
 */
const ORD = { '1st': 1, '2nd': 2, '3rd': 3, '4th': 4 };
export function parseBdlProse(status) {
  const s = String(status ?? '').trim();
  if (!s) return null;
  let m = /^(\d{1,2}:\d{2})\s*-\s*(1st|2nd|3rd|4th)$/i.exec(s);
  if (m) return { period: ORD[m[2].toLowerCase()], clock: m[1] };
  m = /^(\d{1,2}:\d{2})\s*-\s*(OT|\d?OT)$/i.exec(s);
  if (m) return { period: 5, clock: m[1] };
  if (/^half(time)?$/i.test(s)) return { period: 2, clock: '0:00' };
  m = /^end\s+(?:of\s+)?(1st|2nd|3rd|4th)(?:\s+(?:quarter|qtr))?$/i.exec(s);
  if (m) return { period: ORD[m[1].toLowerCase()], clock: '0:00' };
  if (/^(OT|overtime)$/i.test(s)) return { period: 5, clock: null };
  return null;
}

export function liveState(period, clock) {
  const p = Number(period);
  if (!Number.isFinite(p) || p < 1) return null;
  const c = clock == null ? null : String(clock).trim();
  if (!c) return null;
  return { period: p, clock: c };
}

/**
 * live_state -> the 'Q1'..'Q4' / 'OT' / 'HT' short code every display
 * formatter reads, from EITHER shape a row may hold.
 *
 * TWO SHAPES, ONE OUTPUT. {short, clock} (apiSportsImport.js, and any row
 * this ingest wrote before the CFB live poller existed) is honored as
 * written - that provider hands over its own short code and there is nothing
 * to derive. {period, clock} (liveState() above, the shape actually being
 * written today) has no short code at all, so one is derived here - the SAME
 * derivation cfbScoreboard.js's toLiveState used to perform as a WRITER
 * before this became the one place readers and writers share it.
 *
 * HALFTIME IS PERIOD 2 WITH A ZEROED CLOCK, a sustained state, not an
 * instant: observed on SJSU @ USC 29 Aug holding `period=2 clock="00:00"`
 * for twelve minutes running. Emitting 'Q2' for that window matches none of
 * driveStrip.js's halftime tests, so the strip draws a snap that cannot
 * happen for the whole break - precisely what its halftime mode exists to
 * prevent. PERIOD 2 ONLY: end of regulation is period 4 with the same
 * zeroed clock and is not halftime.
 */
export function shortOf(liveState, sport = FOOTBALL) {
  if (!liveState) return null;

  // BASEBALL: the half and the inning, never a quarter and never a clock.
  // "Top 7th" / "Bot 7th" / "Mid 7th" / "End 7th". Mid and End are BDL's own
  // between-halves markers (inning_type), and they are kept rather than folded
  // into the half either side of them because "Mid 7th" is exactly the state a
  // reader wants to see when nobody is batting.
  if (sport === BASEBALL) {
    if (liveState.short) return String(liveState.short);
    const inning = ordinal(liveState.period);
    if (!inning) return null;
    const half = HALF_WORD[String(liveState.half ?? '').trim().toLowerCase()] ?? null;
    // NO HALF IS STILL AN INNING. The half is the one field the provider can
    // leave out, and "7th" alone is true where "Top 7th" would be a guess.
    return half ? `${half} ${inning}` : inning;
  }

  if (liveState.short) return String(liveState.short).toUpperCase();
  const p = Number(liveState.period);
  if (!Number.isFinite(p) || p < 1) return null;
  const c = liveState.clock == null || liveState.clock === '' ? null : String(liveState.clock);
  if (p === 2 && (c === '00:00' || c === '0:00')) return 'HT';
  return p <= 4 ? `Q${p}` : 'OT';
}

/**
 * THE FINAL CHIP, per sport. "Final", or the period when a game went past
 * regulation and that is part of the result: "F/OT" for football, "F/10" for
 * a ten-inning baseball game.
 *
 * SEPARATE FROM shortOf BECAUSE IT IS A DIFFERENT QUESTION. shortOf reads a
 * live_state and a final game has none; this reads the period the game ENDED
 * in, which a caller takes from the row rather than from the live state.
 */
export function finalShortOf(period, sport = FOOTBALL) {
  const p = Number(period);
  if (sport === BASEBALL) {
    return Number.isFinite(p) && p > 9 ? `F/${p}` : 'Final';
  }
  return Number.isFinite(p) && p > 4 ? 'F/OT' : 'Final';
}

/**
 * IS THERE A CLOCK TO SHOW? Baseball has no clock - BDL sends 0 and "0:00" on
 * every MLB row, scheduled, live and final alike - so rendering it would put a
 * stopped clock on a live game. One rule, here, rather than a `sport !==
 * 'baseball'` at each of the four places that print a clock.
 */
export function hasClock(sport = FOOTBALL) {
  return sport !== BASEBALL;
}
