/**
 * Sportsvyn brand wordmark — "SPORTSVȲN" with a macron above the Y.
 *
 * The macron is rendered as a CSS-drawn bar (an absolutely-positioned empty
 * span using bg-current) rather than a Unicode combining character, so its
 * thickness, width, and offset are tunable independently of the typeface.
 *
 * Screen readers read the visible glyphs "SPORTSVYN" naturally; the macron
 * span is aria-hidden.
 *
 * Optimized for hero size by default (text-7xl on mobile, text-8xl on
 * desktop). Pass `className` to override or extend the default styling at
 * smaller sizes elsewhere.
 */

export default function Wordmark({ className = '' }) {
  return (
    <h1
      className={`font-display italic font-black text-paper-warm tracking-tighter leading-none whitespace-nowrap text-5xl sm:text-6xl md:text-8xl ${className}`}
    >
      <span>SPORTSV</span>
      <span className="relative inline-block text-volt">
        Y
        <span
          aria-hidden="true"
          className="absolute top-[-0.05em] left-1/2 -translate-x-[35%] w-[115%] h-[0.07em] bg-volt"
        />
      </span>
      <span>N</span>
    </h1>
  );
}
