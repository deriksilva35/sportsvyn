'use client';

// components/mockNba/SetupLibrary.js - "League setup" on the NBA mock's setup screen (mon-2).
//
// One dropdown: the reader's saved setups first, then the ESPN-/Yahoo-style
// presets, then Custom (lib/mockNba/setupChoice.js). Signed in: "Save as..." a
// named setup (max 10), and on a saved one Overwrite / Rename / Delete. Guests
// see "Sign in to save your league setup". Writes go through the gated server
// actions in app/actions/mockNba.js; refusals are shown in words (REASON_COPY).

import { useState } from 'react';
import { applyChoice, currentChoice, PRESET_SETUPS, MAX_SETUPS as MAX, NAME_MAX, REASON_COPY as COPY } from '@/lib/mockNba/setupChoice';
import { createMockSetupAction, updateMockSetupAction, deleteMockSetupAction } from '@/app/actions/mockNba';

const say = (r) => COPY[r?.reason] ?? 'Could not save. Try again.';

export default function SetupLibrary({ settings, onApply, signedIn, initialSetups = [] }) {
  const [setups, setSetups] = useState(initialSetups);
  const [chosen, setChosen] = useState(null);
  const [mode, setMode] = useState(null); // 'save' | 'rename' | 'delete'
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const cur = currentChoice(settings, setups, chosen);
  const savedOne = cur.savedId != null ? setups.find((x) => x.id === cur.savedId) : null;

  function choose(v) {
    setChosen(v); setMode(null); setMsg(null);
    if (v !== 'custom') onApply(applyChoice(settings, v, setups));
  }
  const upsert = (s) => setSetups((list) => [s, ...list.filter((x) => x.id !== s.id)]);

  async function run(fn, done) {
    setBusy(true); setMsg(null);
    try {
      const r = await fn();
      if (r?.ok) { done(r); setMode(null); } else setMsg(say(r));
    } catch { setMsg('Could not save. Try again.'); }
    setBusy(false);
  }
  const saveAs = () => run(() => createMockSetupAction(name, settings), (r) => { upsert(r.setup); setChosen(`saved:${r.setup.id}`); setMsg(`Saved "${r.setup.name}".`); });
  const overwrite = () => run(() => updateMockSetupAction(savedOne.id, { settings }), (r) => { upsert(r.setup); setMsg(`Updated "${r.setup.name}".`); });
  const rename = () => run(() => updateMockSetupAction(savedOne.id, { name }), (r) => { upsert(r.setup); setMsg(`Renamed to "${r.setup.name}".`); });
  const remove = () => run(() => deleteMockSetupAction(savedOne.id), () => {
    setSetups((list) => list.filter((x) => x.id !== savedOne.id)); setChosen(null); setMsg(`Deleted "${savedOne.name}".`);
  });

  return (
    <div className="mnb-lib" data-mock-nba-setups>
      <label className="mnb-field">
        <span className="mnb-label">League setup</span>
        <select className="mnb-select" name="setup" value={cur.value} onChange={(e) => choose(e.target.value)} disabled={busy}>
          {setups.length > 0 && (
            <optgroup label="Your setups">
              {setups.map((s) => <option key={s.id} value={`saved:${s.id}`}>{s.name}{cur.edited && cur.savedId === s.id ? ' (edited)' : ''}</option>)}
            </optgroup>
          )}
          <optgroup label="Presets">
            {Object.entries(PRESET_SETUPS).map(([k, p]) => <option key={k} value={`preset:${k}`}>{p.label}</option>)}
          </optgroup>
          {cur.value === 'custom' && <option value="custom">Custom</option>}
        </select>
      </label>

      {!signedIn ? (
        <p className="mnb-lib-note" data-mock-nba-setups-guest>
          <a className="mnb-link" href={`/signin?callbackUrl=${encodeURIComponent('/mock/nba')}`}>Sign in to save your league setup</a>
        </p>
      ) : (
        <>
          {mode == null && (
            <div className="mnb-lib-actions">
              <button type="button" className="mnb-link" onClick={() => { setMode('save'); setName(''); setMsg(null); }} disabled={busy || setups.length >= MAX} data-mock-nba-saveas>Save as...</button>
              {savedOne && cur.edited && <button type="button" className="mnb-link" onClick={overwrite} disabled={busy} data-mock-nba-overwrite>Overwrite &ldquo;{savedOne.name}&rdquo;</button>}
              {savedOne && <button type="button" className="mnb-link" onClick={() => { setMode('rename'); setName(savedOne.name); setMsg(null); }} disabled={busy} data-mock-nba-rename>Rename</button>}
              {savedOne && <button type="button" className="mnb-link" onClick={() => { setMode('delete'); setMsg(null); }} disabled={busy} data-mock-nba-delete>Delete</button>}
              <span className="mnb-saved">{setups.length} of {MAX} saved</span>
            </div>
          )}
          {(mode === 'save' || mode === 'rename') && (
            <form className="mnb-lib-form" onSubmit={(e) => { e.preventDefault(); if (mode === 'save') saveAs(); else rename(); }}>
              <input className="mnb-search" name="setup-name" maxLength={NAME_MAX} autoFocus placeholder="Name this setup" value={name} onChange={(e) => setName(e.target.value)} aria-label="Setup name" />
              <button type="submit" className="dgm-pill dgm-pill--sm dgm-pill--lime" disabled={busy || !name.trim()} data-mock-nba-setup-submit>{mode === 'save' ? 'Save' : 'Rename'}</button>
              <button type="button" className="dgm-pill dgm-pill--sm dgm-pill--outline" onClick={() => setMode(null)} disabled={busy}>Cancel</button>
            </form>
          )}
          {mode === 'delete' && savedOne && (
            <div className="mnb-lib-form">
              <span>Delete &ldquo;{savedOne.name}&rdquo;?</span>
              <button type="button" className="dgm-pill dgm-pill--sm dgm-pill--lime" onClick={remove} disabled={busy} data-mock-nba-delete-yes>Delete</button>
              <button type="button" className="dgm-pill dgm-pill--sm dgm-pill--outline" onClick={() => setMode(null)} disabled={busy}>Keep</button>
            </div>
          )}
          {setups.length >= MAX && mode == null && <p className="mnb-lib-note">{COPY.limit}</p>}
        </>
      )}
      {msg && <p className="mnb-lib-note" role="status" data-mock-nba-setups-msg>{msg}</p>}
    </div>
  );
}
