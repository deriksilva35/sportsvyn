'use client';

// components/leagues/InviteSheet.js - THE SHARE SHEET (Leagues V1, fri-1).
//
// One button opens a bottom sheet holding the league's two doors: the LINK
// (/j/<token>, what rides a group chat) and the six-character CODE (what gets
// read aloud). SHARE goes native first - the app's share bridge
// (lib/shell/bridge.js sendShare), then the browser's navigator.share, then
// the clipboard - so a tap always does something. The OWNER also gets RESET:
// a new link and a new code, the old ones dead (lib/leagues/invite.js
// resetInvite), behind a second tap because it breaks every link already sent.

import { useEffect, useState } from 'react';
import { sendShare } from '@/lib/shell/bridge';
import { resetInviteAction } from '@/app/actions/leagues';

const SITE = 'https://sportsvyn.com';
export const inviteUrl = (key) => `${SITE}/j/${key}`;

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/** Native bridge -> Web Share -> clipboard. Returns 'shared' | 'copied' | null. */
export async function shareInvite({ url, title }) {
  if (sendShare({ url, title })) return 'shared';
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try { await navigator.share({ url, title, text: title }); return 'shared'; } catch (e) {
      if (e?.name === 'AbortError') return null;
    }
  }
  return (await copyText(url)) ? 'copied' : null;
}

export default function InviteSheet({ league, isOwner = false, openInitially = false, label = 'Invite' }) {
  const [open, setOpen] = useState(openInitially);
  const [doors, setDoors] = useState({ code: league.code, token: league.token });
  const [note, setNote] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const url = inviteUrl(doors.token || doors.code);
  const title = `Join ${league.name} on Sportsvyn`;

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const flash = (t) => { setNote(t); setTimeout(() => setNote(null), 1800); };

  async function reset() {
    if (!confirm) { setConfirm(true); return; }
    setBusy(true);
    const res = await resetInviteAction(league.id).catch(() => ({ ok: false, reason: 'Could not reset the invite' }));
    setBusy(false); setConfirm(false);
    if (!res.ok) { flash(res.reason); return; }
    setDoors({ code: res.joinCode, token: res.inviteToken });
    flash('New link and code - the old ones are dead');
  }

  const spots = Math.max(0, Number(league.max) - Number(league.members));

  return (
    <>
      <button type="button" className="lv-btn lv-btn--primary" onClick={() => setOpen(true)} data-invite-open>
        {label}
      </button>
      {open && (
        <div className="lv-scrim" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="lv-sheet" role="dialog" aria-modal="true" aria-label={`Invite to ${league.name}`}>
            <span className="lv-grab" aria-hidden="true" />
            <div className="lv-sheet-head">
              <h2 className="lv-sheet-title">Invite to {league.name}</h2>
              <button type="button" className="lv-x" onClick={() => setOpen(false)}>Done</button>
            </div>
            <div className="lv-linkbox" data-invite-link={url}>
              <span>{url.replace(/^https:\/\//, '')}</span>
            </div>
            <div className="lv-row">
              <button type="button" className="lv-btn lv-btn--primary" onClick={async () => {
                const r = await shareInvite({ url, title });
                if (r === 'copied') flash('Link copied');
              }}>Share</button>
              <button type="button" className="lv-btn" onClick={async () => { if (await copyText(url)) flash('Link copied'); }}>
                Copy link
              </button>
            </div>
            <div className="lv-codebig">
              <span className="lv-note">Or tell them the code</span>
              <b data-invite-code={doors.code}>{doors.code}</b>
            </div>
            <p className="lv-note">
              {league.members} of {league.max} spots taken{spots === 0 ? ' - the league is full' : ''}
              {' · '}{league.lateJoins ? 'Joins stay open after it starts' : league.startLabel ? `Joins close ${league.startLabel}` : 'Joins close when it starts'}
            </p>
            {isOwner && (
              <button type="button" className="lv-reset" onClick={reset} disabled={busy}>
                {busy ? 'Resetting…' : confirm ? 'Tap again: every link already sent stops working' : 'Reset the link and code'}
              </button>
            )}
            {note && <p className="lv-note" role="status">{note}</p>}
          </div>
        </div>
      )}
    </>
  );
}
