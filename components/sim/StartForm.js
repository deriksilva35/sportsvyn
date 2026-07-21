'use client';

// Setup screen (lobby v2). A preset DECK over a JetBrains-Mono CONSOLE with a
// live config ticker. Presets seed the console; editing ANY console value flips
// the selection to CUSTOM, which is a member feature. Free users run a preset
// as-is; members edit anything. The console is always explorable, but the START
// bar reflects the real gate: the 3-free limit for presets, membership for custom.
//
// EVERYTHING here is advisory — the server (startDraft / startCustomDraft) re-
// validates the config and re-checks entitlement; the client never gets the last
// word on bounds or membership. rounds/tokens come from the same pure config.js
// the server validates with, so the ticker can't disagree with what will persist.

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { startDraft, startCustomDraft } from '@/app/actions/sim';
import {
  SCORING_FORMATS, SCORING_LABEL, CLOCK_OPTIONS, TEAMS_MIN, TEAMS_MAX, FREE_TEAMS_MAX,
  SLOT_BOUNDS, deriveRounds, rosterTokens, configLocks,
} from '@/lib/fantasy/config';

const SEG_SCORING = SCORING_FORMATS.map((f) => ({ v: f, label: SCORING_LABEL[f] }));
const SEG_CLOCK = CLOCK_OPTIONS.map((s) => ({ v: s, label: s == null ? 'NONE' : `${s}S` }));
// The 8 starter slot steppers, laid out as a 4-col x 2-row grid (label over
// stepper). SUPERFLEX is a member unlock. Bench is a separate single-line row.
const ROSTER_CELLS = [
  { k: 'QB', label: 'QB' }, { k: 'RB', label: 'RB' }, { k: 'WR', label: 'WR' }, { k: 'TE', label: 'TE' },
  { k: 'FLEX', label: 'FLX' }, { k: 'SUPERFLEX', label: 'SFLX' }, { k: 'DST', label: 'DST' }, { k: 'K', label: 'K' },
];

function presetToConfig(p) {
  return {
    teamsCount: p.teams_count,
    scoringFormat: p.scoring_format,
    clockSeconds: p.pick_timer_seconds ?? null,
    rosterSlots: { ...p.roster_slots },
  };
}

// Deep-equal a working config against a preset's, so editing back to a preset's
// exact shape snaps the selection (and the free path) back to that preset.
function sameConfig(a, b) {
  if (a.teamsCount !== b.teamsCount || a.scoringFormat !== b.scoringFormat) return false;
  if ((a.clockSeconds ?? null) !== (b.clockSeconds ?? null)) return false;
  const keys = new Set([...Object.keys(a.rosterSlots), ...Object.keys(b.rosterSlots)]);
  for (const k of keys) if ((a.rosterSlots[k] || 0) !== (b.rosterSlots[k] || 0)) return false;
  return true;
}

