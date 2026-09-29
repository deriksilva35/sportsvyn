// app/manifest.js - the web app manifest (R3). Served at /manifest.webmanifest
// and linked by Next from the root layout.
//
// ICONS ONLY, in effect: the brand kit's any + maskable pairs (brand/web
// README). No `display` is set, so the default ("browser") holds and adding
// the site to a home screen opens a browser tab exactly as it did before a
// manifest existed - this file changes the icon, not the behaviour. (No
// background_color either: it paints a standalone launch splash, and there is
// none.) The native app is its own binary and does not read this.
export default function manifest() {
  return {
    name: 'Sportsvyn',
    short_name: 'Sportsvyn',
    start_url: '/',
    icons: [
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/brand/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
