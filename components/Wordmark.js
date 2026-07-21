/**
 * THE ONLY wordmark source -- never re-implement locally.
 *
 * The wordmark is the locked PNG brand asset
 * (public/brand/sportsvynwordmarkwhite3000x600truealpha.png). The CSS/font-drawn
 * version is RETIRED because browser font metrics do not scale linearly, so the
 * macron drifted at different sizes and across environments -- unfixable in CSS
 * (Jul 21 2026). Serving the export ends that class of bug: the macron is baked
 * into the image at the locked position.
 *
 * SIZING keeps the existing API: `sizeClassName` sets the font-size on the
 * wrapper and the image is `height: LOCKUP_EM em`. The export is a LOCKUP, not a
 * tight crop: its caps span only rows 90-223 of the 336px height (0.40), with the
 * macron floating above and a full-width underline bar below. So height:1em would
 * render the letters at 0.40x the old size. LOCKUP_EM = 1.8 puts the caps back at
 * ~0.72 of the font-size (Saira's cap ratio), i.e. the same visual letter size the
 * old font-drawn wordmark had -- the underline then hangs below as part of the mark.
 * width:auto keeps the locked 1568x336 aspect; width/height attrs reserve space.
 *
 * The white export is light-on-dark; every wordmark surface is ink. Paper (light)
 * surfaces use the separate dark ink-twin in legal.css.
 *
 * alt "SPORTSVYN" so screen readers announce the brand on the <h1>.
 */

const SRC = '/brand/sportsvynwordmarkwhite3000x600truealpha.png';
const NAT_W = 1568;
const NAT_H = 336;
const LOCKUP_EM = 1.8; // letters are 0.40 of the png height; 1.8em restores old cap-height

export default function Wordmark({
  className = '',
  sizeClassName = 'text-5xl sm:text-6xl md:text-8xl',
}) {
  return (
    <h1 className={`leading-none whitespace-nowrap ${sizeClassName} ${className}`}>
      <img
        src={SRC}
        alt="SPORTSVYN"
        width={NAT_W}
        height={NAT_H}
        fetchPriority="high"
        decoding="async"
        style={{ height: `${LOCKUP_EM}em`, width: 'auto', display: 'inline-block', verticalAlign: 'baseline' }}
      />
    </h1>
  );
}
