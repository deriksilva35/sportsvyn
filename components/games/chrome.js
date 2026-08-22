// components/games/chrome.js - the games' shared card grammar: hook lines
// with bold nouns, meta chips, pulse lines. ONE definition; the lobby and
// the Daily page both render through these, pinned by test - a hand-copied
// chip in either surface is the ROSTER_CELLS drift all over again.
//
// Server-safe: plain spans, no state. The CSS rides in with this module so
// every consumer gets the one stylesheet.

import './chrome.css';

/** '**bold** rest' -> spans. The hook copy lives in GAME_META; this only
 * renders it. */
export function Hook({ text }) {
  const parts = String(text).split('**');
  return (
    <span className="ghook">
      {parts.map((p, i) => (i % 2 === 1 ? <b key={i}>{p}</b> : <span key={i}>{p}</span>))}
    </span>
  );
}

/** The meta chip row: time cost · cadence · the game's key rule. */
export function MetaChips({ chips = [] }) {
  if (!chips.length) return null;
  return (
    <span className="gmetarow">
      {chips.map((c) => <span className="gchip" key={c}>{c}</span>)}
    </span>
  );
}

/** A pulse line - live numbers where they exist, concrete dates where they
 * do not. Callers bold the numbers with <b>. */
export function Pulse({ children }) {
  return <span className="gpulse">{children}</span>;
}
