// components/gridiron/Wordmark.js — the Sportsvyn wordmark, exact locked markup
// (docs/design/design-tokens-v1_1.md). Never rebuilt; always this pattern.
// Ink-band only — never rendered on a paper ground directly.
export default function Wordmark({ href = '/scores' }) {
  return (
    <a className="wordmark" href={href}>
      SPORTSV<span className="y-wrap">Y<span className="macron" /></span>N
    </a>
  );
}
