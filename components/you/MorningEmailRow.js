'use client';

// components/you/MorningEmailRow.js - THE MORNING EMAIL SWITCH (ruling thu-1).
//
// The second writer on this tab, for the same reason as the red-zone switch: a
// standing instruction about the reader's own inbox has no other surface to
// point at. `on` is what the 15:00Z run will do for them today - their own
// choice when they made one, else the rule (played in 30 days, or a new
// account). The small line says which, so OFF never reads as a fault.

import { useState } from 'react';

export default function MorningEmailRow({ on: initial = false, chosen = false, unsubscribed = false }) {
  const [on, setOn] = useState(Boolean(initial));
  const [mine, setMine] = useState(Boolean(chosen));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const note = unsubscribed ? 'You unsubscribed from all email'
    : error ?? (mine ? (on ? 'Every morning, 8 AM PT' : 'Off - you turned it off') : (on ? 'Every morning while you play' : 'Off while you are not playing'));
  return (
    <div className="yu-set" data-row="morning-email">
      <span className="yu-k">Morning email<small>{note}</small></span>
      <button type="button" className={`yu-v yu-tog${on && !unsubscribed ? ' on' : ''}`} disabled={busy || unsubscribed}
        aria-pressed={on && !unsubscribed} aria-label="Morning email"
        onClick={async () => {
          const next = !on;
          setBusy(true); setError(null); setOn(next);
          const res = await fetch('/api/me/morning-email', {
            method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on: next }),
          }).then((r) => r.json()).catch(() => null);
          setBusy(false);
          if (!res?.ok) { setOn(!next); setError('That did not save. Try again.'); return; }
          setMine(true);
        }}>
        {unsubscribed ? 'Off' : on ? 'On' : 'Off'}
      </button>
    </div>
  );
}
