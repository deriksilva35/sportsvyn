'use client';

// components/sim/TrackerStart.js — the tracker entry point in the sim lobby.
//
// A SEPARATE card rather than a mode switch inside StartForm: StartForm is a
// one-viewport locked console (see the <=900px block in sim.css) whose every row
// is sized to fit without scrolling, and tracker needs inputs StartForm has no
// room for (seat names for up to 16 managers). Two products, two entry cards.
//
// Non-entitled users get MembershipCard variant="tracker" instead of the form.
// That is presentation only — startTrackerDraftFor re-checks the entitlement
// server-side and returns 'entitlement_tracker' regardless of what renders here.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import MembershipCard from './MembershipCard';
import { startTrackerDraft } from '@/app/actions/sim';
import { SCORING_FORMATS, SCORING_LABEL, TEAMS_MIN, TEAMS_MAX } from '@/lib/fantasy/config';

// The shipped standard shape. A tracker draft mirrors a real league, but the
// roster is the part people change least, so this is the default rather than a
// full console. Rounds = 15.
const DEFAULT_SLOTS = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BN: 6 };

const ERR = {
  entitlement_tracker: 'Tracker mode needs the Draft Pass',
  labels_length: 'One name per team, or leave them all blank',
  labels_not_array: 'Team names could not be read',
  invalid_config: 'Check the league settings',
  no_pool: 'No ADP pool is available yet',
  pool_too_small: 'That league is bigger than the current ADP pool',
  bad_position: 'Pick a seat between 1 and the league size',
  unauthenticated: 'Please sign in',
};

export default function TrackerStart({ entitled, shell = false, iap = false }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [teams, setTeams] = useState(12);
  const [scoring, setScoring] = useState('ppr');
  const [seat, setSeat] = useState(1);
  const [names, setNames] = useState({});      // teamIndex -> label
  const [showNames, setShowNames] = useState(false);
  const [err, setErr] = useState(null);

  if (!entitled) {
    return (
      <section className="trk-start">
        <div className="sim-kicker">Tracker mode</div>
        <MembershipCard variant="tracker" shell={shell} iap={iap} onBackToPresets={() => router.push('/sim')} />
      </section>
    );
  }

  const setName = (i, v) => setNames((n) => ({ ...n, [i]: v }));

  function submit() {
    setErr(null);
    // Send labels only if at least one was typed; an all-blank set is "unlabelled"
    // and normalizeTeamLabels collapses it to null server-side anyway.
    const arr = Array.from({ length: teams }, (_, i) => names[i] ?? '');
    const labels = arr.some((s) => s.trim().length > 0) ? arr : null;
    const config = { teamsCount: teams, scoringFormat: scoring, clockSeconds: null, rosterSlots: DEFAULT_SLOTS };

    startTransition(async () => {
      const res = await startTrackerDraft(config, seat, labels);
      if (!res.ok) { setErr(res.reason); return; }
      router.push(`/sim/draft/${res.draftId}`);
    });
  }

  return (
    <section className="trk-start">
      <div className="sim-kicker">Tracker mode</div>
      <p className="trk-start-pitch">
        Bring it to your draft. Log every team&apos;s pick as it happens and keep your roster,
        your open slots, and the value on each pick in front of you.
      </p>

      <div className="trk-start-row">
        <label>
          <span>TEAMS</span>
          <select value={teams} onChange={(e) => {
            const n = Number(e.target.value);
            setTeams(n);
            if (seat > n) setSeat(n); // never leave the seat outside the league
          }}>
            {Array.from({ length: TEAMS_MAX - TEAMS_MIN + 1 }, (_, i) => TEAMS_MIN + i)
              .map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label>
          <span>SCORING</span>
          <select value={scoring} onChange={(e) => setScoring(e.target.value)}>
            {SCORING_FORMATS.map((f) => <option key={f} value={f}>{SCORING_LABEL[f]}</option>)}
          </select>
        </label>
        <label>
          <span>YOUR SEAT</span>
          <select value={seat} onChange={(e) => setSeat(Number(e.target.value))}>
            {Array.from({ length: teams }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>

      <button type="button" className="trk-start-names" onClick={() => setShowNames((v) => !v)}>
        {showNames ? '- hide team names' : '+ add team names (optional)'}
      </button>
      {showNames && (
        <div className="trk-start-grid">
          {Array.from({ length: teams }, (_, i) => (
            <label key={i}>
              <span>{i + 1}{i + 1 === seat ? ' · YOU' : ''}</span>
              <input
                value={names[i] ?? ''}
                onChange={(e) => setName(i, e.target.value)}
                placeholder={i + 1 === seat ? 'You' : `Team ${i + 1}`}
                maxLength={24}
                autoComplete="off"
              />
            </label>
          ))}
        </div>
      )}

      {err && <div className="trk-err">{ERR[err] ?? err}</div>}

      <button type="button" className="sim-cta" onClick={submit} disabled={pending}>
        {pending ? 'STARTING…' : 'START TRACKING'}
      </button>
      <p className="sim-cta-note">
        No clock and no AI - you record every pick. Tracked drafts do not use your free drafts.
      </p>
    </section>
  );
}
