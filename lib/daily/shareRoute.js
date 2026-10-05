// lib/daily/shareRoute.js - which way a Daily share goes (relay mon-19). PURE:
// every capability is handed in, so the three branches are testable without a
// browser.
//
//   1. THE PLATFORM SHARE SHEET, WITH THE IMAGE - when
//      navigator.canShare({ files: [png], text, url }) says yes. share() is
//      called straight from the tap with the PRE-FETCHED file: no await comes
//      before it, so Safari keeps the tap's user activation.
//   2. THE APP SHELL'S OWN SHARE - the existing native bridge,
//      lib/shell/bridge.js sendShare(): window.postMessage({ type: 'share',
//      url, title }). Its contract carries a url and a title, so the link is
//      the url and the three lines ride as the title. sendShare decides by the
//      shell cookie and a native container, and returns false anywhere else.
//   3. DOWNLOAD + COPY - desktop and every other browser with neither.
//
// FEATURE TESTS ONLY. Nothing here, in the bridge or in the button reads the
// user agent; shareRoute.test.mjs fails the build if anything starts to.

/**
 * @param {object} a
 * @param {File|null} a.file      the card, fetched ahead of the tap
 * @param {string} a.text
 * @param {string} a.url
 * @param {Navigator|object|null} a.nav        navigator (or a fake)
 * @param {(m: {url: string, title: string}) => boolean} a.sendShare  the shell bridge
 * @param {() => Promise<void>} a.fallback     download + copy
 * @returns {Promise<'share'|'cancelled'|'bridge'|'fallback'>}
 */
export async function runShare({ file, text, url, nav, sendShare, fallback }) {
  const payload = file ? { files: [file], text, url } : null;
  let canFiles = false;
  try { canFiles = Boolean(payload && typeof nav?.share === 'function' && nav?.canShare?.(payload)); } catch { canFiles = false; }
  if (canFiles) {
    try {
      await nav.share(payload);
      return 'share';
    } catch (e) {
      // A cancel is the reader's answer. Anything else (a refused share)
      // falls through to the next route, so the tap never does nothing.
      if (e?.name === 'AbortError') return 'cancelled';
    }
  }
  if (sendShare?.({ url, title: text })) return 'bridge';
  await fallback();
  return 'fallback';
}
