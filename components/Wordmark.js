/**
 * THE ONLY wordmark source -- never re-implement locally.
 *
 * R3 (29 Sep): the mark is the brand kit's SVG, one file per ground, drawn by
 * components/brand/HeaderWordmark. The retired PNG lockup (and its baked
 * underline bar) is no longer referenced by any header.
 *
 * SIZING keeps the existing API: `sizeClassName` sets the font-size on the
 * wrapper and the mark's height is in em (see HeaderWordmark for the math that
 * keeps the letters the size the PNG drew them).
 *
 * alt "SPORTSVYN" so screen readers announce the brand on the <h1>.
 */
import HeaderWordmark from '@/components/brand/HeaderWordmark';

export default function Wordmark({
  className = '',
  sizeClassName = 'text-5xl sm:text-6xl md:text-8xl',
}) {
  return (
    <h1 className={`leading-none whitespace-nowrap ${sizeClassName} ${className}`}>
      <HeaderWordmark display="inline-block" />
    </h1>
  );
}
