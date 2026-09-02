'use client';

// components/sim/LeagueStart.js — the one action an imported league has: pick
// a seat, start the draft.
//
// IT STARTS THE DRAFT, IT DOES NOT LINK TO A PAGE. There is no /sim/league/[id]
// surface, and a card that navigated to one would be a dead link on the app's
// most-visited screen.
//
// THE SEAT IS A FRANCHISE (ruling 2 Sep). The strip opens on your own team
// (defaultSeat, the teams entry marked isMine); tap another and you play THAT
// team this run - its column, its keepers on your roster tab - while your real
// team drafts as a bot at its own column. The board never moves: every keeper
// sits in its owner's real column in every run. The default is sent as no seat
// at all, so a run as your own team is byte-for-byte the start it was before
// the picker existed.

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

export default function LeagueStart({ configId, teamsCount = 0, defaultSeat = null, keptBySeat = null }) {
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
          label="YOUR TEAM"
          hint="Draft as any team - this run only."
          counts={keptBySeat}
        />
      ) : null}
      <button type="button" className="sml-start" onClick={go} disabled={pending}>
        {pending ? 'Starting…' : `Start draft · seat ${seat}`}
      </button>
      {err ? <span className="sml-err">{err}</span> : null}
    </>
  );
}
