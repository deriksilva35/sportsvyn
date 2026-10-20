'use client';

// "Share" on a per-game Draft result: the system share sheet when there is one,
// else the clipboard. Text only (the house rule since 6 Oct: a files/text share
// carries no url). `label` and `className` let the Nightly finish screen wear it.

import { useState } from 'react';

export default function ShareDraftGame({ text, label = 'Share', className = 'dgm-pill dgm-pill--lime' }) {
  const [done, setDone] = useState(null);
  async function go() {
    try {
      if (typeof navigator !== 'undefined' && navigator.share) { await navigator.share({ text }); return; }
      await navigator.clipboard.writeText(text);
      setDone('Copied');
    } catch { /* the reader closed the sheet */ }
  }
  return (
    <button type="button" className={className} onClick={go}>{done ?? label}</button>
  );
}
