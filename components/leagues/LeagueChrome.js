'use client';

// components/leagues/LeagueChrome.js - the league header's two copy actions
// and the non-member JOIN button. Client because clipboard and a pending
// state are the whole job; everything real is a server action or a string.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { joinLeagueByIdAction } from '@/app/actions/leagues';
import { leagueShareLink } from '@/lib/leagues/nav';

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

/** The share button - copies the full invite link. */
export function CopyLinkButton({ code }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="lg-invitebtn"
      onClick={async () => { if (await copy(leagueShareLink(code))) { setDone(true); setTimeout(() => setDone(false), 1500); } }}
    >
      {done ? 'Link copied' : 'Copy link'}
    </button>
  );
}

/** Frame 3's single primary action. Post-join: the league page, DAILY tab,
 * as a member - refresh() re-renders the server view with the membership. */
export function JoinLeagueButton({ leagueId, name = null }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const router = useRouter();
  return (
    <>
      <button
        type="button"
        className="lg-join-primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true); setErr(null);
          const res = await joinLeagueByIdAction(leagueId).catch(() => ({ ok: false, reason: 'Could not join' }));
          setBusy(false);
          if (!res.ok) { setErr(res.reason); return; }
          router.refresh();
        }}
      >
        {busy ? 'Joining…' : `Join ${name ?? 'the league'}`}
      </button>
      {err && <p className="err">{err}</p>}
    </>
  );
}
