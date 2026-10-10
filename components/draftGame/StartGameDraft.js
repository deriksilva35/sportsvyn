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

export default function StartGameDraft({ contestId }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  async function go() {
    setBusy(true); setErr(null);
    const r = await startGameDraftAction(contestId).catch(() => ({ ok: false }));
    // push + refresh: from the room page itself the URL does not change, and the
    // server component has to re-read the room it just started.
    if (r?.ok) { router.push(`/draft/game/${contestId}`); router.refresh(); return; }
    setBusy(false);
    setErr(REASON[r?.reason] ?? 'Could not start the draft.');
  }
  return (
    <>
      <button type="button" className="dgm-btn dgm-btn--go" disabled={busy} onClick={go}>
        {busy ? 'Taking a seat…' : 'Draft'}
      </button>
      {err && <p className="dgm-err" role="alert">{err}</p>}
    </>
  );
}
