// lib/mlb/playsTab.js - the pitch-by-pitch tab, shaped. PURE: no database, no
// clock, no network. The page reads `plays` rows and hands them here.
//
// WHAT THE PROVIDER'S ROWS ACTUALLY ARE, measured on 2026-09-22's MIL @ PHI -
// 527 rows for nine innings, in 24 distinct `type` values:
//
//   Start Inning / End Inning        the half's own markers (17 / 16)
//   Start Batter/Pitcher / End …     the AT-BAT's markers (70 / 70)
//   Ball, Strike Looking, Strike
//     Swinging, Foul Ball            pitches that did not end the at-bat
//   Single, Home Run, Ground Out,
//     Fly Out, Line Out, Pop Out,
//     Sacrifice Fly, Foul Out, …     THE PITCH THAT WAS PUT IN PLAY, named for
//                                    what happened - still a pitch row, with a
//                                    pitch_type and a velocity on it
//   Play Result                      the SENTENCE ("Marsh homered to right
//                                    (390 feet), Stott scored.") and the score
//                                    after it. No pitch of its own.
//   Stolen Base, Fielders
//     Indifference, … - Overturned   things that happen between pitches
//
// SO A PITCH IS A ROW WITH A pitch_type, NOT A ROW WHOSE TYPE IS "Pitch".
// There is no "Pitch" type at all: the ball-in-play row is called "Home Run".
// Keying on the type name would have dropped the one pitch in every at-bat
// that the reader most wants to see.
//
// AND AN AT-BAT IS A BRACKET, NOT A RUN OF THE SAME batter_id. Between-pitch
// events (a stolen base, an overturned call) carry batter_id null and sit in
// the middle of an at-bat; grouping by batter would split it in three.

import { newestScoringPlay } from './strip.js';

/** PURE. "Bottom 8th" from the two columns that carry it. */
export function halfLabel(inningType, period) {
  const n = Number(period);
  if (!Number.isFinite(n) || n < 1) return null;
  const t = String(inningType ?? '').trim().toLowerCase();
  const word = t.startsWith('top') ? 'Top'
    : t.startsWith('bot') ? 'Bottom'
      : t.startsWith('mid') ? 'Mid'
        : t.startsWith('end') ? 'End' : null;
  const teen = n % 100;
  const ord = teen >= 11 && teen <= 13 ? `${n}th`
    : `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] ?? 'th'}`;
  return word ? `${word} ${ord}` : ord;
}

/**
 * PURE. What one pitch did, in the words the row already uses.
 *
 * THE TYPE IS THE OUTCOME and it is the provider's own vocabulary - "Strike
 * Looking", "Foul Ball". This translates only the four that have a shorter
 * English form and passes everything else through lowercased, so a pitch type
 * nobody anticipated prints as itself rather than as nothing.
 */
export function pitchOutcome(type) {
  const t = String(type ?? '').trim();
  if (!t) return null;
  const k = t.toLowerCase();
  if (k === 'ball') return 'ball';
  if (k === 'strike looking') return 'looking strike';
  if (k === 'strike swinging') return 'swinging strike';
  if (k === 'foul ball') return 'foul';
  // Everything else IS the result of the at-bat - "Home Run", "Ground Out" -
  // and the at-bat's own line says it in full underneath. Here it is just "in
  // play", so the pitch list does not say the same thing twice.
  return 'in play';
}

/** PURE. "94 Four-seam · ball", or null when the row is not a pitch. */
export function pitchLine(row) {
  const type = row?.pitch_type ?? null;
  if (!type) return null;
  const v = row?.pitch_velocity == null ? null : Number(row.pitch_velocity);
  const speed = Number.isFinite(v) && v > 0 ? `${Math.round(v)} ` : '';
  const out = pitchOutcome(row?.play_type);
  return `${speed}${type}${out ? ` · ${out}` : ''}`;
}

const isPitch = (r) => r?.pitch_type != null;
const typeOf = (r) => String(r?.play_type ?? '').trim();

/**
 * PURE. One game's `plays` rows -> the tab.
 *
 * NEWEST HALF FIRST, and newest at-bat first inside it: a reader opening this
 * during a live game is looking for what just happened, and making them scroll
 * nine innings to find it is the whole reason a box score has a tab at all.
 *
 * THE ROWS ARRIVE IN PLAY ORDER and are reversed here rather than in SQL, so
 * the grouping reads forwards - an at-bat is opened by a Start and closed by an
 * End, which is only a bracket if you walk it in the direction it was written.
 *
 * AN UNCLOSED AT-BAT IS THE LIVE ONE and is kept: the batter at the plate has
 * no End row yet, and dropping him would blank the top of the tab on exactly
 * the game somebody is watching.
 *
 * @param rows   plays rows for one match, ASCENDING by play_number
 * @param names  Map(provider batter id -> display name)
 * @returns [{ key, label, period, half, atBats: [...] }] newest half first
 */
