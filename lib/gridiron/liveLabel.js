// lib/gridiron/liveLabel.js - "Live · Q3 7:22", in one place.
//
// PURE, AND ON ITS OWN so a module that only needs the words does not have to
// import a file full of database reads to get them. lib/gridiron/todayReads.js
// re-exports it, which is how every existing caller keeps working.

/** The live label a card shows: "Live · Q3 7:22", or plain Live, or null. */
export function liveLabelOf(status, metadata) {
  if (status !== 'live') return null;
  const live = metadata?.live_state ?? null;
  const period = live?.period ?? live?.quarter ?? null;
  const clock = live?.clock ?? null;
  return period ? `Live · Q${period}${clock ? ` ${clock}` : ''}` : 'Live';
}
