// lib/push/transitions.js — which alerts one poll's change is worth.
// PURE: given the row before and the row after, name the events. No database,
// no clock, no network, so the whole rule set is testable without a game.

import { isCloseGame } from './prefs.js';

/**
 * @param before { status, home_score, away_score, live_state }
 * @param after  same shape, post-write
 * @returns [{ event, state }] in the order they should be sent
 */
export function transitionsFor(before, after) {
  const out = [];
  if (!after) return out;
  const b = before ?? {};
  const period = after.live_state?.period ?? null;
  const clock = after.live_state?.clock ?? null;
  // THE HALF RIDES ALONG FOR BASEBALL. It is the only part of "Bot 8th" that is
  // not the period, and without it a baseball push can only say the inning
  // number - which is half the fact, and the wrong half to be missing when the
  // home side is batting.
  const half = after.live_state?.half ?? null;
  // homeDelta/awayDelta ride along on every event (not just 'score') so a
  // caller building the score-kind prefix never has to recompute what this
  // function already knows. null before either side has a number to diff.
  const homeDelta = num(after.home_score) == null || num(b.home_score) == null
    ? null : num(after.home_score) - num(b.home_score);
  const awayDelta = num(after.away_score) == null || num(b.away_score) == null
    ? null : num(after.away_score) - num(b.away_score);
  const state = {
    homeScore: after.home_score, awayScore: after.away_score, period, clock, half,
    homeDelta, awayDelta,
  };

  // KICKOFF: the status flip, not the clock. A game that was scheduled and is
  // now live has started, whatever its clock says - and at 30s we may see it
  // first at 14:52 of the first quarter.
  if (b.status !== 'live' && after.status === 'live') out.push({ event: 'kickoff', state });

  // SCORE: compared against OUR previous row, not against the last poll of
  // this process. A restarted loop has no previous poll and must not re-emit
  // the board. Only while live: a final's points are the final's news.
  //
  // AND IT REQUIRES THE GAME TO HAVE ALREADY BEEN LIVE. On the poll that flips
  // a game live, the stored score goes from null to 0-0, which IS a change by
  // any honest comparison - so without this the reader got a kickoff alert
  // followed immediately by "NE 0, SEA 0". Two notifications for one moment,
  // and the second one is a scoreline for a game where nobody has scored.
  // A score arriving on the same poll as the kickoff IS the kickoff.
  const changed = num(b.home_score) !== num(after.home_score)
               || num(b.away_score) !== num(after.away_score);
  if (b.status === 'live' && after.status === 'live' && changed) out.push({ event: 'score', state });

  // QUARTER: the period advanced. Reported off live_state rather than a clock
  // hitting zero, because a poll every thirty seconds will usually miss 0:00
  // and would then never fire at all.
  const bp = b.live_state?.period ?? null;
  if (after.status === 'live' && bp != null && period != null && Number(period) > Number(bp)) {
    out.push({ event: 'quarter', state: { ...state, period: Number(bp) } });
  }

  // CLOSE: fires when the game ENTERS the window, and the key is the match
  // alone so it can only fire once. Keying it on the clock would send one every
  // thirty seconds for the last five minutes of every one-score game.
  //
  // AND THE SPORT RIDES ALONG, because the sentence differs: football is "Q4,
  // one score, under five minutes" and baseball is "within one run, eighth or
  // later" - see isCloseGame(). The league slug is on the row the poller
  // selected; without it every MLB game would be judged by a clock it does not
  // have and the rule could never fire at all.
  const sport = b.league_slug ?? after.league_slug ?? b.leagueSlug ?? after.leagueSlug ?? null;
  const wasClose = isCloseGame({ period: bp, clock: b.live_state?.clock,
    homeScore: b.home_score, awayScore: b.away_score, sport });
  const isClose = isCloseGame({ period, clock, homeScore: after.home_score, awayScore: after.away_score, sport });
  if (after.status === 'live' && isClose && !wasClose) out.push({ event: 'close', state });

  // FINAL last, always. If a poll sees the last score and the whistle in one
  // go, the reader should read them in that order.
  if (b.status !== 'final' && after.status === 'final') out.push({ event: 'final', state });

  return out;
}

const num = (v) => (v == null ? null : Number(v));
