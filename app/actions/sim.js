'use server';

/**
 * Server Actions for the mock draft sim.
 *
 * Each action resolves the session INSIDE the action — the user id is NEVER
 * trusted from the client — then delegates to the flow-core in lib/fantasy/
 * drafts.js (which takes the user id explicitly and is unit-tested there). An
 * unauthenticated call returns a typed { ok: false, reason: 'unauthenticated' }
 * rather than throwing, so the client decides whether to surface a sign-in / an
 * upgrade prompt (reason: 'entitlement').
 */

import { auth } from '@/auth';
import { revalidatePath } from 'next/cache';
import {
  startDraftFor, startCustomDraftFor, startLeagueDraftFor, makePickFor, timerAutoPickFor, abandonDraftFor, setAutoDraftFor,
  startTrackerDraftFor, logPickFor, undoLastPickFor,
} from '@/lib/fantasy/drafts';
import { deleteAccountFor } from '@/lib/account';
import { getPlayerSeasonStats, getPlayerSeasonSummaries } from '@/lib/fantasy/playerStats';
import { getCollegeSeasonSummaries } from '@/lib/fantasy/collegeStats';

async function currentUserId() {
  const session = await auth();
  return session?.user?.id ?? null;
}

// Start a draft. pickPosition is 1..teams_count or 'random'; opts.auto=true runs
// the whole thing server-side. A blocked gate returns reason:'entitlement' for
// the upgrade prompt.
export async function startDraft(presetId, pickPosition, opts = {}) {
  const userId = await currentUserId();
  if (userId == null) return { ok: false, reason: 'unauthenticated' };
  const res = await startDraftFor(userId, presetId, pickPosition, opts);
  if (res.ok) revalidatePath('/sim');
  return res;
}

// Start a draft from a custom console config. The config is UNTRUSTED — the
// flow-core validates every bound/enum and enforces the member gate server-side
// (returns reason:'entitlement_custom' for non-members, 'invalid_config' with a
// detail for a malformed config). pickPosition is 1..teams_count or 'random'.
export async function startCustomDraft(config, pickPosition, opts = {}) {
  const userId = await currentUserId();
  if (userId == null) return { ok: false, reason: 'unauthenticated' };
  const res = await startCustomDraftFor(userId, config, pickPosition, opts);
  if (res.ok) revalidatePath('/sim');
  return res;
}

// Start an imported league's draft. The seat is the config's own (isMine),
// so there is no pickPosition to take; the flow-core refuses a config that is
// not this user's or not a league ('league_not_found').
export async function startLeagueDraft(configId, opts = {}) {
  const userId = await currentUserId();
  if (userId == null) return { ok: false, reason: 'unauthenticated' };
  // opts.seat (084): the seat tapped on the card, 1..teams_count, this run only.
  // Whitelisted, not spread: the flow-core's opts are ours to name, not the wire's.
  const clean = { auto: opts?.auto === true, ...(opts?.seat != null ? { seat: Number(opts.seat) } : {}) };
  const res = await startLeagueDraftFor(userId, Number(configId), clean);
  if (res.ok) revalidatePath('/sim');
  return res;
}

// Make the user's pick, then advance AI to the user's next turn (one transaction).
export async function makePick(draftId, ffcPlayerId) {
  const userId = await currentUserId();
  if (userId == null) return { ok: false, reason: 'unauthenticated' };
  const res = await makePickFor(userId, draftId, ffcPlayerId);
  if (res.ok) revalidatePath(`/sim/${draftId}`);
  return res;
}

// ---- tracker mode (live in-person draft companion) ----

// Start a tracker draft. Pass-gated with NO free trial: a non-entitled user gets
// reason:'entitlement_tracker' for the conversion card. The config is UNTRUSTED
// (validated server-side, same as a custom sim draft); teamLabels is optional but
// must match teams_count if given.
export async function startTrackerDraft(config, pickPosition, teamLabels = null) {
  const userId = await currentUserId();
  if (userId == null) return { ok: false, reason: 'unauthenticated' };
  const res = await startTrackerDraftFor(userId, config, pickPosition, teamLabels);
  if (res.ok) revalidatePath('/sim');
  return res;
}

