'use client';

/**
 * components/handle/HandleGate.js - the handle is asked for at the FIRST
 * WRITE TO A RANKED CONTEST, and nowhere else.
 *
 * WHY THE MOMENT MOVED. The sheet used to fire on page load, off
 * `handle IS NULL`, mounted on /sim and /join. That asks a stranger to name
 * themselves before they have done anything - the worst possible trade,
 * because the handle's entire value ("this is your leaderboard name") is
 * invisible until there is something of theirs to put on a leaderboard.
 * Asking at the first ranked entry inverts it: by then they have chosen a
 * lineup, taken a seat, called a game or locked a board, and the sentence
 * "this name goes on the board next to that" is about a thing that now
 * exists.
 *
 * THE FOUR MOMENTS, and they are all first-WRITE, never first-view:
 *   the first Weekly slot saved      components/weekly/WeeklyRoom.js
 *   the first Draft seat taken       components/draft/SeatSelect.js
 *   the first Pick'em pick           components/pickem/PickemBoard.js
 *   the first Daily commit           components/daily/DailyRoom.js
 *
 * THE INTERRUPTED WRITE IS RESUMED, NOT DROPPED. guard() stashes the exact
 * thunk it intercepted and runs it after a successful claim, so the tap that
 * triggered the modal does the thing the reader meant. That is the whole
 * contract: they tapped to save a slot, and a slot gets saved.
 *
 * CANCEL SAVES NOTHING AND KEEPS THE BOARD. The stashed thunk is dropped, no
 * request is made, and the surface is exactly as they left it - so declining
 * costs them their pick but not their work, and they can tap again. It is a
 * gate on the write, not a wall in front of the page: nothing they have
 * already saved is touched, and every other route stays open.
 *
 * ONE FIELD, ONE ACTION. It reuses components/daily/HandleClaim.js verbatim,
 * which already carries live availability, local-then-server validation, the
 * denylist and the 23505 race - so there is exactly one claim path in the
 * app (app/actions/handle.js) and this adds no second definition of what a
 * handle is.
 */

import { useCallback, useRef, useState } from 'react';
import HandleClaim from '@/components/daily/HandleClaim';
import '@/components/onboarding/onboarding.css';

/** guard() returns this when the write was HELD behind the modal. */
export const HELD = Symbol('handle-gate:held');

/**
 * @param {boolean} initialHasHandle  server-known, from users.handle
 * @returns {{guard: (run: Function, key?: any) => any, modal: JSX|null, hasHandle: boolean, pending: Set<any>, reopen: Function}}
 */
export function useHandleGate(initialHasHandle) {
  const [hasHandle, setHasHandle] = useState(Boolean(initialHasHandle));
  const [open, setOpen] = useState(false);
  // THE STASH IS A LIST, AND "NOT NOW" DOES NOT EMPTY IT (FRESH-USER FIXES,
  // D3). It used to hold one thunk and drop it on cancel, so a reader who
  // tapped a side, saw the modal, and tapped Not now lost the pick with no
  // sign anything happened - the board looked untouched. Now every write
  // made without a handle is kept, in order, keyed by the row or slot it
  // touches; the caller paints those keys as pending ("Needs a handle"),
  // the next write or a tap on a pending row re-opens the modal, and a
  // successful claim replays the whole list in order.
  //
  // A REF for the thunks (the UI never renders from them) and STATE for the
  // keys (the UI paints from those).
  const stash = useRef([]);
  const [pendingKeys, setPendingKeys] = useState(() => new Set());

  const guard = useCallback((run, key = null) => {
    if (hasHandle) return run();
    stash.current.push({ key, run });
    if (key != null) setPendingKeys((s) => new Set([...s, key]));
    setOpen(true);
    return HELD;
  }, [hasHandle]);

  const onClaimed = useCallback(() => {
    setHasHandle(true);
    setOpen(false);
    const runs = stash.current;
    stash.current = [];
    setPendingKeys(new Set());
    // Replay IN ORDER, one after the other: a second pick on the same game
    // must land after the first, a lineup write after the lineup before it.
    // Caught per write: a failure is the write's own to report through its
    // own error state, never the modal's.
    (async () => {
      for (const { run } of runs) {
        try { await run(); } catch { /* reported by the caller */ }
      }
    })();
  }, []);

  const onCancel = useCallback(() => {
    setOpen(false);           // the stash stays - nothing is dropped
  }, []);

  const reopen = useCallback(() => { if (!hasHandle) setOpen(true); }, [hasHandle]);

  const modal = open
    ? <HandleGateModal onClaimed={onClaimed} onCancel={onCancel} />
    : null;

  return { guard, modal, hasHandle, pending: pendingKeys, reopen };
}

export function HandleGateModal({ onClaimed, onCancel }) {
  return (
    <div
      className="onb-scrim"
      role="dialog"
      aria-modal="true"
      aria-label="Pick your handle"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="onb">
        <div className="onb-kicker">One thing first</div>
        <h2 className="onb-h">Pick your handle</h2>
        <p className="onb-lede">
          This is your leaderboard name. It goes next to this entry on every
          board it appears on. Three to fifteen characters, letters, numbers
          and underscores.
        </p>
        <HandleClaim onDone={onClaimed} />
        <button type="button" className="onb-btn" style={{ marginTop: 10 }} onClick={onCancel}>
          Not now
        </button>
        <p className="onb-note">
          Not now keeps your pick on the board, marked until you claim a handle.
        </p>
      </div>
    </div>
  );
}
