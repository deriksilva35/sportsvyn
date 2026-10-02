'use client';

// components/leagues/LeaguesHome.js - the two client pieces of /leagues (canvas
// "Leagues V1", board Main): the CREATE / JOIN WITH CODE pair, and the INVITED
// card a shared link leads with. Every write is a server action; the refusal
// sentences are the server's own (lib/leagues/code.js REFUSALS).

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { joinLeagueAction, joinInviteAction } from '@/app/actions/leagues';
import { CODE_LENGTH, REFUSALS, cleanLeagueInput } from '@/lib/leagues/code';

export function LeagueActions() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const router = useRouter();

  async function join(e) {
    e.preventDefault();
    setErr(null);
    if (code.length !== CODE_LENGTH) { setErr(REFUSALS.not_a_code); return; }
    setBusy(true);
    const fd = new FormData();
    fd.set('code', code);
    const res = await joinLeagueAction(fd).catch(() => ({ ok: false, reason: REFUSALS.failed }));
    setBusy(false);
    if (!res.ok) { setErr(res.reason); return; }
    router.push(`/leagues/${res.leagueId}`);
  }

  return (
    <>
      <div className="lv-actions">
        <Link className="lv-btn lv-btn--primary" href="/leagues/new">Create a league</Link>
        <button type="button" className="lv-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>Join with code</button>
      </div>
      {open && (
        <form className="lv-codeform" onSubmit={join}>
          <input className="lv-input lv-input--code" value={code} autoFocus aria-label="League code"
            onChange={(e) => setCode(cleanLeagueInput(e.target.value))} placeholder="ABC234"
            maxLength={CODE_LENGTH} autoComplete="off" autoCapitalize="characters" />
          <button type="submit" className="lv-btn lv-btn--primary" disabled={busy}>{busy ? 'Joining…' : 'Join'}</button>
          {err && <p className="lv-err" role="alert" style={{ gridColumn: '1 / -1' }}>{err}</p>}
        </form>
      )}
    </>
  );
}

/** The INVITED card: a league a link named, one tap from joining. */
export function InvitedCard({ inviteKey, name, line, refusal = null, already = false, leagueId = null }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const router = useRouter();
  async function join() {
    setBusy(true); setErr(null);
    const res = await joinInviteAction(inviteKey).catch(() => ({ ok: false, reason: REFUSALS.failed }));
    setBusy(false);
    if (!res.ok) { setErr(res.reason); return; }
    router.replace(`/leagues/${res.leagueId}`);
    router.refresh();
  }
  return (
    <section className="lv-invited" aria-label="Invited">
      <span className="lv-kicker" style={{ padding: 0 }}>Invited</span>
      <p className="lv-invited-name"><b>{name}</b>{line ? <>, {line}</> : null}</p>
      {refusal && <p className="lv-refusal">{refusal}</p>}
      <div className="lv-invited-row">
        {already ? (
          <Link className="lv-btn lv-btn--primary" href={`/leagues/${leagueId}`}>You&rsquo;re in - open it</Link>
        ) : !refusal ? (
          <button type="button" className="lv-btn lv-btn--primary" onClick={join} disabled={busy}>{busy ? 'Joining…' : 'Join'}</button>
        ) : null}
        <Link className="lv-btn" href="/leagues" replace>Not now</Link>
      </div>
      {err && <p className="lv-err" role="alert">{err}</p>}
    </section>
  );
}
