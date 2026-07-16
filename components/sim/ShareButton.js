'use client';
// components/sim/ShareButton.js — results share control. In the native sim shell
// it fires the share bridge (iOS share sheet); on web (or with no container) it
// falls back to the existing behavior — opening the share-card URL in a new tab.
import { sendShare } from '@/lib/shell/bridge';

export default function ShareButton({ url, title, children }) {
  return (
    <a
      className="share-btn"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        // Native share needs an absolute URL; the href stays relative for the
        // web fallback (the browser resolves it against the current origin).
        const abs = typeof window !== 'undefined' ? new URL(url, window.location.origin).href : url;
        if (sendShare({ url: abs, title })) e.preventDefault();
      }}
    >
      {children}
    </a>
  );
}