export function playsTab(rows = [], names = new Map()) {
  const halves = [];
  let half = null;
  let ab = null;

  const openHalf = (r) => {
    const key = `${r.period}:${String(r.inning_type ?? '')}`;
    if (half && half.key === key) return;
    half = {
      key, period: Number(r.period), half: r.inning_type ?? null,
      label: halfLabel(r.inning_type, r.period), atBats: [],
    };
    halves.push(half);
  };
  const closeAtBat = () => { ab = null; };

  for (const r of rows ?? []) {
    if (r?.period == null) continue;
    openHalf(r);
    const t = typeOf(r);

    if (t === 'Start Batter/Pitcher') {
      ab = {
        key: String(r.provider_play_id ?? r.play_number ?? halves.length),
        batter: names.get(String(r.batter_id)) ?? null,
        batterId: r.batter_id ?? null,
        result: null, scoring: false, score: null, pitches: [],
        // THE LAST PLAY THIS BLOCK CONTAINS, which is what "newest" means: an
        // at-bat that opened before a stolen base ENDED after it, and ordering
        // by the opening row put the steal above the home run it interrupted.
        lastAt: Number(r.play_number) || 0,
      };
      half.atBats.push(ab);
      continue;
    }
    if (t === 'End Batter/Pitcher') {
      if (ab) ab.lastAt = Math.max(ab.lastAt ?? 0, Number(r.play_number) || 0);
      closeAtBat(); continue;
    }
    if (t === 'Start Inning' || t === 'End Inning') { closeAtBat(); continue; }

    // A BETWEEN-PITCH EVENT IS ITS OWN LINE, open at-bat or not. A stolen base,
    // a fielder's indifference, an overturned call: it carries TEXT and NO
    // PITCH, and it happens in the middle of somebody's at-bat as often as
    // between two. Folding it into the at-bat's result - which is what happened
    // first - made Marsh's home run read "Stott stole second." for as long as
    // the provider took to write the sentence, and lost the steal entirely
    // once it did.
    if (!isPitch(r) && t !== 'Play Result' && r.text) {
      half.atBats.push({
        key: String(r.provider_play_id ?? r.play_number),
        batter: null, batterId: null, result: r.text,
        scoring: r.scoring === true, score: r.scoring === true ? scoreOf(r) : null,
        pitches: [], aside: true, lastAt: Number(r.play_number) || 0,
      });
      continue;
    }

    // A PLAY RESULT WITH NO OPEN AT-BAT belongs to the half rather than to the
    // batter before it.
    if (!ab) {
      if (r.text) {
        half.atBats.push({
          key: String(r.provider_play_id ?? r.play_number),
          batter: null, batterId: null, result: r.text,
          scoring: r.scoring === true, score: scoreOf(r), pitches: [], aside: true,
          lastAt: Number(r.play_number) || 0,
        });
      }
      continue;
    }

    ab.lastAt = Math.max(ab.lastAt ?? 0, Number(r.play_number) || 0);
    // A RESULT ROW CARRIES NO PITCH. Today's feed never attaches one, but a feed
    // that started to would put "Pitch 3 : Ball 2" where the sentence goes - on
    // this tab and on a lock screen. Such a row is a PITCH and falls through to
    // be recorded as one.
    if (t === 'Play Result' && !isPitch(r)) {
      ab.result = r.text ?? ab.result;
      ab.scoring = ab.scoring || r.scoring === true;
      // THE SCORE AFTER, and only on a row that scored. Every row carries a
      // home_score and an away_score; printing them on an out would put a
      // scoreline beside a groundout and say nothing.
      if (r.scoring === true) ab.score = scoreOf(r);
      continue;
    }

    const line = pitchLine(r);
    if (line) {
      ab.pitches.push({ key: String(r.provider_play_id ?? r.play_number), n: ab.pitches.length + 1, line });
      // THE BALL IN PLAY IS NAMED BY ITS OWN ROW when no Play Result follows -
      // a fielder's choice the provider did not write a sentence for still has
      // an outcome, and "Ground Out" beats a blank.
      // AND 'Play Result' IS A TYPE NAME, NOT AN OUTCOME. Without this exclusion
      // a result row that carried a pitch - handled above as the pitch it is -
      // would leave the at-bat's result reading the literal words "Play Result".
      if (!ab.result && t && t !== 'Play Result' && pitchOutcome(t) === 'in play') ab.result = t;
    }
  }

  // NEWEST FIRST, both levels, and an EMPTY HALF IS DROPPED - a "Start Inning"
  // arriving one poll before its first pitch would otherwise head the tab with
  // a heading and nothing under it.
  return halves
    .filter((h) => h.atBats.length)
    .map((h) => ({
      ...h,
      // NEWEST BY WHEN IT FINISHED, not by when it started - see lastAt.
      atBats: [...h.atBats].sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0)),
    }))
    .reverse();
}

