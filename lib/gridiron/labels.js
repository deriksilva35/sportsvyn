/**
 * lib/gridiron/labels.js - the small naming rules the gridiron surfaces share.
 *
 * Pure and dependency-free on purpose: the scorecard is a client component and
 * the game page is a server one, so anything both of them need cannot live in a
 * module that touches the database.
 */

/**
 * The provider's round label, but only when it SAYS something.
 *
 * Every card and every game foot already prints the phase and the week ("PRE
 * W1"), so a label of "Week 1" repeats it in longer words. "Hall of Fame
 * Weekend" does not, and that is the whole distinction.
 */
export function distinctLabel(weekLabel) {
  if (!weekLabel) return null;
  return /^week\s+\d+$/i.test(String(weekLabel).trim()) ? null : weekLabel;
}
