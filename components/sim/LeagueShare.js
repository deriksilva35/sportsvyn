'use client';

// components/sim/LeagueShare.js - the league card's second half (085): who is
// in, the invite, your own mocks of this league.
//
// THE OWNER SHARES, MEMBERS ARRIVE. Share (owner only) mints one live code
// and shows it as a copyable link - /join/CODE is what rides the group chat.
// New code retires the old link; Revoke closes the door with no replacement.
// Every member sees the roster of people with their franchises; a member can
// leave (their franchise frees), the owner can kick.
//
// RUNS ARE PRIVATE (ruling reversed 2 Sep). YOUR MOCKS is your own last ten
// COMPLETED runs of this league - as which franchise, when, your first three
// picks, each a link to its results. Nobody else's runs appear here, in any
// state, and the owner sees no more than a member does. `mocks` arrives
// already scoped to the viewer (myLeagueRuns); this component never had a
// second member's row to hide, so the per-run Hide/Show that shipped with the
// shared list is gone with it.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createInvite, revokeInvites, leaveLeague, kickMember } from '@/app/actions/league';

const SITE = 'https://sportsvyn.com';
export const joinHref = (code) => `${SITE}/join/${code}`;

function when(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function LeagueShare({ configId, role, members = [], invite = null, mocks = [], myUserId = null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const owner = role === 'owner';

  function run(fn) {
    setErr(null);
    start(async () => {
      const res = await fn();
      if (!res?.ok) { setErr(res?.reason ?? 'failed'); return; }
      router.refresh();
    });
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { setErr('copy_failed'); }
  }

  return (
    <div className="lgs">
      <div className="lgs-row">
        <button type="button" className="lgs-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {members.length} {members.length === 1 ? 'member' : 'members'}{owner ? ' · Share' : ''}{open ? ' −' : ' +'}
        </button>
      </div>
      {open && (
        <div className="lgs-body">
          {owner && (
            <div className="lgs-invite">
              <div className="lgs-l">INVITE LINK</div>
              {invite ? (
                <>
                  <div className="lgs-code-row">
                    <code className="lgs-code">{joinHref(invite.code)}</code>
                    <button type="button" className="lgs-btn" onClick={() => copy(joinHref(invite.code))}>{copied ? 'Copied' : 'Copy'}</button>
                  </div>
                  <div className="lgs-h">
                    Code {invite.code} · {invite.uses}/{invite.maxUses} used · good until {when(invite.expiresAt)}
                  </div>
                  <div className="lgs-actions">
                    <button type="button" className="lgs-btn" disabled={pending} onClick={() => run(() => createInvite(configId))}>New code</button>
                    <button type="button" className="lgs-btn danger" disabled={pending} onClick={() => run(() => revokeInvites(configId))}>Revoke</button>
                  </div>
                </>
              ) : (
                <div className="lgs-actions">
                  <button type="button" className="lgs-btn" disabled={pending} onClick={() => run(() => createInvite(configId))}>Share this league</button>
                  <span className="lgs-h">One link, 14 days, up to 12 joins. Each friend claims their own team.</span>
                </div>
              )}
            </div>
          )}

          <div className="lgs-members">
            <div className="lgs-l">MEMBERS</div>
            <ul>
              {members.map((m) => {
                const me = myUserId != null && Number(m.userId) === Number(myUserId);
                return (
                  <li key={m.userId} className="lgs-m">
                    <span className="lgs-who">{m.name ?? m.handle ?? `user ${m.userId}`}{m.handle ? <span className="lgs-handle"> @{m.handle}</span> : null}</span>
                    <span className="lgs-team">{m.role === 'owner' ? 'owner · ' : ''}{m.slot ? `${m.slot} · ${m.teamName}` : 'no team yet'}</span>
                    {owner && m.role === 'member' && (
                      <button type="button" className="lgs-btn danger" disabled={pending} onClick={() => run(() => kickMember(configId, m.userId))}>Remove</button>
                    )}
                    {!owner && me && (
                      <button type="button" className="lgs-btn danger" disabled={pending} onClick={() => run(() => leaveLeague(configId))}>Leave league</button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="lgs-mocks">
            <div className="lgs-l">YOUR MOCKS</div>
            {mocks.length === 0 ? (
              <div className="lgs-h">No completed mocks of this league yet. Finish one and it shows here - to you only.</div>
            ) : (
              <ul>
                {mocks.map((r) => (
                  <li key={r.draftId} className="lgs-run">
                    <a className="lgs-team" href={`/sim/draft/${r.draftId}`}>as {r.franchise ? `${r.seat} · ${r.franchise}` : `seat ${r.seat}`} · {when(r.completedAt)}</a>
                    <span className="lgs-picks">{(r.firstPicks ?? []).map((p) => p.name).join(', ')}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {err && <div className="lgs-err">{err}</div>}
        </div>
      )}
    </div>
  );
}
