'use client';

// Lobby start form. Preset cards + seat selector (Random default) + full-auto
// toggle + Start -> startDraft server action -> route to the room (or results,
// for auto). If the entitlement gate is hit (server-side truth), renders the
// upgrade slab instead of the Start control.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { startDraft } from '@/app/actions/sim';

export default function StartForm({ presets, canStart, used, limit }) {
  const router = useRouter();
  const [presetId, setPresetId] = useState(presets[0]?.id ?? null);
  const [seat, setSeat] = useState('random');
  const [auto, setAuto] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState(null);
  const [gated, setGated] = useState(!canStart);

  const preset = presets.find((p) => p.id === presetId) ?? presets[0];
  const N = preset?.teams_count ?? 12;

  function go() {
    setErr(null);
    start(async () => {
      const res = await startDraft(presetId, seat, { auto });
      if (!res.ok) {
        if (res.reason === 'entitlement') { setGated(true); return; }
        if (res.reason === 'unauthenticated') { router.push('/signin?callbackUrl=/sim'); return; }
        setErr(res.reason);
        return;
      }
      router.push(`/sim/draft/${res.draftId}`); // completed autos land on results (same route)
    });
  }

  return (
    <div>
      <div className="sim-used">{gated
        ? <><b>{used}</b> of {limit} free drafts used</>
        : <><b>{used ?? 0}</b> of {limit} free drafts used</>}</div>

      <div className="sim-presets">
        {presets.map((p) => (
          <button key={p.id} type="button" className={`sim-preset${p.id === presetId ? ' sel' : ''}`} onClick={() => setPresetId(p.id)}>
            <div className="nm">{p.name}</div>
            <div className="meta">{p.teams_count} teams · {p.scoring_format.toUpperCase()} · {p.pick_timer_seconds ? `${p.pick_timer_seconds}s clock` : 'no clock'}</div>
          </button>
        ))}
      </div>

      {gated ? (
        <div className="sim-upgrade">
          <h3>You&apos;ve used your free drafts</h3>
          <p>Members get unlimited mock drafts, the full Read, and saved history. Upgrade to keep drafting.</p>
          {/* TODO(membership): membership page does not exist yet — placeholder href. */}
          <a href="/membership">Become a member →</a>
        </div>
      ) : (
        <div className="sim-controls">
          <label>Seat
            <select value={seat} onChange={(e) => setSeat(e.target.value)} style={{ marginLeft: 8 }}>
              <option value="random">Random</option>
              {Array.from({ length: N }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
            </select>
          </label>
          <label className="sim-toggle"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Full-auto (sim the whole draft)</label>
          <button className="sim-start" onClick={go} disabled={pending}>{pending ? 'Starting…' : 'Start draft'}</button>
          {err && <span className="p-err">Could not start: {err}</span>}
        </div>
      )}
    </div>
  );
}