export default function StartForm({ presets, canStart, used, limit, member = false, shell = false }) {
  const router = useRouter();
  const first = presets[0];
  const [config, setConfig] = useState(() => presetToConfig(first));
  const [selection, setSelection] = useState(first.id); // preset id | 'custom'
  const [seat, setSeat] = useState('random');
  const [auto, setAuto] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState(null);
  const [freeGated, setFreeGated] = useState(!canStart); // 3-free limit hit (presets)

  const rounds = useMemo(() => deriveRounds(config.rosterSlots), [config.rosterSlots]);
  const tokens = useMemo(() => rosterTokens(config.rosterSlots), [config.rosterSlots]);
  const locks = useMemo(() => configLocks(config), [config]);
  const isCustom = selection === 'custom';
  const N = config.teamsCount;
  const clockLabel = config.clockSeconds == null ? 'NONE' : `${config.clockSeconds}S`;

  // Any edit resolves the selection: snap to a matching preset, else CUSTOM.
  function apply(next) {
    const match = presets.find((p) => sameConfig(next, presetToConfig(p)));
    setSelection(match ? match.id : 'custom');
    setConfig(next);
    setErr(null);
  }
  function choosePreset(p) { setSelection(p.id); setConfig(presetToConfig(p)); setErr(null); }

  const teamsMax = member ? TEAMS_MAX : FREE_TEAMS_MAX; // >12 is a member unlock
  function stepTeams(d) {
    const v = Math.max(TEAMS_MIN, Math.min(teamsMax, N + d));
    if (v !== N) { const c = { ...config, teamsCount: v }; if (seat !== 'random' && Number(seat) > v) setSeat('random'); apply(c); }
  }
  function setScoring(v) { apply({ ...config, scoringFormat: v }); }
  function setClock(v) { apply({ ...config, clockSeconds: v }); }
  function stepSlot(k, d) {
    const [lo, hiBase] = SLOT_BOUNDS[k];
    const hi = k === 'SUPERFLEX' && !member ? 0 : hiBase; // superflex is a member unlock
    const cur = config.rosterSlots[k] || 0;
    const v = Math.max(lo, Math.min(hi, cur + d));
    if (v === cur) return;
    const slots = { ...config.rosterSlots };
    if (v > 0) slots[k] = v; else delete slots[k];
    apply({ ...config, rosterSlots: slots });
  }

  const memberBlocked = isCustom && !member; // custom needs membership
  function go() {
    if (freeGated && !isCustom) return; // preset path is out of free drafts
    if (memberBlocked) return;          // custom needs membership; START is disabled
    setErr(null);
    start(async () => {
      const res = isCustom
        ? await startCustomDraft(config, seat, { auto })
        : await startDraft(selection, seat, { auto });
      if (!res.ok) {
        if (res.reason === 'entitlement') { setFreeGated(true); return; }
        if (res.reason === 'entitlement_custom') { setErr('Custom drafts are a member feature.'); return; }
        if (res.reason === 'unauthenticated') { router.push('/signin?callbackUrl=/sim'); return; }
        setErr(res.reason === 'invalid_config' ? `That config isn't valid (${res.detail}).` : `Could not start: ${res.reason}`);
        return;
      }
      router.push(`/sim/draft/${res.draftId}`);
    });
  }

  // One compact note line (replaces the volt member-pitch slab, which is dropped
  // on this screen - the locked controls, the CUSTOM card, and the locked START
  // button already carry the pitch). Errors win, then the gate, then the custom
  // nearest-pool notice.
  const note = err
    ? err
    : freeGated && !isCustom
      ? `You've used your ${limit} free drafts. Members draft unlimited.`
      : memberBlocked
        ? 'Custom rosters, 14+ teams, and superflex are member features.'
        : (isCustom && member && (locks.oversize || locks.superflex))
          ? `Custom: ${[locks.oversize && `${N} teams`, locks.superflex && 'superflex'].filter(Boolean).join(' · ')}. ADP maps to the nearest market pool.`
          : null;
  const gated = (freeGated && !isCustom) || memberBlocked;

  return (
    <div className="setup">
      {/* header: title + live summary. START moved to a full-width bottom bar. */}
      <div className="setup-head">
        <div className="setup-title">New draft</div>
        <div className="setup-sum">{N}-TEAM · {SCORING_LABEL[config.scoringFormat]} · {clockLabel} · {rounds} ROUNDS</div>
      </div>

      {/* preset deck */}
      <div className="chiplab">Start from</div>
      <div className="deck">
        {presets.map((p) => (
          <button key={p.id} type="button" className={`pcard${selection === p.id ? ' on' : ''}`} onClick={() => choosePreset(p)}>
            <div className="pn">{p.name}</div>
            <div className="pm">{p.teams_count} teams · {SCORING_LABEL[p.scoring_format] ?? p.scoring_format.toUpperCase()} · {p.pick_timer_seconds ? `${p.pick_timer_seconds}s` : 'no clock'}</div>
          </button>
        ))}
        <button
          type="button"
          className={`pcard cust${isCustom ? ' on' : ''}`}
          onClick={() => (member ? setSelection('custom') : setErr('Custom drafts are a member feature.'))}
        >
          <div className="pn cust">CUSTOM</div>
          <div className="pm cust">Your rules</div>
          {!member && <span className="pl lock">MEMBER</span>}
        </button>
      </div>

      {/* console (the internal scroll region when the viewport is too short) */}
      <div className="console">
        <div className="crow">
          <div className="ck">TEAMS</div>
          <div className="cv">
            <Stepper value={N} onDec={() => stepTeams(-1)} onInc={() => stepTeams(1)} atMin={N <= TEAMS_MIN} atMax={N >= teamsMax} />
            {!member && <span className="copt locked push">UP TO 16</span>}
          </div>
        </div>
        <div className="crow">
          <div className="ck">SCORING</div>
          <div className="cv">{SEG_SCORING.map((o) => (
            <button key={o.v} type="button" className={`copt${config.scoringFormat === o.v ? ' on' : ''}`} onClick={() => setScoring(o.v)}>{o.label}</button>
          ))}</div>
        </div>
        <div className="crow">
          <div className="ck">CLOCK</div>
          <div className="cv">{SEG_CLOCK.map((o) => (
            <button key={String(o.v)} type="button" className={`copt${(config.clockSeconds ?? null) === o.v ? ' on' : ''}`} onClick={() => setClock(o.v)}>{o.label}</button>
          ))}</div>
        </div>
        {/* roster: 8 starter steppers in one 4-col grid (two rows) */}
        <div className="crow rostercrow">
          <div className="ck">ROSTER</div>
          <div className="rgrid">
            {ROSTER_CELLS.map((c) => (
              <LabeledStep
                key={c.k}
                label={c.label}
                value={config.rosterSlots[c.k] || 0}
                disabled={c.k === 'SUPERFLEX' && !member}
                onDec={() => stepSlot(c.k, -1)}
                onInc={() => stepSlot(c.k, 1)}
              />
            ))}
          </div>
        </div>
        <div className="crow">
          <div className="ck">BENCH</div>
          <div className="cv">
            <Stepper value={config.rosterSlots.BN || 0} onDec={() => stepSlot('BN', -1)} onInc={() => stepSlot('BN', 1)} />
          </div>
        </div>
        <div className="crow">
          <div className="ck">BOARD</div>
          <div className="cv">
            <span className="copt on">MARKET ADP</span>
            <span className="copt locked" title="Ships with the August rankings">SPORTSVYN — AUG</span>
          </div>
        </div>
        <div className="crow">
          <div className="ck">SEAT</div>
          <div className="cv seatrow">
            <select className="seatsel" value={seat} onChange={(e) => setSeat(e.target.value)}>
              <option value="random">RANDOM</option>
              {Array.from({ length: N }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
            </select>
            <label className="autolab"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> FULL-AUTO</label>
          </div>
        </div>
      </div>

      <div className="ticker">▸ {N}-TEAM · {SCORING_LABEL[config.scoringFormat]} · {clockLabel} · {tokens.join(' ')} · {rounds} ROUNDS</div>
      <div className="setup-attr">ADP · <u>Fantasy Football Calculator</u></div>

      {/* full-width START bar, pinned to the bottom of the viewport (above the
          tab bar); the gate note sits directly above it. */}
      <div className="setup-foot">
        {note && <div className={`setup-note${gated ? ' gated' : ''}`}>{note}</div>}
        {freeGated && !isCustom ? (
          <a className="startbtn bar locked" href="/membership" {...(shell ? { target: '_blank', rel: 'noopener noreferrer', 'data-external': '' } : {})}>BECOME A MEMBER →</a>
        ) : memberBlocked ? (
          <button className="startbtn bar locked" type="button" onClick={() => setErr('Custom drafts are a member feature.')}>MEMBERS ONLY — CUSTOM</button>
        ) : (
          <button className="startbtn bar" type="button" onClick={go} disabled={pending}>{pending ? 'STARTING…' : 'START DRAFT →'}</button>
        )}
      </div>
    </div>
  );
}

function Stepper({ value, onDec, onInc, atMin = false, atMax = false }) {
  return (
    <span className="cstep">
      <button type="button" onClick={onDec} disabled={atMin} aria-label="decrease">−</button>
      <span className="cn">{value}</span>
      <button type="button" onClick={onInc} disabled={atMax} aria-label="increase">+</button>
    </span>
  );
}

function LabeledStep({ label, value, onDec, onInc, disabled = false }) {
  return (
    <span className={`lstep${disabled ? ' off' : ''}`}>
      <span className="ll">{label}</span>
      <span className="cstep">
        <button type="button" onClick={onDec} disabled={disabled} aria-label={`decrease ${label}`}>−</button>
        <span className="cn">{value}</span>
        <button type="button" onClick={onInc} disabled={disabled} aria-label={`increase ${label}`}>+</button>
      </span>
    </span>
  );
}
