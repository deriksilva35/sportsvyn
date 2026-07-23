/**
 * lib/pollers/cronAuth.js — the Vercel-cron Bearer check, extracted so it is
 * unit-testable (route handlers can't be imported under node --test because of
 * the @/ path alias). Same contract as the soccer crons: Authorization must be
 * `Bearer ${CRON_SECRET}`.
 */

export function cronAuthorized(request, secret = process.env.CRON_SECRET) {
  if (!secret) return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}
