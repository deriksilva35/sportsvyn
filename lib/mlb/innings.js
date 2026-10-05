// lib/mlb/innings.js - innings-pitched arithmetic. PURE AND CLIENT-SAFE: it
// imports NOTHING, and must not. components/october/OctoberCard.js reaches it
// through lib/mlb/cardLines.js; when it lived in playsImport.js, that module's
// import of the stats-feed door (node:async_hooks) broke the production build
// (ruling sun-12). lib/clientGraph.test.mjs walks every client import graph.

/**
 * "6.2" FROM 20 OUTS - the inverse, and it lives in this pure module rather than
 * beside its first caller. It is pure arithmetic with no
 * DB and no fetch, which is why the card lines can import it and gameDetail.js
 * (which does open a connection) cannot be where it is defined.
 */
export function outsToInnings(outs) {
  if (outs == null || outs === '') return null;
  const n = Number(outs);
  if (!Number.isFinite(n) || n < 0) return null;
  return `${Math.floor(n / 3)}.${n % 3}`;
}
