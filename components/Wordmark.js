/**
 * THE ONLY wordmark implementation for light-on-dark (ink) surfaces -- never
 * re-implement locally. Every ink-surface wordmark must render through this
 * component (or the CSS twin in components/gridiron/Wordmark.js, which is kept
 * byte-for-byte geometry-identical for the <a>-link app headers on /scores,
 * /nfl, and /sim). Paper (light) surfaces use the dark ink-twin in legal.css
 * because these letters are paper-warm and would vanish on a light ground.
 *
 * Brand-locked macron geometry (from the PNG exporter):
 *   bar_left = y_left + 0.5*y_width - 0.35*bar_width,  bar_width = 115% of the Y.
 * In CSS: left-1/2 (50% of the Y wrap) + -translate-x-[35%] (of the BAR's own
 * width) + w-[115%], h-[0.07em], top-[-0.05em]. That lands the bar's LEFT EDGE at
 * ~+0.10 of the Y width INSIDE the Y - the bar sits ON the Y, nudged slightly
 * left for the italic. Use left-1/2, NOT left-0: left-0 drops the bar ~0.40 of a
 * Y to the left, onto the V-Y boundary (the bug that kept reproducing).
 *
 * Sportsvyn brand wordmark -- "SPORTSVȲN" with a macron above the Y.
 *
 * The macron is rendered as a CSS-drawn bar (an absolutely-positioned
 * empty span using bg-current) rather than a Unicode combining
 * character, so its thickness, width, and offset are tunable
 * independently of the typeface.
 *
 * Screen readers read the visible glyphs "SPORTSVYN" naturally; the
 * macron span is aria-hidden.
 *
 * Sizing:
 *   The default `sizeClassName` is the hero-tier scale used on the
 *   homepage. Callers on utility pages (/confirmed, etc.) pass a
 *   smaller scale. A dedicated prop is required because Tailwind
 *   emits same-family utilities (text-xs ... text-9xl) in spec order
 *   in the generated stylesheet, so a smaller class passed via the
 *   `className` slot won't override the larger default by virtue of
 *   className-string position alone.
 */

export default function Wordmark({
  className = '',
  sizeClassName = 'text-5xl sm:text-6xl md:text-8xl',
}) {
  return (
    <h1
      className={`font-display italic font-black text-paper-warm tracking-tighter leading-none whitespace-nowrap ${sizeClassName} ${className}`}
    >
      <span>SPORTSV</span>
      <span className="relative inline-block text-volt">
        Y
        {/* Macron is decoration — make it non-interactive so taps that
            land on the thin bar fall through to the wrapping <a> on
            inline-crumb pages (team/player) and don't intercept clicks
            anywhere else (SiteHeader pages don't wrap Wordmark in an
            anchor — no regression there). */}
        <span
          aria-hidden="true"
          className="absolute top-[-0.05em] left-1/2 -translate-x-[35%] w-[115%] h-[0.07em] bg-volt pointer-events-none"
        />
      </span>
      <span>N</span>
    </h1>
  );
}
