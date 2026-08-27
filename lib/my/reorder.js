// lib/my/reorder.js - panel order, as pure functions.
//
// EXTRACTED SO THE TWO PATHS CAN BE PROVEN IDENTICAL. Arrows and drag must
// produce the same saved layout, and the only way to assert that is to have
// both call functions that can be tested without a pointer or a DOM.
//
// THE STORED ARRAY IS NOT THE VISIBLE ARRAY. `active` holds every panel the
// user keeps, including conditional ones and ids whose panel is absent this
// render; the customizer only shows the non-conditional present ones. Both
// operations therefore work in VISIBLE space and write back into stored space,
// which is what stops a reorder from silently dropping a hidden entry.

/** The subset the customizer actually renders, in stored order. */
export function visibleOf(active, isVisible) {
  return active.filter((p) => isVisible(p.id));
}

/**
 * The ARROW path: swap a panel with its neighbour, one step.
 * Returns the array unchanged when the move would run off either end.
 */
export function swapAdjacent(active, id, dir, isVisible) {
  const visible = visibleOf(active, isVisible);
  const pos = visible.findIndex((p) => p.id === id);
  if (pos < 0) return active;
  const target = pos + dir;
  if (target < 0 || target >= visible.length) return active;
  const a = active.indexOf(visible[pos]);
  const b = active.indexOf(visible[target]);
  const next = [...active];
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}

/**
 * The DRAG path: lift a panel out and drop it at a visible index.
 *
 * REMOVE-AND-INSERT IS EQUIVALENT TO REPEATED ADJACENT SWAPS for a single
 * moving element - dragging A from visible 0 to visible 2 lands exactly where
 * pressing its down-arrow twice lands. That equivalence is the ruling ("the two
 * paths must be indistinguishable at the save layer") and it is asserted
 * directly in the tests rather than assumed from this comment.
 */
export function moveToIndex(active, id, targetPos, isVisible) {
  const visible = visibleOf(active, isVisible);
  const from = visible.findIndex((p) => p.id === id);
  if (from < 0) return active;
  const clamped = Math.max(0, Math.min(targetPos, visible.length - 1));
  if (clamped === from) return active;

  // Reorder in visible space...
  const reordered = [...visible];
  const [lifted] = reordered.splice(from, 1);
  reordered.splice(clamped, 0, lifted);

  // ...then write back into the stored array, leaving every hidden entry in
  // the slot it already occupied. Splicing the stored array directly would
  // move hidden panels around as a side effect of moving a visible one.
  const slots = active.map((p, i) => (isVisible(p.id) ? i : null)).filter((i) => i !== null);
  const next = [...active];
  slots.forEach((slot, k) => { next[slot] = reordered[k]; });
  return next;
}
