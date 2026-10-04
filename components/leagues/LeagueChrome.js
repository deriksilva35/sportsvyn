'use client';

// components/leagues/LeagueChrome.js - the league header's two copy actions
// and the non-member CODE field. Client because clipboard and a pending
// state are the whole job; everything real is a server action or a string.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { joinLeagueAction } from '@/app/actions/leagues';
import { CODE_LENGTH, REFUSALS, cleanLeagueInput } from '@/lib/leagues/code';

async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/** The join-code chip - tap copies the CODE. */
export function CodeChip({ code }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="lg-codechip"
      onClick={async () => { if (await copy(code)) { setDone(true); setTimeout(() => setDone(false), 1500); } }}
      aria-label={`Copy join code ${code}`}
    >
      <span>Join code</span>
      <b>{done ? 'copied' : code}</b>
    </button>
  );
}

/** Frame 3's one action: THE CODE. A league id in the URL is not an
 * invitation (ids are serial - anybody can count), so the preview never joins
 * on it; the reader types the code a member gave them, and the join is the
 * same joinLeagueAction every other code field uses. Post-join: the league
 * that code names, as a member. Rendered by the private-league 404
 * (app/leagues/[id]/not-found.js), which knows no league - leagueId is then
 * absent and the join always navigates to the league the code named. */
export function JoinWithCodeForm({ leagueId }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const router = useRouter();
  return (
    <form
      className="lg-join-code"
      onSubmit={async (e) => {
        e.preventDefault();
        setErr(null);
        if (code.length !== CODE_LENGTH) { setErr(REFUSALS.not_a_code); return; }
        setBusy(true);
        const fd = new FormData();
        fd.set('code', code);
        const res = await joinLeagueAction(fd).catch(() => ({ ok: false, reason: REFUSALS.failed }));
        setBusy(false);
        if (!res.ok) { setErr(res.reason); return; }
        if (Number(res.leagueId) === Number(leagueId)) router.refresh();
        else router.replace(`/leagues/${res.leagueId}`);
      }}
    >
      <input
        name="code" value={code} onChange={(e) => setCode(cleanLeagueInput(e.target.value))}
        placeholder="Invite code" maxLength={CODE_LENGTH} autoComplete="off" autoCapitalize="characters"
        aria-label="Invite code" style={{ textTransform: 'uppercase' }}
      />
      <button type="submit" className="lg-join-primary" disabled={busy}>
        {busy ? 'Joining…' : 'Join with code'}
      </button>
      {err && <p className="err">{err}</p>}
    </form>
  );
}
