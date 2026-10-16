'use client';

// components/leagues/LeagueMembersControls.js - the Members tab's moving parts
// (league home, thu-4): the invite card's Share link, the owner's menu on a
// member row, the reader's notification toggles, and Leave league.
//
// Every write is a server action (app/actions/leagues.js) that re-checks the
// rule against the rows (lib/leagues/members.js); this file only asks. A
// change re-renders the page from the server (router.refresh()), so a role or a
// removal is shown as the database has it, never as the tap hoped.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { shareInvite, inviteUrl } from '@/components/leagues/InviteSheet';
import {
  setMemberRoleAction, removeMemberAction, leaveLeagueAction, setLeagueNotifyAction,
} from '@/app/actions/leagues';

export function ShareLinkButton({ name, token, code }) {
  const [note, setNote] = useState(null);
  return (
    <>
      <button type="button" className="lv-btn lv-btn--primary lh-share" onClick={async () => {
        const r = await shareInvite({ url: inviteUrl(token || code), title: `Join ${name} on Sportsvyn` });
        if (r === 'copied') { setNote('Link copied'); setTimeout(() => setNote(null), 1800); }
      }}>Share link</button>
      {note && <span className="lh-flash" role="status">{note}</span>}
    </>
  );
}

/** The ⋯ on a member row. items: [{ action, label }] from lib/leagues/members.js menuFor. */
export function MemberMenu({ leagueId, targetId, targetName, items = [] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  if (!items.length) return null;

  async function run(action) {
    if (action === 'remove' && !confirm) { setConfirm(true); return; }
    setBusy(true);
    const res = action === 'remove'
      ? await removeMemberAction(leagueId, targetId)
      : await setMemberRoleAction(leagueId, targetId, action === 'promote' ? 'co_admin' : 'member');
    setBusy(false); setConfirm(false);
    if (!res?.ok) { setNote(res?.reason ?? 'That did not go through'); return; }
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="lh-menu">
      <button type="button" className="lh-menu-btn" aria-label={`Manage ${targetName}`} aria-expanded={open}
        onClick={() => { setOpen((v) => !v); setConfirm(false); setNote(null); }} data-member-menu={targetId}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
          <circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" />
        </svg>
      </button>
      {open && (
        <div className="lh-menu-pop" role="menu">
          {items.map((it) => (
            <button key={it.action} type="button" role="menuitem" disabled={busy}
              className={it.action === 'remove' ? 'lh-menu-item lh-menu-item--danger' : 'lh-menu-item'}
              onClick={() => run(it.action)} data-member-action={it.action}>
              {it.action === 'remove' && confirm ? `Tap again to remove ${targetName}` : it.label}
            </button>
          ))}
          {note && <p className="lv-note" role="status">{note}</p>}
        </div>
      )}
    </div>
  );
}

const TOGGLES = [
  ['chat', 'New chat messages'],
  ['results', 'Daily results in this league'],
  ['joins', 'Someone joins'],
];

/** The reader's own three toggles. Stored now; sending comes with each sender. */
export function NotifyToggles({ leagueId, initial }) {
  const [prefs, setPrefs] = useState(initial ?? { chat: true, results: true, joins: false });
  const [note, setNote] = useState(null);
  async function flip(key, on) {
    const before = prefs;
    setPrefs({ ...prefs, [key]: on });
    const res = await setLeagueNotifyAction(leagueId, { [key]: on });
    if (!res?.ok) { setPrefs(before); setNote(res?.reason ?? 'Could not save that'); return; }
    setPrefs(res.prefs);
  }
  return (
    <div className="lh-toggles">
      {TOGGLES.map(([key, label]) => (
        <label key={key} className="lh-toggle">
          <span>{label}</span>
          <input type="checkbox" checked={!!prefs[key]} onChange={(e) => flip(key, e.target.checked)} data-notify={key} />
        </label>
      ))}
      {note && <p className="lv-note" role="status">{note}</p>}
    </div>
  );
}

export function LeaveLeagueButton({ leagueId, name }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  return (
    <>
      <button type="button" className="lh-leave" disabled={busy} data-leave-league onClick={async () => {
        if (!confirm) { setConfirm(true); return; }
        setBusy(true);
        const res = await leaveLeagueAction(leagueId);
        setBusy(false);
        if (!res?.ok) { setConfirm(false); setNote(res?.reason ?? 'Could not leave'); return; }
        router.push('/leagues');
      }}>{confirm ? `Tap again to leave ${name}` : 'Leave league'}</button>
      {note && <p className="lv-note" role="status">{note}</p>}
    </>
  );
}
