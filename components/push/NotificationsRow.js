'use client';

/**
 * components/push/NotificationsRow.js - the road back for the not-nows.
 *
 * Every pre-warm surface (sheet step 4, the post-entry nudge) is one-time by
 * design, so a NOT NOW needs somewhere durable to change its mind. This is
 * that place: an account row that renders only where the plugin exists.
 *
 * THE ENABLE PATH IS THE SAME DISCIPLINE - our row, tapped explicitly, then
 * the OS prompt. One wrinkle the one-time surfaces do not have: if the OS
 * permission was DENIED at the system level, register() cannot prompt again -
 * Apple's one-shot is spent - so the honest response is to say where the
 * switch actually lives now (Settings), not to no-op.
 */

import { useState } from 'react';
import { canOfferPush, enablePush } from '@/lib/push/client';
import { savePushChoice } from '@/app/actions/onboarding';

export default function NotificationsRow({ choice = null }) {
  const [state, setState] = useState(choice);       // null | not-now | denied | enabled
  const [busy, setBusy] = useState(false);
  const [settingsHint, setSettingsHint] = useState(false);

  if (!canOfferPush()) return null;

  async function enable() {
    setBusy(true);
    const got = await enablePush();
    if (got === 'granted') {
      await savePushChoice('enabled').catch(() => null);
      setState('enabled');
    } else if (got === 'denied') {
      await savePushChoice('denied').catch(() => null);
      setState('denied');
      setSettingsHint(true);
    }
    setBusy(false);
  }

  return (
    <div className="acct-row">
      <span className="k">Notifications</span>
      <span className="v">
        {state === 'enabled' ? (
          'On - board live & answers'
        ) : settingsHint || state === 'denied' ? (
          'Off - enable in iOS Settings'
        ) : (
          <button type="button" className="acct-link" onClick={enable} disabled={busy}>
            {busy ? 'Setting up…' : 'Turn on'}
          </button>
        )}
      </span>
    </div>
  );
}
