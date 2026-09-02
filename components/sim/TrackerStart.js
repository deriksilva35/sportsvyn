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
import { startTrackerDraft } from '@/app/actions/sim';
import SeatStrip from './SeatStrip';
import {
  SCORING_FORMATS, SCORING_LABEL, TEAMS_MIN, TEAMS_MAX,
  SLOT_BOUNDS, ROSTER_CELLS, deriveRounds,
} from '@/lib/fantasy/config';

// The most common real-league shape - QB1 RB2 WR2 TE1 FLX1 DST1 K1 + 6 bench
// = 15 rounds. It used to be a HARDCODED assumption ("the roster is the part
// people change least"); v0.3.1 ruled that a tracker mirrors a REAL league and
// real leagues vary, so this is now the console's STARTING POINT, fully
// editable below - and pre-filled by the Mock handoff when one is riding the
// URL.
const DEFAULT_SLOTS = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BN: 6 };

const ERR = {
  // Unreachable since the teardown - the server no longer returns this reason.
  // Kept so an older client that still sends it gets a sentence rather than a
  // blank, and reworded so the sentence is not a lie if it ever renders.
  entitlement_tracker: 'Tracker mode is unavailable right now.',
  labels_length: 'One name per team, or leave them all blank',
  labels_not_array: 'Team names could not be read',
  invalid_config: 'Check the league settings',
  no_pool: 'No ADP pool is available yet',
  pool_too_small: 'That league is bigger than the current ADP pool',
  bad_position: 'Pick a seat between 1 and the league size',
  unauthenticated: 'Please sign in',
};

