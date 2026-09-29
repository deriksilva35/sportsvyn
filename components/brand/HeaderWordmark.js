// components/brand/HeaderWordmark.js - THE SPORTSVYN MARK, both grounds (R3).
//
// The brand kit's header wordmarks (mock-app brand/web @ 84ae53d, copied to
// public/brand/). THE KIT NAMES EACH FILE BY ITS GROUND, NOT ITS INK:
//   sportsvyn-header-wordmark-dark.svg   WHITE letters, for the dark page
//   sportsvyn-header-wordmark-light.svg  INDIGO letters, for the arcade (light) page
// Both render, both alt="SPORTSVYN"; CSS shows the one the theme asks for and
// display:none takes the other out of the accessibility tree (globals.css, .wm-on-*),
// because the header is shared by server and client trees and only the CSS
// knows the theme without a flash.
//
// NO UNDERLINE. The retired PNG was a lockup with a full-width bar baked in
// under the letters; the Ŷ's volt circumflex carries the mark now.
//
// SAME LETTER SIZE AS THE PNG. Its caps were 0.396 of its height, drawn at
// 1.8em (0.71em caps). The SVG's caps are rows 80-198 of 225 (0.524), so
// 1.36em draws the same 0.71em caps; the box is shorter because the bar and
// the lockup's padding are gone.
export const WORDMARK_EM = 1.36;
// AND THE SAME BOX. The PNG's box was 1.8em tall (caps, macron, bar and the
// lockup's padding); the headers' heights were built around it - the web bar
// measured 63 px at 390, and 60 without this. The difference is padded back
// evenly, so every header keeps its height and the letters sit centred in it.
export const LOCKUP_BOX_EM = 1.8;
const PAD_EM = Math.round(((LOCKUP_BOX_EM - WORDMARK_EM) / 2) * 1000) / 1000;
export const WORDMARK_ON_DARK = '/brand/sportsvyn-header-wordmark-dark.svg';
export const WORDMARK_ON_LIGHT = '/brand/sportsvyn-header-wordmark-light.svg';

export default function HeaderWordmark({ display = 'block' }) {
  const style = { height: `${WORDMARK_EM}em`, width: 'auto', display, verticalAlign: 'baseline', padding: `${PAD_EM}em 0`, boxSizing: 'content-box' };
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- a fixed vector asset from public/, sized in em by its container */}
      <img className={`wm-on-dark${display === 'inline-block' ? ' wm-inline' : ''}`} src={WORDMARK_ON_DARK} alt="SPORTSVYN" width={1124} height={225} fetchPriority="high" decoding="async" style={style} />
      {/* eslint-disable-next-line @next/next/no-img-element -- as above */}
      <img className={`wm-on-light${display === 'inline-block' ? ' wm-inline' : ''}`} src={WORDMARK_ON_LIGHT} alt="SPORTSVYN" width={1124} height={225} decoding="async" style={style} />
    </>
  );
}
