// lib/fantasy/movementGates.js - the movement board's sample gates. PURE AND
// CLIENT-SAFE: imports nothing. components/fantasy/boardCopy.js (a client
// island) reads them; importing them from movement.js dragged lib/db.js into
// the client graph (ruling sun-12, lib/clientGraph.test.mjs). The reasoning
// behind each number is in lib/fantasy/movement.js beside the code that reads it.

export const MIN_D3_HISTORY = 4;
export const MIN_D7_HISTORY = 8;
export const MIN_DRIFT_HISTORY = 8;
export const STREAK = 5;
export const SV_MIN_DRAFTS = 25;
export const BAND_MIN_DRAFTS = 50;
