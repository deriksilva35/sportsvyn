'use client';

/**
 * components/push/AnswerNudge.js - the one-time pre-warm for people the sheet
 * will never reach.
 *
 * The onboarding sheet's trigger is `handle IS NULL`, so everyone who claimed
 * a handle before step 4 existed has permanently missed the ask. Their moment
 * is the one this component sits in: they just locked a Daily entry, the
 * answer they now care about drops tonight, and "Want the answer when it
 * drops tonight?" is the pre-warm at the exact instant its value is obvious.
 *
 * ONE TIME, ENFORCED TWICE. The server prop (`offer` = push_choice IS NULL)
 * is the durable guard - any answer, ever, on any surface, and this never
 * renders again. localStorage backstops the same session, because
 * savePushChoice is async and a router.refresh() race could re-show the card
 * for one paint. NOT NOW writes 'not-now', after which the profile row is
 * the only road back - same discipline as the sheet.
 */

import { useState } from 'react';
import { canOfferPush, enablePush } from '@/lib/push/client';
import { savePushChoice } from '@/app/actions/onboarding';

const SEEN_KEY = 'sv-push-nudge';

export default function AnswerNudge({ offer = false }) {
  const [visible, setVisible] = useState(() => {
    if (!offer || !canOfferPush()) return false;
    try { return localStorage.getItem(SEEN_KEY) == null; } catch { return true; }
  });
  const [busy, setBusy] = useState(false);

  if (!visible) return null;

  const dismiss = () => {
    try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode */ }
    setVisible(false);
  };

  async function yes() {
    setBusy(true);
    const got = await enablePush();
    await savePushChoice(got === 'granted' ? 'enabled' : got === 'denied' ? 'denied' : 'not-now').catch(() => null);
    dismiss();
  }

  async function no() {
    setBusy(true);
    await savePushChoice('not-now').catch(() => null);
    dismiss();
  }

  return (
    <section className="mod push-nudge" data-surface="ink">
      <p className="push-nudge-q">Want the answer when it drops tonight?</p>
      <div className="onb-row">
        <button type="button" className="onb-btn" onClick={no} disabled={busy}>
          Not now
        </button>
        <button type="button" className="onb-btn onb-btn--go" onClick={yes} disabled={busy}>
          {busy ? 'Setting up…' : 'Notify me'}
        </button>
      </div>
    </section>
  );
}
