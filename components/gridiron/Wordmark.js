// components/gridiron/Wordmark.js — the wordmark for the <a>-link ink headers
// (/scores, /nfl, /cfb, all /sim). Same locked PNG asset as components/Wordmark.js
// (the CSS/font-drawn version is retired — font-metric drift moved the macron at
// different sizes; Jul 21 2026). The `.wordmark` class keeps its font-size (22px
// header, 17px shell) which drives the image height. The export is a LOCKUP: the
// caps are only 0.40 of the png height (macron above, underline below), so 1em
// would render them at 0.40x. 1.8em restores the old cap-height; the underline
// hangs below as part of the mark. width:auto holds the locked 1568x336 aspect.
const SRC = '/brand/sportsvynwordmarkwhite3000x600truealpha.png';
const LOCKUP_EM = 1.8;

export default function Wordmark({ href = '/scores' }) {
  return (
    <a className="wordmark" href={href} aria-label="SPORTSVYN">
      <img
        src={SRC}
        alt="SPORTSVYN"
        width={1568}
        height={336}
        fetchPriority="high"
        decoding="async"
        style={{ height: `${LOCKUP_EM}em`, width: 'auto', display: 'block' }}
      />
    </a>
  );
}
