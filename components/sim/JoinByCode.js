'use client';

// components/sim/JoinByCode.js - "Join a league" by typing the code.
//
// IN A GROUP CHAT THE CODE IS WHAT PEOPLE TYPE. The link (/join/CODE) opens in
// Safari from a chat until Universal Links ship with the next binary; the
// eight characters, read off a screenshot, work inside the app today. This is
// that field: eight characters of the invite alphabet, upper-cased and
// confusable-stripped at the keystroke (paste "abcd-efgh " and it reads
// ABCDEFGH), and one button.
//
// ONE REDEEM PATH. This component never joins. Submit is a READ (previewInvite,
// the same invitePreview the /join page renders from) so a dud, expired,
// revoked or used-up code is said inline in the plain words JoinClaim uses,
// and a live one navigates to /join/{code} - the claim screen, the one place
// the redeem happens. Signed out, that route carries the code into sign-in
// itself (see app/join/[code]/page.js); this field does not reason about
// auth, so there is nothing for it to get wrong.
//
// RELATIVE NAVIGATION, ALWAYS. joinPath is '/join/…' with no origin, so inside
// the container the claim screen renders in the container. Nothing here opens
// a window, targets _blank, or names sportsvyn.com.
//
// Three placements, one component: the lobby's empty state (no leagues yet),
// the persistent row under the league cards, and the shell's sign-in screen.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { previewInvite } from '@/app/actions/league';
import { cleanInviteInput, normalizeInviteCode, joinPath, INVITE_CODE_LENGTH, REFUSALS } from '@/lib/fantasy/inviteCode';
import './joinByCode.css';

export default function JoinByCode({ variant = 'row' }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [value, setValue] = useState('');
  const [err, setErr] = useState(null);
  const [going, setGoing] = useState(null);
  const empty = variant === 'empty';
  const signin = variant === 'signin';

  function submit(e) {
    e.preventDefault();
    setErr(null);
    const code = normalizeInviteCode(value);
    if (!code) { setErr(REFUSALS.not_a_code); return; }
    start(async () => {
      const res = await previewInvite(code);
      if (!res.ok) { setErr(REFUSALS[res.reason] ?? REFUSALS.invalid_code); return; }
      setGoing(res.league);
      router.push(joinPath(code));
    });
  }

  return (
    <form className={`jbc jbc--${variant}`} onSubmit={submit} noValidate>
      {empty ? (
        <>
          <div className="sim-kicker">Join a league</div>
          <p className="jbc-lead">Got a code from your league&rsquo;s owner? Type it here and claim your team.</p>
        </>
      ) : (
        <div className="jbc-l">{signin ? 'HAVE A LEAGUE CODE?' : 'JOIN A LEAGUE'}</div>
      )}
      <div className="jbc-row">
        <input
          className="jbc-in"
          type="text"
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={INVITE_CODE_LENGTH + 4}
          placeholder="8-character code"
          aria-label="League code"
          value={value}
          onChange={(e) => { setValue(cleanInviteInput(e.target.value)); if (err) setErr(null); }}
          onPaste={(e) => { const t = e.clipboardData?.getData('text'); if (t != null) { e.preventDefault(); setValue(cleanInviteInput(t)); if (err) setErr(null); } }}
          disabled={pending || going != null}
        />
        <button type="submit" className="jbc-go" disabled={pending || going != null || value.length !== INVITE_CODE_LENGTH}>
          {going ? 'Opening…' : pending ? 'Checking…' : 'Join'}
        </button>
      </div>
      {err ? <p className="jbc-err" role="alert">{err}</p>
        : going ? <p className="jbc-h">{going} - pick your team.</p>
        : signin ? <p className="jbc-h">Sign in first, then you&rsquo;ll pick your team. The code comes with you.</p>
        : null}
    </form>
  );
}
