// components/brand/Monogram.js - the Ȳ as an inline SVG, from the traced
// geometry in lib/brand/monogram.js.
//
// `size` is the rendered HEIGHT of what is drawn, in CSS px: the whole mark
// (bar + Y) when the bar is on, the Y alone when it is off. `bar` defaults to
// barByDefault(size): on at 12 px and up, off below, where the bar-to-Y gap
// would be under a device pixel. The helmet decal takes that default.
// Color follows `currentColor` unless `color` is given.
import {
  MONOGRAM_BAR, MONOGRAM_MARK, MONOGRAM_Y_BOUNDS, barByDefault, yPoints,
} from '@/lib/brand/monogram';

export default function Monogram({ size = 24, bar = barByDefault(size), color = 'currentColor', className, title }) {
  const box = bar ? MONOGRAM_MARK : MONOGRAM_Y_BOUNDS;
  const width = Math.round((size * box.width) / box.height * 100) / 100;
  return (
    <svg
      className={className}
      viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
      width={width}
      height={size}
      fill={color}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      data-bar={bar ? '1' : '0'}
    >
      {bar ? <rect x={MONOGRAM_BAR.x} y={MONOGRAM_BAR.y} width={MONOGRAM_BAR.width} height={MONOGRAM_BAR.height} /> : null}
      <polygon points={yPoints()} />
    </svg>
  );
}
