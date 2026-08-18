'use client';

/**
 * components/onboarding/OnboardingSheet.js — the first thing after sign-in.
 *
 * ============================================================================
 * ONE REQUIRED FIELD, AND IT IS THE HANDLE
 * ============================================================================
 * Sixty-one accounts, two handles claimed. The claim UI has only ever existed
 * inside The Daily, so everybody who arrives through the app and does not open
 * that one tab is never asked - and then appears on a public board as
 * "Player 3f9c". This sheet is where the ask moves.
 *
 * EMAIL AND NAME ARE OPTIONAL WITH AN EQUAL-WEIGHT SKIP. Not a grey link under
 * a volt button - the same size, the same row, genuinely equal. A sheet that
 * will not let you past without an address is one Apple can reject and a reader
 * can only resent, and neither field is worth that.
 *
 * STEP 1 REUSES HandleClaim RATHER THAN REIMPLEMENTING IT. That component
 * already has live availability, local-then-server validation, the denylist and
 * the cooldown behind it. A second claim UI would be a second place for those
 * rules to drift out of step.
 *
 * NOT DISMISSIBLE BY TAPPING AWAY. There is no backdrop close and no X on step
 * 1, because the trigger is `handle IS NULL` - a dismissal would simply return
 * on the next open, which reads as a bug rather than a choice. The way out of
 * step 1 is to claim a handle, which takes one word.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import HandleClaim from '@/components/daily/HandleClaim';
import { saveContactEmail, saveName, completeOnboarding } from '@/app/actions/onboarding';

export default function OnboardingSheet({ step2, initialName = '' }) {
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState(step2?.prefill ?? '');
  const [name, setName] = useState(initialName ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const router = useRouter();

  async function finish() {
    setBusy(true);
    await completeOnboarding().catch(() => null);
    setBusy(false);
    // refresh() rather than push(): the sheet is rendered by a server component
    // that reads `handle IS NULL`, so re-running that render is what removes it.
    router.refresh();
  }

  async function submitEmail() {
    setBusy(true); setErr(null);
    const res = await saveContactEmail(email).catch(() => ({ ok: false, reason: 'could not save' }));
    setBusy(false);
    if (!res.ok) { setErr(res.reason ?? 'Could not save that.'); return; }
    setStep(3);
  }

  async function submitName() {
    setBusy(true);
    await saveName(name).catch(() => null);
    setBusy(false);
    finish();
  }

  return (
    <div className="onb-scrim" role="dialog" aria-modal="true" aria-label="Set up your account">
      <div className="onb">
        <div className="onb-rail" aria-hidden="true">
          {[1, 2, 3].map((n) => <i key={n} className={n <= step ? 'on' : undefined} />)}
        </div>

        {/* ---- STEP 1 · HANDLE (required) ------------------------------ */}
        {step === 1 && (
          <>
            <div className="onb-kicker">Step 1 of 3</div>
            <h2 className="onb-h">Pick your handle</h2>
            <p className="onb-lede">
              This is your leaderboard name. It shows next to your score on every
              board, in every game. Three to fifteen characters, letters, numbers
              and underscores.
            </p>
            <HandleClaim onDone={() => setStep(2)} />
            {/* THE CONTRACT, stated where the ask is. Step 1 is the one step
                with no Skip and no backdrop dismiss - the trigger is
                `handle IS NULL`, so a dismissal would simply return on the next
                open and read as a bug rather than a choice. A required field is
                easier to accept when its cost is named out loud. */}
            <p className="onb-note">You will pick this once - it takes ten seconds.</p>
          </>
        )}

        {/* ---- STEP 2 · EMAIL (optional) ------------------------------- */}
        {step === 2 && (
          <>
            <div className="onb-kicker">Step 2 of 3</div>
            <h2 className="onb-h">
              {step2?.mode === 'confirm' ? 'Is this the best address for you?' : 'Where should we reach you?'}
            </h2>
            <p className="onb-lede">
              {step2?.mode === 'confirm'
                ? 'We will only use it for results and things that change - never for anything you did not ask for.'
                // THE OLD LINE SAID "which we cannot read" AND THAT WAS FALSE.
                // An Apple relay address forwards perfectly well and we mail 30
                // of them today - the reason to ask is preference and
                // durability, not our inability. Copy that invents a technical
                // excuse is worse than copy that asks plainly.
                : 'You signed in with a private Apple relay address. That works fine - but if you would rather hear from us directly, drop a real one here. Entirely optional.'}
            </p>
            <input
              className="onb-in"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck="false"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-label="Contact email"
            />
            {err && <p className="onb-err">{err}</p>}
            <div className="onb-row">
              {/* EQUAL WEIGHT. Same element, same size, same row. */}
              <button type="button" className="onb-btn" onClick={() => setStep(3)} disabled={busy}>
                Skip
              </button>
              <button type="button" className="onb-btn onb-btn--go" onClick={submitEmail} disabled={busy || !email.trim()}>
                {step2?.mode === 'confirm' ? 'Use this one' : 'Save'}
              </button>
            </div>
          </>
        )}

        {/* ---- STEP 3 · NAME (optional) -------------------------------- */}
        {step === 3 && (
          <>
            <div className="onb-kicker">Step 3 of 3</div>
            <h2 className="onb-h">What should we call you?</h2>
            <p className="onb-lede">
              Only used where a real name reads better than a handle. Nobody else
              sees it on a board.
            </p>
            <input
              className="onb-in"
              type="text"
              autoComplete="name"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="Your name"
            />
            <div className="onb-row">
              <button type="button" className="onb-btn" onClick={finish} disabled={busy}>
                Skip
              </button>
              <button type="button" className="onb-btn onb-btn--go" onClick={submitName} disabled={busy}>
                {busy ? 'Saving…' : 'Done'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
