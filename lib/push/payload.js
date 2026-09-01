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
 * @returns { title, body, url, tag } or null
 */
export function pushPayload(event, {
  homeAbbr, awayAbbr, homeScore, awayScore, period, clock, network,
  leagueSlug, slug,
} = {}) {
  if (!homeAbbr || !awayAbbr || !leagueSlug || !slug) return null;
  const url = `/${leagueSlug}/game/${slug}`;
  // Both scores or neither. Number(null) is 0, so a missing score would print a
  // scoreline we invented - the same trap the Wire headline hit.
  const h = homeScore == null || homeScore === '' ? null : Number(homeScore);
  const a = awayScore == null || awayScore === '' ? null : Number(awayScore);
  const haveScore = Number.isFinite(h) && Number.isFinite(a);
  const line = haveScore ? `${awayAbbr} ${a}, ${homeAbbr} ${h}` : `${awayAbbr} at ${homeAbbr}`;

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
