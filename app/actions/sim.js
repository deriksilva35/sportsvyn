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
  startDraftFor, startCustomDraftFor, makePickFor, timerAutoPickFor, abandonDraftFor, setAutoDraftFor,
} from '@/lib/fantasy/drafts';
import { getPlayerSeasonStats, getPlayerSeasonSummaries } from '@/lib/fantasy/playerStats';

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

// Make the user's pick, then advance AI to the user's next turn (one transaction).
export async function makePick(draftId, ffcPlayerId) {
  const userId = await currentUserId();
  if (userId == null) return { ok: false, reason: 'unauthenticated' };
  const res = await makePickFor(userId, draftId, ffcPlayerId);
  if (res.ok) revalidatePath(`/sim/${draftId}`);
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
  return { ok: true, summaries: await getPlayerSeasonSummaries(ids, scoringFormat) };
}

// Abandon an in-progress draft (frees the entitlement gate).
export async function abandonDraft(draftId) {
  const userId = await currentUserId();
  if (userId == null) return { ok: false, reason: 'unauthenticated' };
  const res = await abandonDraftFor(userId, draftId);
  if (res.ok) revalidatePath('/sim');
  return res;
}
