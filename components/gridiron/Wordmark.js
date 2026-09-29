// components/gridiron/Wordmark.js — the wordmark for the <a>-link ink headers
// (/scores, /nfl, /cfb, all /sim, and GlobalHeader). The `.wordmark` class keeps
// its font-size (22px header, 17px shell), which drives the mark's height.
// The mark itself is components/brand/HeaderWordmark (R3: the brand kit's SVG,
// one per ground, no underline).
import HeaderWordmark from '@/components/brand/HeaderWordmark';

export default function Wordmark({ href = '/scores' }) {
  return (
    <a className="wordmark" href={href} aria-label="SPORTSVYN">
      <HeaderWordmark display="block" />
    </a>
  );
}
