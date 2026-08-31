// lib/wire/hash.js — the dedupe key, and the whole reason four emitters need
// no history table.
//
// A KEY IS A CLAIM ABOUT WHAT MAKES TWO OBSERVATIONS THE SAME EVENT. Get it
// too specific and the wire repeats itself every tick; too general and a real
// second event is swallowed. Each emitter states its own key in its own file
// and pins it by test, because the right answer differs per lane: a line move
// is the same event for an hour, a final happens once ever, a milestone is one
// per player per game.
//
// PLAIN TEXT, NOT A DIGEST. `line:20744:spread:2026-08-31T05` is legible in a
// query, which matters when somebody is asking why the wire said something
// twice. A hash would save bytes and cost every future debugging session.

export function wireKey(...parts) {
  return parts
    .filter((p) => p !== null && p !== undefined && p !== '')
    .map((p) => String(p).replace(/\s+/g, '-').toLowerCase())
    .join(':');
}

/** The hour bucket an event belongs to, UTC. Used by keys that should fire
 *  at most once an hour no matter how often the cron looks. */
export function hourBucket(when = new Date()) {
  return new Date(when).toISOString().slice(0, 13);
}
