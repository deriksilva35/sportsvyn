// lib/fantasy/boardFit.js - A BOARD NAME NEVER BREAKS MID-WORD (thu-31).
//
// The phone board is twelve ~26px columns. The name gets two lines, breaks
// only BETWEEN words (CSS: word-break normal, overflow-wrap normal, hyphens
// none), and a name whose longest word is wider than its cell drops ONE font
// step (data-fit="sm", sim.css). A word that is still too wide after that step
// is ellipsized by the cell - never cut in two. "Etienne" fits at the small
// step; "Etie / nne" was the defect.
//
// MEASURED, NOT COUNTED. A character budget would be right for exactly one
// viewport; the cell is minmax(0, 1fr) of whatever the screen is, and the
// desktop BOARD view is four times wider. So the room measures each name after
// layout and on every resize - this is the decision, kept pure for the test.

export const FIT_SMALL = 'sm';

/**
 * Decide the step for each name element. Each element is reset to the base
 * size first and measured there, so a cell that grew (rotation, the desktop
 * view) returns to the full size rather than keeping a stale shrink.
 *
 * @param {Iterable<{dataset: object, scrollWidth: number, clientWidth: number}>} els
 * @returns {number} how many names took the small step
 */
export function fitBoardNames(els) {
  let small = 0;
  for (const el of els) {
    delete el.dataset.fit;
    if (el.scrollWidth > el.clientWidth + 0.5) { el.dataset.fit = FIT_SMALL; small += 1; }
  }
  return small;
}
