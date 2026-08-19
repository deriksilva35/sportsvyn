'use client';

/**
 * components/push/NotificationsRow.js - the notifications TOGGLE, and the
 * word matters: the first version rendered "On - board live & answers" as
 * static text the moment the server column said enabled, which left the one
 * device that most needed the new permission flow with nothing to tap.
 *
 * TWO RULES REPLACE IT:
 *
 *   THE OS IS THE FACT, THE COLUMN IS A PREFERENCE. On mount the row asks
 *   checkPermissions and renders from THAT: a device whose OS says
 *   denied/undetermined shows OFF no matter what push_choice claims - with
 *   "needs re-enable" microcopy when the two disagree, because that
 *   disagreement is precisely the stale-enabled state the Aug 19 defect
 *   manufactured.
 *
 *   INTERACTIVE IN BOTH STATES. ON -> tap turns it off: this device's token
 *   revoked, push_choice='disabled' (distinct from 'not-now' so a deliberate
 *   off is never re-nudged). OFF -> tap runs the full verified flow:
 *   check -> native prompt -> re-read -> register only on a grant that
 *   survives the re-read. A denied OS prompt records denied and points at
 *   iOS Settings, where the switch actually lives once Apple's one-shot is
 *   spent.
 *
 * One row, mono grammar, both page variants - no new surface.
 */

import { useEffect, useState } from 'react';
import { canOfferPush, enablePush, disablePush, devicePermission } from '@/lib/push/client';
import { savePushChoice } from '@/app/actions/onboarding';

export default function NotificationsRow({ choice = null, variant = 'sim' }) {
  const [serverChoice, setServerChoice] = useState(choice);
  const [perm, setPerm] = useState('checking');   // checking | granted | denied | prompt | null
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!canOfferPush()) return;
    let dead = false;
    devicePermission().then((p) => { if (!dead) setPerm(p ?? 'prompt'); });
    return () => { dead = true; };
  }, []);

  if (!canOfferPush()) return null;

  const on = perm === 'granted' && serverChoice === 'enabled';
  const stale = perm !== 'checking' && perm !== 'granted' && serverChoice === 'enabled';

  async function toggle() {
    setBusy(true);
    if (on) {
      await disablePush();
      await savePushChoice('disabled').catch(() => null);
      setServerChoice('disabled');
    } else {
      const got = await enablePush();
      if (got === 'granted') {
        await savePushChoice('enabled').catch(() => null);
        setServerChoice('enabled');
        setPerm('granted');
      } else if (got === 'denied') {
        await savePushChoice('denied').catch(() => null);
        setServerChoice('denied');
        setPerm('denied');
      }
    }
    setBusy(false);
  }

  const label = perm === 'checking' ? '…'
    : on ? 'On - board live & answers'
      : stale ? 'Off - needs re-enable'
        : perm === 'denied' && serverChoice === 'denied' ? 'Off - enable in iOS Settings'
          : 'Off';

  const control = (
    <button type="button" className="acct-link" onClick={toggle} disabled={busy || perm === 'checking'}>
      {busy ? 'Working…' : on ? 'Turn off' : 'Turn on'}
    </button>
  );

  const value = <>{label} · {control}</>;

  if (variant === 'account') {
    return (
      <section className="acct-mod">
        <h2 className="acct-eyebrow">Notifications</h2>
        <div className="acct-rows">
          <div className="acct-row">
            <span>Board live &amp; answer drops</span>
            <span className={`acct-r${on ? ' acct-r--on' : ''}`}>{value}</span>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="acct-row">
      <span className="k">Notifications</span>
      <span className="v">{value}</span>
    </div>
  );
}
