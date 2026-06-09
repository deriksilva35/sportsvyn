/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next 16 blocks cross-origin requests to dev resources (static
  // chunks, HMR socket) by default. When testing on a real device
  // over LAN (phone at 10.0.0.87 vs dev server's localhost:3000),
  // the phone's origin is "different" and per-route CSS chunks
  // return HTTP 403 — page loads HTML + global styles but loses
  // route-specific CSS, manifesting as wide-open layouts that
  // emulation can't reproduce.
  // 10.0.0.87 is the laptop's current LAN IP (changes when the
  // machine moves networks — re-check via `ipconfig getifaddr en0`).
  allowedDevOrigins: ['10.0.0.87', '10.112.32.186'],
};

export default nextConfig;
