'use client';

// components/sim/JoinClaim.js - the claim screen behind /join/{code} (085).
//
// TWELVE FRANCHISES, TAP YOURS. The league's teams in draft order; a taken
// one shows who holds it (name + @handle) and cannot be tapped; your own shows
// as yours. One tap joins AND claims (redeemInvite carries the team id), then
// lands on /sim where the card's picker opens on that franchise's column.
// "Join without a team" is the honest escape when the pool is not your name
// yet - you are in, unclaimed, and the strip opens on seat 1.
//
// A WRONG CLAIM IS NOT A TRAP: leaving the league (on the card) frees the
// franchise, and re-tapping the link is idempotent membership.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { redeemInvite } from '@/app/actions/league';
import { REFUSALS } from '@/lib/fantasy/inviteCode';

// The refusal wording is lib/fantasy/inviteCode.js's REFUSALS - the lobby's code
// field says the same words inline, from the same object.

export default function JoinClaim({ code, preview }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState(null);
  const [chosen, setChosen] = useState(null);

  if (!preview?.ok) {
    return (
      <section className="jc">
        {preview?.league?.name ? <h1 className="jc-name">{preview.league.name}</h1> : null}
        <p className="jc-refusal">{REFUSALS[preview?.reason] ?? REFUSALS.invalid_code}</p>
      </section>
    );
  }

  const { league, franchises, memberCount, alreadyMember } = preview;

  function go(fantraxTeamId) {
    setErr(null);
    setChosen(fantraxTeamId);
    start(async () => {
      const res = await redeemInvite(code, fantraxTeamId);
      if (!res.ok) { setErr(REFUSALS[res.reason] ?? res.reason); setChosen(null); return; }
      if (res.claimReason) { setErr(REFUSALS[res.claimReason] ?? res.claimReason); setChosen(null); router.refresh(); return; }
      router.push('/sim');
    });
  }

  return (
    <section className="jc">
      <h1 className="jc-name">{league.name}</h1>
      <p className="jc-meta">{league.teamsCount} teams · {memberCount} {memberCount === 1 ? 'member' : 'members'} in</p>
      <p className="jc-hint">
        {alreadyMember
          ? 'You are in this league. Tap your team to claim it, or head to the lobby.'
          : 'Tap your team to join as its owner. A taken team is somebody else’s.'}
      </p>
      <div className="jc-grid" role="list">
        {franchises.map((f) => {
          const taken = f.claimedBy != null && !f.claimedBy.mine;
          const mine = f.claimedBy?.mine === true;
          return (
            <button
              key={f.fantraxTeamId}
              type="button"
              role="listitem"
              className={`jc-team${taken ? ' taken' : ''}${mine ? ' mine' : ''}`}
              disabled={pending || taken || mine}
              onClick={() => go(f.fantraxTeamId)}
            >
              <span className="jc-slot">{f.slot}</span>
              <span className="jc-team-name">{f.name}</span>
              <span className="jc-holder">
                {mine ? 'yours'
                  : f.claimedBy ? `${f.claimedBy.name ?? f.claimedBy.handle ?? 'claimed'}${f.claimedBy.handle ? ` · @${f.claimedBy.handle}` : ''}`
                  : pending && chosen === f.fantraxTeamId ? 'claiming…' : 'open'}
              </span>
            </button>
          );
        })}
      </div>
      {err && <p className="jc-err">{err}</p>}
      <div className="jc-foot">
        <button type="button" className="jc-noteam" disabled={pending} onClick={() => go(null)}>
          {alreadyMember ? 'Go to the lobby' : 'Join without a team'}
        </button>
      </div>
    </section>
  );
}
