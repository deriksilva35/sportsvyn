'use client';

// components/leagues/InviteJoin.js - /j/<key>'s one button. The page is a
// preview and writes nothing on render; the join is this tap, a server action,
// and its refusal (full, started, reset) is the server's sentence.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { joinInviteAction } from '@/app/actions/leagues';
import { REFUSALS } from '@/lib/leagues/code';

export default function InviteJoin({ inviteKey, name }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const router = useRouter();
  return (
    <>
      <button type="button" className="lv-btn lv-btn--primary lv-btn--block" disabled={busy} data-invite-join
        onClick={async () => {
          setBusy(true); setErr(null);
          const res = await joinInviteAction(inviteKey).catch(() => ({ ok: false, reason: REFUSALS.failed }));
          setBusy(false);
          if (!res.ok) { setErr(res.reason); router.refresh(); return; }
          router.replace(`/leagues/${res.leagueId}`);
        }}>
        {busy ? 'Joining…' : `Join ${name}`}
      </button>
      {err && <p className="lv-err" role="alert">{err}</p>}
    </>
  );
}
