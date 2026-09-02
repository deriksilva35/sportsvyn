'use client';

// app/sim/draft/[id]/error.js — the draft room's error boundary.
//
// WHY HERE AND NOT HIGHER. This is the tightest segment that covers BOTH rooms:
// the live tracker room, the live sim room, the results views and the abandoned
// view all render from app/sim/draft/[id]/page.js. Mounting at /sim instead
// would have pulled the lobby, /sim/tracker and /sim/account inside the same
// blast radius for no benefit.
//
// WHAT IS INSIDE THE BOUNDARY
//   · app/sim/draft/[id]/page.js and everything it renders - both rooms,
//     DraftResults, TrackerResults, and the ShellPersist instance the page
//     mounts. If the page throws, that ShellPersist never mounts, so the shell
//     cookie is not refreshed and the pageshow reload is not attached ON THIS
//     SCREEN. That is deliberate and not worth fixing here: the cookie is a
//     session cookie already written by any earlier /sim load, and this screen
//     offers an EXPLICIT retry, which is a better recovery than waiting for a
//     BFCache event. Re-mounting ShellPersist here would mean writing the shell
//     cookie with no server-side shell detection, which would make a plain web
//     browser render chromeless from then on - a worse bug than the one it
//     would paper over.
//
// WHAT IS OUTSIDE THE BOUNDARY
//   · IapConfigure - never mounted in the draft room at all (it lives on /sim,
//     /sim/account and /sim/tracker), so the RevenueCat configure path cannot
//     be taken down by a room render error.
//   · The lobby, tracker setup, account and history routes - unchanged.
//   · The root layout, and app/sim/draft/[id]/card/route.js (route handlers are
//     not covered by error.js in any case).
//
// The boundary must never make failures quieter for us while making them softer
// for readers: the error is logged in full to the console with its digest, which
// is the id Next also writes server-side, so the two halves correlate.
//
// WHAT IT DOES AND DOES NOT CATCH - measured, not assumed.
//   CATCHES: errors thrown while RE-RENDERING on the client after hydration.
//     That is the board-tab class exactly: the room loads on the available tab,
//     the reader taps BOARD, that render throws. Before this file, that took the
//     whole document down; now it swaps in this screen with the draft intact.
//   DOES NOT CATCH: a throw during the INITIAL server render of the page. That
//     kills the streamed shell before any boundary exists to receive it, and
//     Next answers with its own 500 document. Verified in a production build,
//     not inferred: a deliberate throw at the top of TrackerRoom returned 500
//     with no .sim-err markup. Branding that case needs an app-level
//     global-error.js, which is a wider blast radius than this segment and has
//     deliberately not been added here.

import { useEffect, useSyncExternalStore } from 'react';
import { ROOM_ERROR, roomHrefFrom } from './errorCopy';

// location IS an external store, and this is the API React provides for reading
// one: the server snapshot is the lobby, so SSR and the first client render
// agree, and no setState happens in an effect body (which the react-hooks
// set-state-in-effect rule rightly rejects). Same idiom as the tracker room's
// board-view store. Never resubscribes: a navigation unmounts this screen.
const NO_OP = () => () => {};
const readRoomHref = () => roomHrefFrom(window.location.pathname);
const serverRoomHref = () => ROOM_ERROR.lobbyHref;

export default function DraftRoomError({ error, reset }) {
  // Reading location rather than usePathname keeps next/navigation out of the
  // module, which is what lets errorCopy.js be unit-tested with no Next runtime.
  const roomHref = useSyncExternalStore(NO_OP, readRoomHref, serverRoomHref);

  useEffect(() => {
    // FULL detail here, none of it on screen. digest is what Next stamps on the
    // server-side log line for the same failure, so a report carrying the
    // reference below can be tied back to the stack we actually captured.
    const report = {
      message: error?.message,
      digest: error?.digest,
      stack: error?.stack,
      path: typeof window === 'undefined' ? null : window.location.pathname,
    };
    console.error('[sim:draft] room render failed', report);
    // AND SOMEWHERE WE CAN SEE IT. The console line above is the reader's copy;
    // this is ours. Before it existed, a room render error was invisible to us
    // entirely - the boundary only catches CLIENT re-renders, so the page served
    // 200 and the server logs read clean while the room was unusable. Measured
    // 2 Sep 2026: a TypeError took down 101 of the first 120 rows of the college
    // board and Vercel's runtime errors reported none in range.
    //
    // keepalive, so the report survives the reader navigating away from a screen
    // that just broke - which is the likeliest next thing they do. Fire and
    // forget, and the catch is deliberate: a failed report must never turn the
    // error screen into a worse error screen.
    try {
      fetch('/api/client-error', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(report),
        keepalive: true,
      }).catch(() => {});
    } catch { /* reporting is best-effort, always */ }
  }, [error]);

  return (
    <div className="sim" data-surface="ink">
      <div className="sim-wrap">
        <div className="sim-err">
          <div className="sim-kicker">{ROOM_ERROR.kicker}</div>
          <h1>{ROOM_ERROR.head}</h1>
          <p>{ROOM_ERROR.body}</p>
          <div className="sim-err-actions">
            <a className="sim-cta" href={roomHref}>{ROOM_ERROR.back}</a>
            <button type="button" className="sim-err-retry" onClick={() => reset()}>
              {ROOM_ERROR.retry}
            </button>
          </div>
          <a className="sim-err-lobby" href={ROOM_ERROR.lobbyHref}>{ROOM_ERROR.lobby}</a>
          {error?.digest ? (
            <div className="sim-err-ref">{ROOM_ERROR.ref} {error.digest}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
