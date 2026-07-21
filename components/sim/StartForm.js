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
const STARTER_STEPS = [ // roster steppers, grouped as the console rows
  [{ k: 'QB' }, { k: 'RB' }, { k: 'WR' }],
  [{ k: 'TE' }, { k: 'FLEX' }, { k: 'DST' }, { k: 'K' }],
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

  return (
    <div className="setup">
      <div className="setup-used"><b>{used ?? 0}</b> of {limit} free drafts used</div>

      {/* preset deck */}
      <div className="chiplab">Start from</div>
      <div className="deck">
        {presets.map((p) => (
          <button key={p.id} type="button" className={`pcard${selection === p.id ? ' on' : ''}`} onClick={() => choosePreset(p)}>
            <div className="pn">{p.name}</div>
            <div className="pm">{p.teams_count} teams · {SCORING_LABEL[p.scoring_format] ?? p.scoring_format.toUpperCase()}<br />{p.pick_timer_seconds ? `${p.pick_timer_seconds}s clock` : 'No clock'}</div>
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

      {/* console */}
      <div className="chiplab">The console — edit anything</div>
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
        {STARTER_STEPS.map((group, gi) => (
          <div className="crow" key={gi}>
            <div className="ck">{group.map((g) => g.k === 'FLEX' ? 'FLX' : g.k === 'DST' ? 'D' : g.k).join('·')}</div>
            <div className="cv">{group.map((g) => (
              <LabeledStep key={g.k} label={g.k === 'FLEX' ? 'FLX' : g.k} value={config.rosterSlots[g.k] || 0}
                onDec={() => stepSlot(g.k, -1)} onInc={() => stepSlot(g.k, 1)} />
            ))}</div>
          </div>
        ))}
        <div className="crow">
          <div className="ck">BENCH</div>
          <div className="cv">
            <Stepper value={config.rosterSlots.BN || 0} onDec={() => stepSlot('BN', -1)} onInc={() => stepSlot('BN', 1)} />
            <span className="sflex">
              <LabeledStep label="SFLEX" value={config.rosterSlots.SUPERFLEX || 0} disabled={!member}
                onDec={() => stepSlot('SUPERFLEX', -1)} onInc={() => stepSlot('SUPERFLEX', 1)} />
              {!member && <span className="lockmark" title="Members">▮</span>}
            </span>
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

      {isCustom && !member && (
        <div className="memnote">
          <div className="m1">Your rules are a member thing.</div>
          <div className="m2">CUSTOM ROSTERS · 14+ TEAMS · SUPERFLEX · THE SPORTSVYN BOARD</div>
        </div>
      )}
      {isCustom && member && (locks.oversize || locks.superflex) && (
        <div className="setup-note">Custom: {[locks.oversize && `${N} teams`, locks.superflex && 'superflex'].filter(Boolean).join(' · ')}. ADP maps to the nearest market pool.</div>
      )}

      {/* commit bar */}
      <div className="commit">
        <div className="csum"><b>{N}-TEAM · {SCORING_LABEL[config.scoringFormat]} · {clockLabel} · {rounds} ROUNDS</b></div>
        {freeGated && !isCustom ? (
          <div className="setup-upgrade">
            <span>You&apos;ve used your {limit} free drafts.</span>
            {/* TODO(membership): /membership does not exist yet. */}
            <a href="/membership" {...(shell ? { target: '_blank', rel: 'noopener noreferrer', 'data-external': '' } : {})}>Become a member →</a>
          </div>
        ) : memberBlocked ? (
          <button className="startbtn locked" type="button" onClick={() => setErr('Custom drafts are a member feature.')}>MEMBERS ONLY — CUSTOM</button>
        ) : (
          <button className="startbtn" type="button" onClick={go} disabled={pending}>{pending ? 'STARTING…' : 'START DRAFT →'}</button>
        )}
        {err && <div className="setup-err">{err}</div>}
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
