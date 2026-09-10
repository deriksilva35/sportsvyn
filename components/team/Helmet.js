// components/team/Helmet.js - one SVG helmet in the team's two colors.
//
// Shell in primary; facemask, one crown stripe and the ear hole in secondary;
// the Ȳ monogram as the decal where a team mark would sit. The decal is INK on
// a light shell and PAPER on a dark one, decided by the shell's luminance
// (lib/brand/contrast.js) - never per team. The bar over the Y follows the
// monogram's own default: on from 12 CSS px of decal height (the decal is
// 0.20 of the helmet), so it appears at helmet sizes of 60 px and up.
//
// A team with no colors renders NO helmet - null, not a grey one. Both colors
// or nothing: `teamColors()` in lib/gridiron/readers.js enforces the pair.
//
// `facing` mirrors the helmet, not the decal: an italic Y flipped is a wrong
// glyph, so the decal is placed for each side rather than mirrored with it.
import { MonogramGlyph } from '@/components/brand/Monogram';
import { MONOGRAM_MARK, MONOGRAM_Y_BOUNDS, barByDefault } from '@/lib/brand/monogram';
import { decalColor, parseHex } from '@/lib/brand/contrast';

export const DECAL_FRACTION = 0.20;

export default function Helmet({ primary, secondary, facing = 'right', size = 24, className, title }) {
  if (!parseHex(primary) || !parseHex(secondary)) return null;
  const decal = decalColor(primary);
  const decalPx = size * DECAL_FRACTION;
  const bar = barByDefault(decalPx);
  const box = bar ? MONOGRAM_MARK : MONOGRAM_Y_BOUNDS;
  // decal box: 28 tall in the 100 space, its width from the glyph's own aspect
  const dh = 100 * DECAL_FRACTION; const dw = dh * (box.width / box.height); const s = dh / box.height;
  const dy = 30; const dx = facing === 'right' ? 40 - dw / 2 : 60 - dw / 2;
  const mirror = facing === 'left' ? 'translate(100 0) scale(-1 1)' : undefined;
  return (
    <svg
      className={className}
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      data-facing={facing}
      data-decal={decal}
      data-bar={bar ? '1' : '0'}
    >
      <g transform={mirror}>
        {/* shell: dome from the back (left) over the crown to the brow, a jaw
            flap under the ear, cut square at the front where the mask hangs */}
        <path
          d="M10 60 C10 30 30 12 56 12 C78 12 92 30 92 52 L92 66 C92 71 88 75 83 75 L72 75 L72 62 L58 62 L58 84 L34 84 C20 84 10 74 10 60 Z"
          fill={primary}
        />
        {/* one stripe over the crown */}
        <path d="M24 26 C36 12 70 12 88 34" fill="none" stroke={secondary} strokeWidth="6" strokeLinecap="round" />
        {/* ear hole */}
        <circle cx="42" cy="66" r="4.5" fill={secondary} />
        {/* facemask: two bars off the brow and a jaw bar, in secondary */}
        <path d="M90 46 L98 46 L98 74 L82 74 M92 60 L98 60" fill="none" stroke={secondary} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <g transform={`translate(${dx} ${dy}) scale(${s}) translate(${-box.x} ${-box.y})`} fill={decal}>
        <MonogramGlyph bar={bar} />
      </g>
    </svg>
  );
}
