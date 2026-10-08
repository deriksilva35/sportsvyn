'use client';

// components/leagues/PickFormatSwitch.js - the commissioner's Pick'em format
// control on the league page (S2). Two taps: the offer, then the confirm - the
// one-time switch cannot be taken back. The rules are lib/leagues/pickFormat.js's;
// the server re-checks all of them.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { setLeaguePickFormatAction, undoPendingPickFormatAction } from '@/app/actions/leagues';
import { PICK_FORMAT_LABEL, PICK_FORMAT_LOCK_NOTE } from '@/lib/leagues/pickFormat';

/** The queued change: "Switches to X next season" and its Undo (commissioner only). */
export function PendingPickFormat({ leagueId, line, canUndo }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  async function undo() {
    setBusy(true); setErr(null);
    const res = await undoPendingPickFormatAction(leagueId).catch(() => ({ ok: false, reason: 'Could not undo the change' }));
    setBusy(false);
    if (!res.ok) { setErr(res.reason); return; }
    router.refresh();
  }
  return (
    <div className="lv-pfswitch" data-pick-format-pending>
      <p className="lv-note">{line}</p>
      {canUndo && <button type="button" className="lv-btn" disabled={busy} onClick={undo}>{busy ? 'Undoing…' : 'Undo'}</button>}
      {err && <p className="lv-err" role="alert">{err}</p>}
    </div>
  );
}

// showNote: with two offers (S3: regular -> ATS or Confidence) the lock note is the
// same sentence for both, so the league page prints it over the first one only.
export default function PickFormatSwitch({ leagueId, to, kind, showNote = true }) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const label = PICK_FORMAT_LABEL[to];
  const note = kind === 'switch'
    ? `One time only. ${label} scoring starts with the week of Oct 20 (or the next week not yet under way); earlier weeks stay as they were scored.`
    : PICK_FORMAT_LOCK_NOTE;

  async function go() {
    setBusy(true); setErr(null);
    const res = await setLeaguePickFormatAction(leagueId, to).catch(() => ({ ok: false, reason: 'Could not change the format' }));
    setBusy(false);
    if (!res.ok) { setErr(res.reason); setArmed(false); return; }
    router.refresh();
  }

  return (
    <div className="lv-pfswitch" data-pick-format-switch={kind}>
      {showNote && <p className="lv-note">{note}</p>}
      {armed ? (
        <span className="lv-pfswitch-row">
          <button type="button" className="lv-btn lv-btn--primary" disabled={busy} onClick={go}>
            {busy ? 'Switching…' : kind === 'queue' ? `Confirm: ${label} next season` : `Confirm: score ${label}`}
          </button>
          <button type="button" className="lv-btn" disabled={busy} onClick={() => setArmed(false)}>Cancel</button>
        </span>
      ) : (
        <button type="button" className="lv-btn" onClick={() => setArmed(true)}>Switch to {label}</button>
      )}
      {err && <p className="lv-err" role="alert">{err}</p>}
    </div>
  );
}