export default function TrackerStart({ entitled, shell = false, iap = false, initial = null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // `initial` is the Mock handoff (already validated server-side by
  // parseTrackerHandoff - all-or-nothing, so its presence means every field
  // is usable). The seat is never carried: picking it is this screen's job.
  const [teams, setTeams] = useState(initial?.teamsCount ?? 12);
  const [scoring, setScoring] = useState(initial?.scoringFormat ?? 'ppr');
  const [seat, setSeat] = useState(1);
  const [slots, setSlots] = useState(() => ({ ...(initial?.rosterSlots ?? DEFAULT_SLOTS) }));
  const rounds = deriveRounds(slots);

  function stepSlot(k, d) {
    const [lo, hi] = SLOT_BOUNDS[k];
    setSlots((cur) => {
      const next = Math.min(hi, Math.max(lo, (cur[k] || 0) + d));
      const out = { ...cur };
      if (next > 0) out[k] = next; else delete out[k];
      return out;
    });
  }
  const [names, setNames] = useState({});      // teamIndex -> label
  const [showNames, setShowNames] = useState(false);
  const [err, setErr] = useState(null);

  // THE ANCHOR IS ON BOTH BRANCHES. The welcome sheet's "Set up the Tracker"
  // link scrolls here, and the people it is aimed at are precisely the ones who
  // land in THIS branch - a new account owns no Pass. Putting the id only on the
  // entitled return would have made the link a dead tap for everybody it was
  // written for.
  // THE WALL IS GONE. This returned MembershipCard variant="tracker" to anyone
  // without a Pass - a price, an UNLOCK button and a RESTORE PURCHASE row in
  // front of a feature that is now free. `entitled` is still accepted as a prop
  // so every call site keeps compiling, and lib/membership.js still resolves it
  // for the account badge; it simply no longer decides anything here.
  //
  // The page goes straight to setup for everybody.

  const setName = (i, v) => setNames((n) => ({ ...n, [i]: v }));

  function submit() {
    setErr(null);
    // Send labels only if at least one was typed; an all-blank set is "unlabelled"
    // and normalizeTeamLabels collapses it to null server-side anyway.
    const arr = Array.from({ length: teams }, (_, i) => names[i] ?? '');
    const labels = arr.some((s) => s.trim().length > 0) ? arr : null;
    const config = { teamsCount: teams, scoringFormat: scoring, clockSeconds: null, rosterSlots: slots };

    startTransition(async () => {
      const res = await startTrackerDraft(config, seat, labels);
      if (!res.ok) { setErr(res.reason); return; }
      router.push(`/sim/draft/${res.draftId}`);
    });
  }

  return (
    <section className="trk-start" id="tracker-start">
      <div className="sim-kicker">Tracker mode</div>
      <p className="trk-start-pitch">
        Bring it to your draft. Log every team&apos;s pick as it happens and keep your roster,
        your open slots, and the value on each pick in front of you.
      </p>

      {/* INLINE HINTS. Every field here is asked BEFORE the user has seen what
          the Tracker does, so each one says what it is for rather than just what
          it is - a new account should not have to guess whether TEAMS means the
          league size or the names, or whether the seat can be changed later. */}
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
      </div>
      {/* THE SEAT IS A STRIP, the same control the league card uses (084).
          THE LABEL IS A TRANSCRIPTION FACT, NOT A PREFERENCE (ruling, 2 Sep):
          the tracker mirrors a real draft, so this is where you actually sit
          in it - which is why it does not say "this run only" like the Mock. */}
      <SeatStrip
        teams={teams}
        seat={seat}
        onChange={setSeat}
        label="YOUR COLUMN ON THE BOARD"
        hint="Pick where your live league drafts from."
      />

      <div className="trk-hint">How many seats, how it scores, and where you pick - all editable on draft night.</div>

      {/* THE ROSTER CONSOLE (v0.3.1) - the same cells the Mock renders, from
          the same ROSTER_CELLS definition, because a tracker mirrors a REAL
          league and real leagues are not all QB1/RB2/WR2. Locked once the
          draft starts: rounds derive from this and the grid is built from
          rounds, so a mid-draft change would reshape the board under
          everyone's picks. Set it before the first card goes up. */}
      <div className="console trk-console">
      <div className="crow rostercrow trk-roster">
        <div className="ck">ROSTER</div>
        <div className="rgrid">
          {ROSTER_CELLS.map((c) => (
            <span className="lstep" key={c.k}>
              <span className="ll">{c.label}</span>
              <span className="cstep">
                <button type="button" onClick={() => stepSlot(c.k, -1)} disabled={(slots[c.k] || 0) <= SLOT_BOUNDS[c.k][0]} aria-label={`fewer ${c.label}`}>−</button>
                <span className="cn">{slots[c.k] || 0}</span>
                <button type="button" onClick={() => stepSlot(c.k, 1)} disabled={(slots[c.k] || 0) >= SLOT_BOUNDS[c.k][1]} aria-label={`more ${c.label}`}>+</button>
              </span>
            </span>
          ))}
        </div>
      </div>
      <div className="crow trk-roster">
        <div className="ck">BENCH</div>
        <div className="cv">
          <span className="cstep">
            <button type="button" onClick={() => stepSlot('BN', -1)} disabled={(slots.BN || 0) <= 0} aria-label="fewer bench">−</button>
            <span className="cn">{slots.BN || 0}</span>
            <button type="button" onClick={() => stepSlot('BN', 1)} disabled={(slots.BN || 0) >= SLOT_BOUNDS.BN[1]} aria-label="more bench">+</button>
          </span>
        </div>
      </div>
      </div>
      <div className="setup-sum trk-sum">{teams}-TEAM · {SCORING_LABEL[scoring]} · {rounds} ROUNDS</div>
      <div className="trk-hint">Match your league&apos;s lineup - rounds follow the roster. Locked once the draft starts.</div>

      <button type="button" className="trk-start-names" onClick={() => setShowNames((v) => !v)}>
        {showNames ? '- hide team names' : '+ add team names (optional)'}
      </button>
      {showNames && (
        <>
        <div className="trk-hint">Name the teams in your league (editable on draft night).</div>
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
        </>
      )}

      {err && <div className="trk-err">{ERR[err] ?? err}</div>}

      <button type="button" className="sim-cta" onClick={submit} disabled={pending}>
        {pending ? 'STARTING…' : 'START TRACKING'}
      </button>
      <p className="sim-cta-note">
        No clock and no AI - you record every pick.
      </p>
    </section>
  );
}
