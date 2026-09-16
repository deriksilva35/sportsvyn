'use client';
// components/gridiron/LiveActivityDebug.js - the web half of the native debug
// buttons (relay 3B item 2).
//
// A DEBUG CONTROL, AND IT SAYS SO ON THE PAGE. Nothing calls the bridge
// automatically yet: the whole point of this relay is one deliberate hand that
// starts an Activity for this game and ends it, so the bridge, the six fields
// and the deep link can be proven against a real handset before anything is
// wired to a poll.
//
// THE SERVER ALREADY DECIDED WHETHER TO RENDER IT (shell mode only). This
// checks again on the client anyway, because the server's answer is a cookie
// and the client's is a cookie AND a container - a webview that arrived
// without the cookie is still a webview, and a browser with the cookie is
// still a browser. Rendering a button that cannot post is worse than not
// rendering it.
//
// IT NEVER STARTS ON ITS OWN (relay 3B item 4). Activity.request needs the app
// in the foreground, and a start posted from a mount effect while the webview
// is still coming up is simply lost. The only start in this file is inside an
// onClick.
//
// STATE IS A PROP, NOT A FETCH. The six fields are built on the server by
// stateFromMatch() from the same game the page is already rendering, so this
// component cannot invent a scoreline the page does not show.

import { useState, useSyncExternalStore } from 'react';
import {
  startLiveActivity, endLiveActivity, canUseLiveActivityBridge,
} from '@/lib/shell/liveActivityBridge';

// useSyncExternalStore, NOT useState + useEffect - the pattern
// components/shell/AppHeader.js already uses for the same question. The shell
// cookie and window.Capacitor are an EXTERNAL source that does not exist during
// the server render, and a setState in a mount effect to find that out is both
// a cascading render and a lint error. The server snapshot is false, so the
// control is absent in the first paint and appears only where it can work.
const subscribe = () => () => {};
const getSnapshot = () => canUseLiveActivityBridge();
const getServerSnapshot = () => false;

export default function LiveActivityDebug({ matchId, url, state }) {
  const can = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [said, setSaid] = useState(null);

  if (!can) return null;

  const start = () => {
    const posted = startLiveActivity({ matchId, url, state });
    setSaid(posted
      ? `start posted · ${state.awayAbbr} ${state.awayScore}, ${state.homeAbbr} ${state.homeScore}${state.period ? ` · ${state.period} ${state.clock}` : ''}`
      : 'start NOT posted - no container');
  };
  const end = () => {
    setSaid(endLiveActivity({ matchId }) ? 'end posted' : 'end NOT posted - no container');
  };

  return (
    <section className="gg-ladbg" aria-label="Live Activity debug">
      <div className="gg-kick"><h2>LIVE ACTIVITY · DEBUG</h2><div className="rule" /></div>
      <div className="gg-ladbg-row">
        <button type="button" onClick={start}>Start Activity</button>
        <button type="button" onClick={end}>End Activity</button>
      </div>
      {/* WHAT IT WOULD SEND, ON THE PAGE. A debug control that says only
          "posted" cannot tell a wrong scoreline from a right one, and the
          six fields are exactly the thing under test. */}
      <dl className="gg-ladbg-state">
        <div><dt>match</dt><dd>{matchId}</dd></div>
        <div><dt>away</dt><dd>{state.awayAbbr} {state.awayScore}</dd></div>
        <div><dt>home</dt><dd>{state.homeAbbr} {state.homeScore}</dd></div>
        <div><dt>clock</dt><dd>{state.period || '-'} {state.clock || ''}</dd></div>
        <div><dt>url</dt><dd className="u">{url}</dd></div>
      </dl>
      {said ? <p className="gg-ladbg-said">{said}</p> : null}
    </section>
  );
}
