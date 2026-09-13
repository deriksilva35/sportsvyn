// lib/push/scoringPlay.js - WHAT THE PLAY SAYS HAPPENED. PURE.
//
// THE POLLER HAS ONLY A DELTA. It compares the score it just wrote against the
// score it held and infers a word from the number: 6/7/8 is a touchdown, 3 a
// field goal, 2 is a safety unless this team's own last score was a touchdown.
// That is a guess with a tiebreaker, and it can never name who scored.
//
// THE PLAY IS ALREADY IN OUR DATABASE. `plays` is written live by the
// plays-live cron (lib/gridiron/playsImport.js) and carries the text, the
// type and the score AFTER the play. This module reads one of those rows and
// says what it actually was. It performs no query and touches no clock - the
// caller does the lookup, so the parsing can be tested against real strings.
//
// TWO PROVIDERS, TWO GRAMMARS, ONE COLUMN. NFL rows come from BDL and use
// lowercase-hyphen types ("passing-touchdown") with names as "T.Lawrence".
// CFB rows come from CFBD and use Title Case ("Passing Touchdown") with names
// as "#14 J.Maiava". Both are in play_type/text on the same table and nothing
// in the tree said so before this file. Every pattern below is written from
// real rows off the 2026 slate; the test file quotes them verbatim.
//
// THE TRY IS NOT A SEPARATE PLAY. In BOTH grammars the extra point or the
// two-point attempt is written INSIDE the touchdown's own text, and there is
// no standalone try row in either feed (checked: zero rows of any extra-point
// type in the NFL corpus). So a touchdown's outcome is knowable the moment its
// play lands - which is what lets the fold stop waiting. See lib/push/scoreFold.js.
//
// AND THE PLAY ROW'S SCORE ALREADY INCLUDES THE TRY. That is the other half of
// why this is worth reading: home_score/away_score on a touchdown row are the
// post-try numbers, so a caller can print the scoreline the board has not
// caught up to yet rather than printing 6 and then 7.

/** A scoring play's kind, in the words the push already uses. */
export const KINDS = Object.freeze(['touchdown', 'field goal', 'safety', 'extra point', 'two-point']);

// NFL: "T.Lawrence". CFB: "#14 J.Maiava" - the jersey is dropped, the name kept.
const NAME = "(?:#\\d+\\s+)?([A-Z][A-Za-z'\\-]*\\.[A-Za-z'\\-]+(?:\\s(?:Jr\\.|Sr\\.|II|III|IV))?)";

const TD_WORD = /TOUCHDOWN/i;
const SAFETY_WORD = /\bSAFETY\b/i;

// A field goal names its kicker first and the phrase is the same in both feeds.
const FG = new RegExp(`${NAME}\\s+\\d+\\s+yard field goal`, 'i');
const FG_CFB = new RegExp(`${NAME}\\s+field goal attempt`, 'i');

/**
 * THE TRY, AS THE TEXT STATES IT.
 * NFL  "C.Little extra point is GOOD"  /  "S.Shrader extra point is No Good"
 * CFB  "#95 T.Sterner kick attempt good"  /  "kick attempt failed"
 *      "#8 M.Carvalho rush attempt Successful"  /  "rush attempt failed"
 *      "pass attempt Successful" / "pass attempt failed"
 */
const TRY = [
  { re: /extra point is GOOD/i, kind: 'kick-good', points: 1 },
  { re: /extra point is (?:No Good|Failed|Blocked|Aborted)/i, kind: 'kick-missed', points: 0 },
  { re: /kick attempt good/i, kind: 'kick-good', points: 1 },
  { re: /kick attempt (?:failed|no good|blocked)/i, kind: 'kick-missed', points: 0 },
  { re: /(?:rush|pass) attempt Successful/i, kind: 'two-good', points: 2 },
  { re: /(?:rush|pass) attempt failed/i, kind: 'two-failed', points: 0 },
  { re: /TWO-POINT CONVERSION ATTEMPT.*ATTEMPT SUCCEEDS/i, kind: 'two-good', points: 2 },
  { re: /TWO-POINT CONVERSION ATTEMPT.*ATTEMPT FAILS/i, kind: 'two-failed', points: 0 },
];

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * THE SCORER, taken from the clause that ends in TOUCHDOWN.
 *
 * ONE RULE COVERS BOTH GRAMMARS AND EVERY SHAPE: the LAST player name before
 * the word TOUCHDOWN is the man who reached the end zone. It is the receiver
 * on a pass ("... to J.Cameron for 4 yards, TOUCHDOWN"), the carrier on a run
 * ("D.Henry right tackle for 4 yards, TOUCHDOWN"), the returner on a return,
 * and the recoverer on a strip sack ("RECOVERED by CIN-D.Knight at TB 27.
 * D.Knight for 27 yards, TOUCHDOWN") - in every one of those the passer,
 * tackler and fumbler all appear EARLIER in the sentence.
 *
 * A prefix clause cannot fool it for the same reason: "L.Borom reported in as
 * eligible.  J.Gibbs up the middle for 1 yard, TOUCHDOWN" still ends on Gibbs.
 */
export function scorerOf(text) {
  const t = clean(text);
  const at = t.search(TD_WORD);
  if (at < 0) return null;
  const before = t.slice(0, at);
  const names = [...before.matchAll(new RegExp(NAME, 'g'))].map((m) => m[1]);
  if (!names.length) return null;
  // "RECOVERED by CIN-D.Knight" glues a team code to the name with a hyphen;
  // the name pattern starts at the capital after it, so nothing to strip.
  return names[names.length - 1];
}

/**
 * Read one `plays` row.
 * @param {object} play  {play_type, text, home_score, away_score, period, clock}
 * @returns {null|{kind, scorer, tryResolved, tryKind, tryPoints, homeScore, awayScore}}
 *   null when the row is not a scoring play this module can name - and a null
 *   is a fallback, never a failure: the caller keeps the delta-derived wording.
 */
export function parseScoringPlay(play) {
  if (!play) return null;
  const text = clean(play.text);
  const type = clean(play.play_type).toLowerCase();  // only the safety check needs it
  if (!text) return null;

  const scores = {
    homeScore: play.home_score ?? null,
    awayScore: play.away_score ?? null,
  };

  // TOUCHDOWN first: it is the only kind that carries a try, and the try is
  // what the fold is waiting for.
  if (TD_WORD.test(text)) {
    const t = TRY.find((x) => x.re.test(text)) ?? null;
    return {
      kind: 'touchdown',
      scorer: scorerOf(text),
      tryResolved: Boolean(t),
      tryKind: t?.kind ?? null,
      tryPoints: t?.points ?? null,
      ...scores,
    };
  }

  // A SAFETY NAMES NO SCORER and must not borrow one. The text is about the
  // team that conceded it ("Texas A&M SAFETY"), and the two points go the
  // other way - naming anybody here would name the wrong side.
  if (SAFETY_WORD.test(text) || type === 'safety') {
    return { kind: 'safety', scorer: null, tryResolved: false, tryKind: null, tryPoints: null, ...scores };
  }

  if (/field goal/i.test(text) && !/no good|missed|blocked/i.test(text)) {
    const m = FG.exec(text) ?? FG_CFB.exec(text);
    return { kind: 'field goal', scorer: m ? m[1] : null, tryResolved: false, tryKind: null, tryPoints: null, ...scores };
  }

  return null;
}
