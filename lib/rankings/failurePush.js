// lib/rankings/failurePush.js - a failed power-edition publish reaches the
// admin's phone (tue-6).
//
// WHY. The Tuesday 13:05Z cron is the only thing that publishes the NFL board,
// and it failed on 22 Sep and 29 Sep with nothing but an email - the board sat
// on a stale edition for a week and "looked exactly like a fresh one". The
// sender is the postseason alert's (services/mlb-advance/index.mjs):
// notifyPersonalized to ADMIN_USER_IDS, which already reaches the admin
// account's device. Beside the email, never instead of it.
//
// ONCE PER LIST PER UTC DAY. notifyPersonalized claims each event id once, so a
// manual re-run that fails the same way does not buzz the phone again; the
// next Tuesday's failure is a new day and does.

import { notifyPersonalized } from '../push/notify.js';
import { ADMIN_USER_IDS } from '../admin/gate.js';

export const eventIdFor = (list, now = new Date()) =>
  `ops-power-edition-failed:${list}:${new Date(now).toISOString().slice(0, 10)}`;

/** Never throws: a push that cannot be sent must not cost the route its answer. */
export async function pushPublishFailure({ list, now = new Date(), notify = notifyPersonalized, admins = ADMIN_USER_IDS } = {}) {
  try {
    return await notify(eventIdFor(list, now), admins.map((userId) => ({ userId, params: { list } })));
  } catch (e) {
    return { error: String(e?.message ?? e).slice(0, 120) };
  }
}
