'use client';

// components/sim/LeagueStart.js — the one button an imported league has.
//
// IT STARTS THE DRAFT, IT DOES NOT LINK TO A PAGE. There is no /sim/league/[id]
// surface, and a card that navigated to one would be a dead link on the app's
// most-visited screen. The seat is already the config's (isMine), so the only
// thing to ask the server is "start it"; the answer is a room, and we go there.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { startLeagueDraft } from '@/app/actions/sim';

const REASONS = {
  league_not_found: 'That league is not on this account.',
  no_seat: 'This import has no seat for you.',
  no_pool: 'No player pool for this league yet.',
  entitlement: 'The room turned that down. Try again in a moment.',
};

export default function LeagueStart({ configId }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState(null);

  function go() {
    setErr(null);
    start(async () => {
      const res = await startLeagueDraft(configId, {});
      if (!res.ok) {
        if (res.reason === 'unauthenticated') { router.push('/signin?callbackUrl=/sim'); return; }
        setErr(REASONS[res.reason] ?? `Could not start: ${res.reason}`);
        return;
      }
      router.push(`/sim/draft/${res.draftId}`);
    });
  }

  return (
    <>
      <button type="button" className="sml-start" onClick={go} disabled={pending}>
        {pending ? 'Starting…' : 'Start draft'}
      </button>
      {err ? <span className="sml-err">{err}</span> : null}
    </>
  );
}
