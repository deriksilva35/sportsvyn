// lib/brand/monogram.js - THE Ȳ MONOGRAM AS GEOMETRY.
//
// Two shapes in a 1024 box, read off the app icon
// (ios/.../AppIcon-512@2x.png) to the pixel by scripts/monogram-trace.mjs:
// a rectangle for the bar and a ten-vertex polygon for the italic Y. The
// traced polygon and the raster disagree on 0.08% of pixels (edge
// antialiasing). public/brand/monogram.svg is generated from these constants
// and a test holds the two together; change the numbers here, regenerate the
// file, never edit the file by hand.
//
// Coordinates are pixel edges of the 1024 icon: the bar's top edge is y=225,
// its bottom edge y=297.
export const MONOGRAM_VIEWBOX = 1024;
export const MONOGRAM_FILL = '#DDFE52'; // the icon's volt, as exported
export const MONOGRAM_BAR = { x: 286, y: 225, width: 452, height: 72 };
export const MONOGRAM_Y = [
  [444, 331], [471, 505], [577, 331], [739, 331], [524, 648],
  [492, 799], [333, 799], [364, 656], [365, 645], [285, 331],
];
// Bounds of the whole mark (bar + Y) and of the Y alone, for cropped viewBoxes.
export const MONOGRAM_MARK = { x: 285, y: 225, width: 454, height: 574 };
export const MONOGRAM_Y_BOUNDS = { x: 285, y: 331, width: 454, height: 468 };

// Below this many CSS px of mark height the bar-to-Y gap (0.059 of the mark)
// is under a device pixel on a 1x screen and the mark reads as a T-topped Y;
// the bar is dropped by default and the Y alone is drawn.
export const MONOGRAM_BAR_MIN = 12;
export const barByDefault = (size) => size >= MONOGRAM_BAR_MIN;

export const yPoints = () => MONOGRAM_Y.map((p) => p.join(',')).join(' ');

/** The standalone SVG file, byte for byte. */
export function monogramSvg({ fill = MONOGRAM_FILL } = {}) {
  const b = MONOGRAM_BAR;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MONOGRAM_VIEWBOX} ${MONOGRAM_VIEWBOX}" role="img" aria-label="Sportsvyn">`,
    `  <!-- generated from lib/brand/monogram.js - do not edit by hand -->`,
    `  <rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="${fill}"/>`,
    `  <polygon points="${yPoints()}" fill="${fill}"/>`,
    `</svg>`,
    '',
  ].join('\n');
}
