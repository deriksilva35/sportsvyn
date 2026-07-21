'use client';

// Delete-account control for the sim account page (App Store guideline 5.1.1(v)).
// Dim/terra, below sign out - findable but not prominent. Tap reveals a confirm
// step that states plainly what happens; confirming calls the server action
// (session-scoped, server-authoritative) and then signs out, landing on
// /sim?deleted=1 which renders a plain "Account deleted" state.

import { useState, useTransition } from 'react';
import { signOut } from 'next-auth/react';
import { deleteAccount } from '@/app/actions/sim';

export default function DeleteAccount() {
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState(null);

  function go() {
    setErr(null);
    start(async () => {
      const res = await deleteAccount();
      if (!res.ok) { setErr('Could not delete your account. Please try again.'); return; }
      // Session rows are gone; clear the cookie and land on the deleted state.
      await signOut({ redirectTo: '/sim?deleted=1' });
    });
  }

  if (!confirming) {
    return (
      <button type="button" className="acct-delete" onClick={() => setConfirming(true)}>
        Delete account
      </button>
    );
  }

  return (
    <div className="acct-delconfirm">
      <p>This permanently deletes your account, all your drafts, and your draft history. This can&apos;t be undone.</p>
      <div className="acct-delrow">
        <button type="button" className="acct-delyes" onClick={go} disabled={pending}>
          {pending ? 'Deleting…' : 'Delete permanently'}
        </button>
        <button type="button" className="acct-delno" onClick={() => { setConfirming(false); setErr(null); }} disabled={pending}>
          Cancel
        </button>
      </div>
      {err && <div className="setup-err">{err}</div>}
    </div>
  );
}