function scoreOf(r) {
  const a = r?.away_score == null ? null : Number(r.away_score);
  const h = r?.home_score == null ? null : Number(r.home_score);
  return Number.isFinite(a) && Number.isFinite(h) ? { away: a, home: h } : null;
}

/**
 * PURE. THE CARD'S "last play" FOR BASEBALL: the newest COMPLETED AT-BAT.
 *
 * NEVER A PITCH ROW. A lock screen that says "Pitch 3 : Ball 1" has spent its
 * one line on nothing - and it is the easy mistake, because the newest row in
 * this table is almost always a pitch. The rule is a row with a RESULT TYPE and
 * NO pitch_type: in this feed that is the "Play Result" row, the one carrying
 * the sentence. Every named-outcome row ("Home Run", "Single") has a pitch_type
 * on it, because it IS the pitch that was put in play, and is excluded by the
 * same test that excludes a ball.
 *
 * AND NOT A BETWEEN-PITCH EVENT EITHER. A stolen base or a pitching change has
 * text and no pitch either; they are lines of the half (playsTab shows them) and
 * not the at-bat a reader is being told about.
 *
 * THE NEWEST SCORING PLAY WINS WHEN IT IS THAT AT-BAT. The two sources agree
 * about what happened and metadata.scoring_plays carries the curated sentence -
 * so when the newest completed at-bat is the scoring one, its text is preferred.
 * When the newest at-bat is an out, the out is the news: a card that kept
 * showing a home run three innings old would be describing a game that has
 * moved on, which is what reading scoring plays ALONE did.
 *
 * @param playRows     plays rows for the match, any order
 * @param scoringPlays metadata.scoring_plays, newest-wins via newestScoringPlay
 */
export function baseballLastPlay(playRows = [], scoringPlays = []) {
  // IT WALKS THE SAME BRACKETS THE TAB DRAWS, rather than scanning for a row
  // type. Measured against PROD: "Play Result" is NOT only an at-bat result -
  // the feed uses it for substitution announcements too ("Taylor hit for
  // Harris", the newest row in SD @ LAD's 8th), and a card reporting a pinch
  // hitter as the last play is reporting a roster move as news.
  //
  // A COMPLETED AT-BAT IS: inside a Start/End bracket, carrying a RESULT, with
  // AT LEAST ONE PITCH thrown in it. The pitches are the evidence that somebody
  // batted - a substitution has none, a stolen base has none - and the bracket
  // is what keeps the result attached to the right man.
  //
  // playsTab returns halves newest first with at-bats newest first inside them,
  // so the FIRST match walking in order is the newest completed at-bat.
  // ASCENDING, BECAUSE THE BRACKETS ONLY READ FORWARDS. playsTab's contract is
  // play order and the poller's own query is DESC (newest 400 rows), so sorting
  // here is not defensive noise - it is the difference between a card with a
  // last play and a card with an empty line. Caught by the test that feeds the
  // same rows reversed.
  const ordered = [...(playRows ?? [])]
    .sort((a, b) => (Number(a?.play_number) || 0) - (Number(b?.play_number) || 0));
  for (const half of playsTab(ordered)) {
    for (const ab of half.atBats) {
      if (ab.aside) continue;                    // an event, not an at-bat
      if (!ab.result) continue;                  // still batting
      if (!ab.pitches.length) continue;          // nobody swung: not an at-bat
      // THE CURATED SENTENCE WINS WHEN THIS AT-BAT SCORED. Both sources agree
      // about what happened and metadata.scoring_plays carries the fuller one.
      if (ab.scoring) {
        const curated = newestScoringPlay(scoringPlays)?.text ?? null;
        if (curated) return str(curated);
      }
      return str(ab.result);
    }
  }
  // NO COMPLETED AT-BAT IS A REAL STATE - a game whose import has not landed, or
  // one played before the importer existed - and the scoring summary is the best
  // thing left rather than an empty card.
  return str(newestScoringPlay(scoringPlays)?.text ?? '');
}

const str = (v) => (v == null ? '' : String(v).trim());
