'use client';

// components/leagues/LeagueDraftControls.js - the Draft tab's two writes
// (slice 3): claim your franchise (your own draft_config_members row, through
// the existing claimFranchise action) and the owner's "empty seats are bots"
// switch. Both re-render from the server after the write (router.refresh()).

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { claimFranchise } from '@/app/actions/league';
import { setLeagueBotsAction } from '@/app/actions/leagues';
import { REFUSALS } from '@/lib/fantasy/inviteCode';

export function ClaimTeam({ configId, options = [] }) {
  const router = useRouter();
  const [pick, setPick] = useState(options[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  return (
    <form className="lh-claim" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true); setNote(null);
      const res = await claimFranchise(configId, pick).catch(() => ({ ok: false }));
      setBusy(false);
      if (!res?.ok) { setNote(REFUSALS[res?.reason] ?? 'That did not go through - try again'); return; }
      router.refresh();
    }}>
      <label className="lh-claim-label">
        <span className="lv-note">Which team is yours?</span>
        <select value={pick} onChange={(e) => setPick(e.target.value)} disabled={busy} data-claim-select>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </label>
      <button type="submit" className="lv-btn lv-btn--primary" disabled={busy || !pick} data-claim>{busy ? 'Claiming…' : 'Claim'}</button>
      {note && <p className="lv-note" role="status">{note}</p>}
    </form>
  );
}

export function BotsToggle({ leagueId, on }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className="lv-btn" disabled={busy} data-bots-toggle onClick={async () => {
      setBusy(true);
      await setLeagueBotsAction(leagueId, !on).catch(() => null);
      setBusy(false);
      router.refresh();
    }}>{on ? 'Turn bots off' : 'Turn bots on'}</button>
  );
}
