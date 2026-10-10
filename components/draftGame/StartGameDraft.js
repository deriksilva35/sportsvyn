'use client';

// "Draft" on one game's card: takes a seat (startGameDraftAction) and walks into
// the room. A refusal (locked, signed out) is said on the card, not thrown.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { startGameDraftAction } from '@/app/actions/draftGame';

const REASON = {
  locked: 'This game has kicked off.',
  signed_out: 'Sign in to draft.',
  not_found: 'This board is gone.',
};

// inRoom: on the room page itself the URL does not change, so re-read the page;
// from the list, navigate. (push + refresh together let the refresh cancel the
// push - found on the S1 preview.)
export default function StartGameDraft({ contestId, inRoom = false }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  async function go() {
    setBusy(true); setErr(null);
    const r = await startGameDraftAction(contestId).catch(() => ({ ok: false }));
    if (r?.ok) {
      if (inRoom) router.refresh(); else router.push(`/draft/game/${contestId}`);
      return;
    }
    setBusy(false);
    setErr(REASON[r?.reason] ?? 'Could not start the draft.');
  }
  return (
    <>
      <button type="button" className="dgm-pill" disabled={busy} onClick={go}>
        {busy ? 'Taking a seat…' : 'Draft'}
      </button>
      {err && <p className="dgm-err" role="alert">{err}</p>}
    </>
  );
}
