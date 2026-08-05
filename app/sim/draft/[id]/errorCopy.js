// app/sim/draft/[id]/errorCopy.js — copy and routing for the draft-room error
// boundary, kept OUT of the JSX so both can be unit-tested.
//
// The back-route is the part that can actually be wrong, and it is the part that
// matters most: a recovery button that routes nowhere is a dead end wearing the
// costume of an exit. JSX cannot be rendered under node --test in this repo, so
// splitting it out is what makes it testable at all.

export const ROOM_ERROR = {
  kicker: 'Draft Room',
  // One plain sentence. No stack, no error text, no apology theatre - the reader
  // wants to know their draft is safe and how to get back to it.
  head: 'This screen stopped loading',
  body: 'Your draft is saved. Nothing you logged has been lost - reopening the room picks up exactly where you left off.',
  // Primary action: a COLD re-entry into the room. That is the same path a full
  // app relaunch takes, the one pinned by the resume tests in drafts.test.mjs,
  // and it lands on the available list rather than whichever view failed.
  back: 'Back to the draft',
  // Secondary: React's own boundary retry. Re-renders in place without a round
  // trip, which is the right first try for a transient failure.
  retry: 'Try again',
  // Last resort. A room that will not open no matter what must not trap anyone.
  lobby: 'Back to the lobby',
  lobbyHref: '/sim',
  // Shown small. A digest is a correlation id, not error text - it is what makes
  // a report actionable without putting a stack in front of a reader.
  ref: 'Reference',
};

/**
 * The room URL to re-enter, derived from the current pathname.
 *
 * Returns the LOBBY rather than guessing when the path is not a draft room: a
 * button labelled "Back to the draft" that navigates to a 404 is worse than one
 * that admits it does not know which draft you meant.
 *
 * The id must be digits. The route does Number(id), so anything else could not
 * have been a real room, and echoing an arbitrary path segment back into a
 * navigation target is how a reflected-URL bug starts.
 */
export function roomHrefFrom(pathname) {
  const m = /^\/sim\/draft\/(\d+)(?:\/|$)/.exec(String(pathname ?? ''));
  return m ? `/sim/draft/${m[1]}` : ROOM_ERROR.lobbyHref;
}