// Log the pick for whichever seat is on the clock. Unlike makePick there is no AI
// advance — the draft moves forward exactly one pick per call.
export async function logPick(draftId, ffcPlayerId) {
  const userId = await currentUserId();
  if (userId == null) return { ok: false, reason: 'unauthenticated' };
  const res = await logPickFor(userId, draftId, ffcPlayerId);
  if (res.ok) revalidatePath(`/sim/draft/${draftId}`);
  return res;
}

// Undo the most recent logged pick. Repeatable. Tracker only.
export async function undoLastPick(draftId) {
  const userId = await currentUserId();
  if (userId == null) return { ok: false, reason: 'unauthenticated' };
  const res = await undoLastPickFor(userId, draftId);
  if (res.ok) revalidatePath(`/sim/draft/${draftId}`);
  return res;
}

// Server-authoritative timer fallback (advisory UI timer; permissive v1).
export async function timerAutoPick(draftId) {
  const userId = await currentUserId();
  if (userId == null) return { ok: false, reason: 'unauthenticated' };
  const res = await timerAutoPickFor(userId, draftId);
  if (res.ok) revalidatePath(`/sim/${draftId}`);
  return res;
}

// Flip mid-draft AUTO on/off for the owning user's seat. Persists on
// drafts.is_auto; the room then drives the EXISTING timerAutoPick engine path
// for each of the user's turns. Gate accounting is untouched by design.
export async function setAutoDraft(draftId, on) {
  const userId = await currentUserId();
  if (userId == null) return { ok: false, reason: 'unauthenticated' };
  const res = await setAutoDraftFor(userId, draftId, on);
  if (res.ok) revalidatePath(`/sim/draft/${draftId}`);
  return res;
}

// Season stats for one pool player. Returns { ok: true, stats: null } today:
// there are no NFL stat rows in DEV (see lib/fantasy/playerStats.js). The room
// renders an honest empty state; the wiring is real so the backfill session only
// has to fill in getPlayerSeasonStats.
export async function fetchPlayerStats(ffcPlayerId) {
  const userId = await currentUserId();
  if (userId == null) return { ok: false, reason: 'unauthenticated' };
  return { ok: true, stats: await getPlayerSeasonStats(String(ffcPlayerId)) };
}

// Season fantasy summaries for the collapsed rows' quick stats, batched (one
// call for the whole visible list, never one per row). Returns {} today.
export async function fetchPlayerSummaries(ffcPlayerIds, scoringFormat) {
  const userId = await currentUserId();
  if (userId == null) return { ok: false, reason: 'unauthenticated' };
  const ids = (ffcPlayerIds ?? []).map(String);
  // TWO ROSTERS, ONE MAP. NFL identity resolves through
  // sim_player_pool.matched_player_id -> nfl_players; college identity cannot
  // (nameMatch is scoped to league='nfl', because college players matched NFL
  // ids on name alone) and resolves against players + cfb_player_game_stats
  // instead. Each function ignores ids that are not its own, so the two never
  // write the same key and the merge order does not matter.
  const [nfl, college] = await Promise.all([
    getPlayerSeasonSummaries(ids, scoringFormat),
    getCollegeSeasonSummaries(ids, scoringFormat),
  ]);
  return { ok: true, summaries: { ...nfl, ...college } };
}

// Permanently delete the signed-in user and ALL their data (App Store guideline
// 5.1.1(v)). Session-resolved server-side; never trusts a client id. The client
// signs out afterwards, which clears the now-orphaned session cookie. Idempotent.
export async function deleteAccount() {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return { ok: false, reason: 'unauthenticated' };
  return deleteAccountFor(userId, session.user?.email ?? null);
}

// Abandon an in-progress draft (frees the entitlement gate).
export async function abandonDraft(draftId) {
  const userId = await currentUserId();
  if (userId == null) return { ok: false, reason: 'unauthenticated' };
  const res = await abandonDraftFor(userId, draftId);
  if (res.ok) revalidatePath('/sim');
  return res;
}
