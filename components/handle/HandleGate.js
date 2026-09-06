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

/**
 * @param {boolean} initialHasHandle  server-known, from users.handle
 * @returns {{guard: (run: Function) => any, modal: JSX|null, hasHandle: boolean}}
 */
export function useHandleGate(initialHasHandle) {
  const [hasHandle, setHasHandle] = useState(Boolean(initialHasHandle));
  const [open, setOpen] = useState(false);
  // A REF, NOT STATE: stashing the thunk in state would re-render on every
  // guarded tap, and the thunk is not something the UI renders from.
  const pending = useRef(null);

  const guard = useCallback((run) => {
    if (hasHandle) return run();
    pending.current = run;
    setOpen(true);
    return undefined;
  }, [hasHandle]);

  const onClaimed = useCallback(() => {
    setHasHandle(true);
    setOpen(false);
    const run = pending.current;
    pending.current = null;
    // Resume the interrupted write. Caught: a failure here is the write's
    // own to report through its own error state, never the modal's.
    if (run) Promise.resolve(run()).catch(() => {});
  }, []);

  const onCancel = useCallback(() => {
    pending.current = null;   // dropped, so nothing is saved
    setOpen(false);
  }, []);

  const modal = open
    ? <HandleGateModal onClaimed={onClaimed} onCancel={onCancel} />
    : null;

  return { guard, modal, hasHandle };
}

/**
 * The modal itself. Dismissible, unlike the old step 1 - the reader is
 * mid-action on a board they can see, so trapping them here would be a
 * worse wall than the one this replaces.
 */
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
          Not now leaves this entry unsaved. Nothing else on the board changes.
        </p>
      </div>
    </div>
  );
}
