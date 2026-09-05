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
export function scoreKindLabel(delta, { priorWasTouchdown = false, teamAbbr = null } = {}) {
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
 * @returns { title, body, url, tag } or null
 */
export function pushPayload(event, {
  homeAbbr, awayAbbr, homeScore, awayScore, period, clock, network,
  leagueSlug, slug, scoreKind = null,
} = {}) {
  if (!homeAbbr || !awayAbbr || !leagueSlug || !slug) return null;
  const url = `/${leagueSlug}/game/${slug}`;
  // Both scores or neither. Number(null) is 0, so a missing score would print a
  // scoreline we invented - the same trap the Wire headline hit.
  const h = homeScore == null || homeScore === '' ? null : Number(homeScore);
  const a = awayScore == null || awayScore === '' ? null : Number(awayScore);
  const haveScore = Number.isFinite(h) && Number.isFinite(a);
  const scored = `${awayAbbr} ${a}, ${homeAbbr} ${h}`;
  // THE PREFIX ONLY EVER RIDES A REAL SCORE EVENT WITH A REAL SCORELINE -
  // never on kickoff/quarter/close/final, and never invented when the
  // scores themselves are missing.
  const line = haveScore
    ? (event === 'score' && scoreKind ? `${scoreKind} · ${scored}` : scored)
    : `${awayAbbr} at ${homeAbbr}`;

  // The state, then who is carrying it. Both are dropped whole when absent
  // rather than rendered as a placeholder.
  const state = [];
  if (event === 'kickoff') state.push('Kickoff');
  else if (event === 'final') state.push('Final');
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
