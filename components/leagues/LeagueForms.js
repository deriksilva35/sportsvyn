'use client';

// components/leagues/LeagueForms.js - the two-field social spine: one input
// to create, one input to join. Client island because the forms need inline
// error sentences; everything real happens in the server actions.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createLeagueAction, joinLeagueAction } from '@/app/actions/leagues';

export default function LeagueForms() {
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function run(action, form) {
    setBusy(true); setErr(null);
    const res = await action(new FormData(form)).catch(() => ({ ok: false, reason: 'Something broke' }));
    setBusy(false);
    if (!res.ok) { setErr(res.reason); return; }
    form.reset();
    router.refresh();   // the server list re-renders with the new membership
  }

  return (
    <div className="lgf">
      <form className="lgf-row" onSubmit={(e) => { e.preventDefault(); run(createLeagueAction, e.currentTarget); }}>
        <input name="name" placeholder="League name" maxLength={40} autoComplete="off" aria-label="New league name" />
        <button type="submit" className="ghost" disabled={busy}>Create</button>
      </form>
      <form className="lgf-row" onSubmit={(e) => { e.preventDefault(); run(joinLeagueAction, e.currentTarget); }}>
        <input name="code" placeholder="Join code" maxLength={8} autoComplete="off"
          style={{ textTransform: 'uppercase' }} aria-label="Join code" />
        <button type="submit" className="ghost" disabled={busy}>Join</button>
      </form>
      {err && <p className="err">{err}</p>}
    </div>
  );
}
