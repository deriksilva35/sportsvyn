'use client';

// "Share" on a per-game Draft result: the system share sheet when there is one,
// else the clipboard. Text only (the house rule since 6 Oct: a files/text share
// carries no url).

import { useState } from 'react';

export default function ShareDraftGame({ text }) {
  const [done, setDone] = useState(null);
  async function go() {
    try {
      if (typeof navigator !== 'undefined' && navigator.share) { await navigator.share({ text }); return; }
      await navigator.clipboard.writeText(text);
      setDone('Copied');
    } catch { /* the reader closed the sheet */ }
  }
  return (
    <button type="button" className="dgm-pill dgm-pill--lime" onClick={go}>{done ?? 'Share'}</button>
  );
}
