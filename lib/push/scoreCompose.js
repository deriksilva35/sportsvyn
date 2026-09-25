// lib/push/scoreCompose.js - one team's score change -> what dispatch sends. PURE.
//
// THE LEAGUE DECIDES THE SPORT, AND THE SPORT REACHES BOTH HALVES. The poller
// used to call onScore() and scoreKindLabel() with no sport, and both default
// to football: at 17:24 PT on 24 Sep a one-run single went out as
// "TB 3, NYY 0 · TB extra point", and a six-run inning would have been HELD
// for ninety seconds as a touchdown. This is the composition the poller runs,
// lifted out of it so a test can walk it end to end.
//
// A BASEBALL SCORE NEVER READS THE FOOTBALL PLAY PARSER. Its kinds are
// touchdown, safety and field goal; the baseball witness is the scoring play's
// own text (baseballScoringText), and it only ever decides "homers".

import { sportOf, BASEBALL } from '../live/vocabulary.js';
import { onScore } from './scoreFold.js';
import { scoreKindLabel } from './payload.js';

/**
 * @param pending      this team's held score (football only), or null
 * @param leagueSlug   the match's league - 'mlb', 'nfl', ...
 * @param play         parseScoringPlay() output (football), or null
 * @param scoringPlay  the scoring play's text (baseball), or null
 * @param priorKind    this team's last sent scoreKind ("KC touchdown"), or null
 * @returns {{ pending, sends: Array<state> }} each send is dispatch's state
 */
export function composeScorePush(pending, {
  delta, teamAbbr, leagueSlug, state, play = null, scoringPlay = null, priorKind = null, now = Date.now(),
} = {}) {
  const sport = sportOf(leagueSlug);
  const baseball = sport === BASEBALL;
  const { pending: next, emit } = onScore(pending, {
    delta, state, play: baseball ? null : play, now, sport,
  });
  const priorWasTouchdown = Boolean(priorKind?.endsWith('touchdown'));
  const sends = emit.map((e) => {
    // THE PLAY WINS WHERE IT SPOKE (football); the delta keeps the floor.
    const scoreKind = !baseball && e.kind
      ? `${teamAbbr} ${e.kind}`
      : scoreKindLabel(delta, { priorWasTouchdown, teamAbbr, sport, scoringPlay: baseball ? scoringPlay : null });
    return { ...e.state, scoreKind, scorer: e.scorer ?? null, credit: e.credit ?? null };
  });
  return { pending: next, sends };
}
