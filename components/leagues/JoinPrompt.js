'use client';

// components/leagues/JoinPrompt.js - the invitation card, the share target's
// whole job: a friend tapped a league link from a group chat, so the FIRST
// thing on the page is the league's name and one button. Sign-in law rides
// first (the href carries the join code through the round trip); a dud code
// gets a sentence, never a null - a 404 here punishes the friend for the
// member's typo.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { joinLeagueAction } from '@/app/actions/leagues';

export default function JoinPrompt({ invite, signedIn, alreadyIn, signinHref }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const router = useRouter();

  if (!invite) {
    return (
      <section className="mod mod--invite">
        <p className="muted">
          That league code doesn&rsquo;t match anything &mdash; codes are six
          characters. Ask for a fresh link.
        </p>
      </section>
    );
  }

  async function join() {
    setBusy(true); setErr(null);
    const fd = new FormData();
    fd.set('code', invite.code);
    const res = await joinLeagueAction(fd).catch(() => ({ ok: false, reason: 'Could not join' }));
    setBusy(false);
    if (!res.ok) { setErr(res.reason); return; }
    // Land on the LEAGUE PAGE as a member (DAILY tab is the default) - the
    // invitation's promise is the board, not the index.
    router.replace(`/leagues/${res.leagueId}`);
    router.refresh();
  }

  return (
    <section className="mod mod--invite">
      <div className="mod-head">
        <h2 className="eyebrow">You&rsquo;re invited</h2>
        <span className="pill">{invite.members} {invite.members === 1 ? 'member' : 'members'}</span>
      </div>
      <p className="lg-invite-name">{invite.name}</p>
      {alreadyIn ? (
        <p className="muted">You&rsquo;re already in this one &mdash; it&rsquo;s below.</p>
      ) : signedIn ? (
        <button type="button" className="ghost lg-join" onClick={join} disabled={busy}>
          {busy ? 'Joining…' : 'Join the league →'}
        </button>
      ) : (
        <a className="ghost lg-join" href={signinHref}>Sign in to join &rarr;</a>
      )}
      {err && <p className="err">{err}</p>}
    </section>
  );
}
