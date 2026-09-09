// lib/auth/lastSeen.js - the hourly throttle behind users.last_seen_at. Pure:
// the caller owns the map and the clock, so the rule is testable without a
// session. One UPDATE per user per hour from this process; the SQL carries the
// same hour guard so several instances still write at most once an hour.
export const LAST_SEEN_INTERVAL_MS = 3_600_000;

export function shouldTouch(lastTouched, id, now = Date.now()) {
  if (id == null) return false;
  if ((lastTouched.get(id) ?? 0) > now - LAST_SEEN_INTERVAL_MS) return false;
  lastTouched.set(id, now);
  return true;
}
