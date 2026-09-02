'use client';

// components/sim/LeagueStart.js — the one action an imported league has: pick
// a seat, start the draft.
//
// IT STARTS THE DRAFT, IT DOES NOT LINK TO A PAGE. There is no /sim/league/[id]
// surface, and a card that navigated to one would be a dead link on the app's
// most-visited screen.
//
// THE SEAT IS THIS RUN'S (084). The strip opens on the seat the commissioner
// gave you (defaultSeat, the teams entry marked isMine); tap another and the
// draft seats you there for this run only - the league's record is untouched,
// and the keepers' cells follow their owners to wherever they sit. The default
// is sent as no seat at all, so a run from your own seat is byte-for-byte the
// start it was before the picker existed.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { startLeagueDraft } from '@/app/actions/sim';
import SeatStrip from './SeatStrip';

const REASONS = {
  league_not_found: 'That league is not on this account.',
  no_seat: 'This import has no seat for you.',
  bad_seat: 'Pick a seat between 1 and the league size.',
  no_pool: 'No player pool for this league yet.',
  entitlement: 'The room turned that down. Try again in a moment.',
};

export default function LeagueStart({ configId, teamsCount = 0, defaultSeat = null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState(null);
  const [seat, setSeat] = useState(defaultSeat ?? 1);

  function go() {
    setErr(null);
    start(async () => {
      const opts = defaultSeat != null && seat === defaultSeat ? {} : { seat };
      const res = await startLeagueDraft(configId, opts);
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
      {teamsCount > 0 ? (
        <SeatStrip
          teams={teamsCount}
          seat={seat}
          defaultSeat={defaultSeat}
          onChange={setSeat}
          disabled={pending}
          hint="Draft from any spot - this run only."
        />
      ) : null}
      <button type="button" className="sml-start" onClick={go} disabled={pending}>
        {pending ? 'Starting…' : `Start draft · seat ${seat}`}
      </button>
      {err ? <span className="sml-err">{err}</span> : null}
    </>
  );
}
