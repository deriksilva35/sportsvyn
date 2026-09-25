import { resolveAbbr } from '../live/teamAbbr.js';
import { BASEBALL, sportOf, ordinal } from '../live/vocabulary.js';
import { pushWarn } from './warn.js';

// lib/push/payload.js — what the notification says. PURE.
//
// THE SCORE IS THE TITLE. A phone shows the title in bold and truncates the
// body, so the line that has to survive being glanced at on a lock screen is
// the one with the numbers in it. "Sportsvyn" as a title would spend that
// space on something the reader already knows.
//
// NO DIGESTS. One event, one notification. A batched "3 updates" makes the
// reader open the app to find out what happened, which is the opposite of the
// point.

const NBSP_FREE = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * THE SCORE-KIND PREFIX NAMES THE TEAM WHOSE SCORE MOVED - "SYR touchdown",
 * never a bare "Touchdown" that leaves the reader to work out which side.
 * The kind itself comes from the delta alone (plus one flag). 6/7/8 is a
 * touchdown (0/1/2-point conversion already folded into the same tick's
 * delta); 3 is a field goal; 1 is an extra point (the kick landing as its
 * own delta when the board updates across two polls). 2 IS AMBIGUOUS ON
 * THE NUMBER ALONE - a two-point conversion (this team's own touchdown
 * answer) and a safety (conceded to the OTHER team's defense) are both
 * worth 2, so the caller names which one it is via priorWasTouchdown -
 * true only when THIS SAME team's own last scoring play was itself a
 * touchdown. Anything else (0, 4, 5, 9+, or two teams scoring in the same
 * poll) gets no prefix - no name beats a guess.
 *
 * teamAbbr is the team whose score just moved (the caller already knows
 * this - it is the same team priorWasTouchdown is asking about). Without
 * it (a caller testing the kind alone) this returns the bare lowercase
 * word instead of "TEAM word".
 */
export function scoreKindLabel(delta, {
  priorWasTouchdown = false, teamAbbr = null, sport = 'football', scoringPlay = null,
} = {}) {
  // BASEBALL COUNTS RUNS, and every football word below is reachable from a
  // baseball delta: 3 would say "field goal", 1 "extra point", 2 "safety", and
  // 6/7/8 "touchdown". A 7-run inning in a playoff game is not hypothetical.
  if (String(sport) === 'baseball') {
    const n = Number(delta);
    if (!Number.isFinite(n) || n <= 0) return null;
    // "HOMERS" ONLY WHEN THE PLAY SAYS SO. A 4-run change is usually a grand
    // slam and sometimes four singles; the delta cannot tell them apart and
    // will not be asked to. The scoring play's own text is the only witness.
    // ONE RUN "SCORES" - "TB 3, NYY 0 · TB scores" - and more than one is
    // counted, "TB 4 runs".
    const word = /\bhomer|\bhome run\b/i.test(String(scoringPlay ?? ''))
      ? 'homers'
      : n === 1 ? 'scores' : `${n} runs`;
    return teamAbbr ? `${teamAbbr} ${word}` : word;
  }
  // A real score only ever increases. A non-positive delta names nothing -
  // no prefix beats a guess about a correction this function was never
  // told the shape of.
  const d = Number(delta);
  if (!Number.isFinite(d) || d <= 0) return null;
  let word = null;
  if (d === 6 || d === 7 || d === 8) word = 'touchdown';
  else if (d === 3) word = 'field goal';
  else if (d === 1) word = 'extra point';
  else if (d === 2) word = priorWasTouchdown ? 'two-point' : 'safety';
  if (!word) return null;
  return teamAbbr ? `${teamAbbr} ${word}` : word;
}

/**
 * PURE. "Bot 8th" - the half and the inning, in the four characters a lock
 * screen can spare.
 *
 * THE FULL WORDS ARE THE SCOREBOARD'S ("Bottom 8th"); a notification body
 * already carries a scoreline and a credit in front of this, so the half is
 * abbreviated here and nowhere else. Mid and End are between-halves states and
 * say so rather than picking a side.
 */
export function halfShort(half, period) {
  const inning = ordinal(period);
  if (!inning) return null;
  const raw = String(half ?? '').trim().toLowerCase();
  const word = raw.startsWith('top') ? 'Top'
    : raw.startsWith('bot') ? 'Bot'
      : raw.startsWith('mid') ? 'Mid'
        : raw.startsWith('end') ? 'End' : null;
  return word ? `${word} ${inning}` : inning;
}

/**
 * @returns { title, body, url, tag } or null
 */
export function pushPayload(event, {
  homeAbbr, awayAbbr, homeScore, awayScore, period, clock, half = null, network,
  leagueSlug, slug, scoreKind = null, scorer = null, credit = null,
  home = null, away = null, matchId = null,
} = {}) {
  // A MISSING ABBREVIATION FALLS BACK, IT DOES NOT REFUSE (defect 1).
  // This guard, plus scoreHeadline's identical one, is what made a match
  // with a null abbr silently undeliverable - no push, no error, no row.
  const A = resolveAbbr({ abbreviation: awayAbbr, ...(away ?? {}) });
  const H = resolveAbbr({ abbreviation: homeAbbr, ...(home ?? {}) });
  if (A.source !== 'abbreviation' || H.source !== 'abbreviation') {
    pushWarn('abbrFallback', { matchId, event, detail: `away=${A.source} home=${H.source}` });
  }
  if (!A.value || !H.value || !leagueSlug || !slug) {
    // EVERY REFUSAL NAMES ITSELF NOW (defect 3) - which of the four was
    // missing, on which match, for which event.
    const missing = [
      !A.value ? 'awayAbbr' : null, !H.value ? 'homeAbbr' : null,
      !leagueSlug ? 'leagueSlug' : null, !slug ? 'slug' : null,
    ].filter(Boolean).join(',');
    pushWarn('payloadNull', { matchId, event, detail: `missing ${missing}` });
    return null;
  }
  awayAbbr = A.value;
  homeAbbr = H.value;
  const url = `/${leagueSlug}/game/${slug}`;
  // Both scores or neither. Number(null) is 0, so a missing score would print a
  // scoreline we invented - the same trap the Wire headline hit.
  const h = homeScore == null || homeScore === '' ? null : Number(homeScore);
  const a = awayScore == null || awayScore === '' ? null : Number(awayScore);
  const haveScore = Number.isFinite(h) && Number.isFinite(a);
  const scored = `${awayAbbr} ${a}, ${homeAbbr} ${h}`;

  // SCORE FIRST, EVENT SECOND, ON ONE LINE (ruling R3). The numbers are what
  // survives a glance at a lock screen, so they lead; the word that says WHY
  // the numbers moved follows them on the same line rather than sitting in a
  // body the phone may truncate.
  //
  //   score     "SF 14, KC 21 · KC touchdown, D.Henry"
  //   kickoff   "SF 0, KC 0 · Kickoff"
  //   quarter   "SF 14, KC 21"          (title unchanged - the state is in the
  //   close     "SF 20, KC 21"           body, where it has always been, and
  //   final     "SF 20, KC 24"           the shape is already score-first)
  //
  // THE SUFFIX ONLY EVER RIDES A REAL SCORELINE. With no scores there is no
  // line to append to, and the fallback names the fixture instead.
  //
  // THE TITLE CARRIES THE SCORE AND THE KIND, AND NOTHING ELSE. The credit
  // moved to the body on 15 Sep: a lock screen truncates a title around 30-40
  // characters and "DEN 7, KC 14 · KC touchdown, P.Mahomes to R.Rice" is 48,
  // so the names were the half getting cut - and they are the half that is
  // news. `scorer` is still accepted as the fallback credit, because one name
  // is a perfectly good credit.
  const credited = credit ?? scorer ?? null;
  let suffix = null;
  if (event === 'kickoff') suffix = 'Kickoff';
  else if (event === 'score' && scoreKind) suffix = scoreKind;
  const line = haveScore
    ? (suffix ? `${scored} · ${suffix}` : scored)
    : `${awayAbbr} at ${homeAbbr}`;

  // The state, then who is carrying it. Both are dropped whole when absent
  // rather than rendered as a placeholder. KICKOFF NO LONGER APPEARS HERE -
  // it moved into the title above, and saying it twice would spend the body
  // on a word the reader has already read.
  const state = [];
  // WHO DID IT LEADS THE BODY: "P.Mahomes to R.Rice · Q2 1:39 · ABC". The
  // names first, because the clock and the network are context for them.
  // Absent when the play could not be read, or when it names nobody - a
  // safety's text is about the team that CONCEDED it and the points go the
  // other way, so there is deliberately no name to print.
  if (event === 'score' && credited) state.push(credited);
  // KICKOFF NORMALLY LIVES IN THE TITLE NOW - but a match with no scoreline
  // has no title to append it to (the fallback names the fixture instead), and
  // dropping the word entirely would leave a notification that says only "NE
  // at SEA". So it falls back to where it has always been.
  if (event === 'kickoff' && !haveScore) state.push('Kickoff');
  else if (event === 'final') state.push('Final');
  // BASEBALL SAYS WHERE IT IS IN ITS OWN WORDS. Every branch below this one is
  // a football sentence - "Q4 1:39", "End of Q3", "One score, under five
  // minutes" - and a sport with no clock and no quarters cannot borrow any of
  // them. "Bot 8th" is what a baseball scoreboard says, and it is the state the
  // close rule fires on too.
  else if (sportOf(leagueSlug) === BASEBALL) {
    if (event === 'close') state.push('Within one run, 8th or later');
    else if (event === 'quarter' && period) state.push(`End of the ${ordinal(period) ?? period}`);
    else if (period) state.push(halfShort(half, period));
  }
  else if (event === 'close') state.push('One score, under five minutes');
  else if (period && clock) state.push(`Q${period} ${clock}`);
  else if (event === 'quarter' && period) state.push(`End of Q${period}`);
  if (network) state.push(network);

  return {
    title: NBSP_FREE(line),
    body: NBSP_FREE(state.join(' · ')) || null,
    url,
    // ONE NOTIFICATION PER GAME ON THE SHADE, replaced rather than stacked.
    // Twelve score alerts for one game is a notification centre nobody reads;
    // the tag makes the newest replace the last, which is what a scoreboard is.
    tag: `sv-game-${slug}`,
  };
}
