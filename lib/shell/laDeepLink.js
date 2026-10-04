// lib/shell/laDeepLink.js - THE WIDGET'S "FOLLOW ON LOCK SCREEN" LINK (sun-24).
// PURE: no window, no document - the caller hands in what it read.
//
// A widget tap on a live game opens /<league>/game/<slug>?sv_la=1&sv_match=<id>.
// In the app shell, on THAT game, while it is LIVE, the game page opens the
// alerts sheet (components/alerts/AlertBell.js) so its existing "Live on lock
// screen" row is in front of the reader. It NEVER starts an Activity: the row
// still needs the tap, which is what starts one.
//
// IGNORED, silently, whenever any of these fails:
//   - the environment cannot hold a Live Activity (canBridge: the shell with a
//     native push transport - lib/shell/liveActivityBridge.js)
//   - sv_la is not exactly '1'
//   - sv_match is not this page's match id
//   - the game is not live (no liveActivity inputs, final, or not started)
//   - the league has no Live Activity (liveActivitySupported - basketball)

export const LA_PARAM = 'sv_la';
export const LA_MATCH_PARAM = 'sv_match';

/** The link a widget builds for a game. `path` is the feed row's href. */
export function laDeepLinkPath(path, matchId) {
  if (typeof path !== 'string' || !path.startsWith('/') || !Number.isInteger(Number(matchId))) return null;
  return `${path}${path.includes('?') ? '&' : '?'}${LA_PARAM}=1&${LA_MATCH_PARAM}=${Number(matchId)}`;
}

/** Should the page open the lock-screen prompt? */
export function wantsLaPrompt({ search = '', matchId, canBridge = false, liveActivity = null, supported = true } = {}) {
  if (!canBridge || !supported || !liveActivity || liveActivity.final || liveActivity.live !== true) return false;
  let q;
  try { q = new URLSearchParams(String(search ?? '')); } catch { return false; }
  if (q.get(LA_PARAM) !== '1') return false;
  const id = q.get(LA_MATCH_PARAM);
  return id != null && /^\d+$/.test(id) && Number(id) === Number(matchId);
}

/** The search string with the two params removed, so a reload does not reopen the sheet. */
export function withoutLaParams(search = '') {
  const q = new URLSearchParams(String(search ?? ''));
  q.delete(LA_PARAM); q.delete(LA_MATCH_PARAM);
  const s = q.toString();
  return s ? `?${s}` : '';
}
