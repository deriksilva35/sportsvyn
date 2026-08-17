'use client';

// components/daily/HandleClaim.js — claim your handle.
//
// THE SMALLEST ISLAND THAT DOES THE JOB. It needs live availability as you
// type, which is a client concern; everything else on the surface stays server
// rendered. Validation runs locally first so the common rejections cost no
// round trip, and the server re-validates because a client check is a courtesy.
//
// SKIP IS OFFERED, deliberately. A forced handle is a wall in front of the
// thing they came for, and Player <hex> is already a working identity: scores
// count, the board lists them, nothing is withheld. The reveal re-offers the
// claim to anyone still unclaimed, which is the moment they have just seen
// their name sitting grey among the handles.

import { useEffect, useRef, useState } from 'react';
import { validateHandle } from '@/lib/daily/handles';
import { checkHandle, claimHandle } from '@/app/actions/handle';

export default function HandleClaim({ onDone = null, current = null, compact = false }) {
  const [value, setValue] = useState(current ?? '');
  const [state, setState] = useState({ kind: 'idle', message: '' });
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const raw = value.trim();
    if (!raw) { setState({ kind: 'idle', message: '' }); return undefined; }

    // Local first: length, charset and the reserved list need no server.
    const v = validateHandle(raw);
    if (!v.ok) { setState({ kind: 'bad', message: v.message }); return undefined; }

    setState({ kind: 'wait', message: 'Checking…' });
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      const r = await checkHandle(raw).catch(() => null);
      // Ignore a response that arrived after a newer keystroke, or the field
      // reports the availability of a name the reader has already changed.
      if (mine !== seq.current) return;
      if (!r) { setState({ kind: 'bad', message: 'Could not check just now.' }); return; }
      setState({ kind: r.ok ? 'ok' : 'bad', message: r.message });
    }, 350);
    return () => clearTimeout(t);
  }, [value]);

  async function submit() {
    setBusy(true);
    const r = await claimHandle(value.trim()).catch(() => null);
    setBusy(false);
    if (!r?.ok) { setState({ kind: 'bad', message: r?.message ?? 'Could not claim that.' }); return; }
    if (onDone) onDone(r.handle);
    else window.location.reload();
  }

  const cls = state.kind === 'ok' ? ' hin--ok' : state.kind === 'bad' ? ' hin--bad' : '';
  return (
    <>
      <div className={`hin${cls}`}>
        <span className="at">@</span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="your_handle"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={15}
          aria-label="Handle"
        />
      </div>
      <div className={`avail avail--${state.kind === 'ok' ? 'ok' : state.kind === 'bad' ? 'bad' : 'wait'}`}>
        {state.message}
      </div>
      {!compact && <div className="muted">3&ndash;15 characters · letters, numbers and underscore</div>}
      <button
        className="btn--volt"
        style={{ marginTop: 12 }}
        disabled={busy || state.kind !== 'ok'}
        onClick={submit}
      >
        {busy ? 'Claiming…' : `Claim @${value.trim() || 'handle'}`}
      </button>
    </>
  );
}
