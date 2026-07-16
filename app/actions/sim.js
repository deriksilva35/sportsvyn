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
  startDraftFor, makePickFor, timerAutoPickFor, abandonDraftFor,
} from '@/lib/fantasy/drafts';

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

// Abandon an in-progress draft (frees the entitlement gate).
export async function abandonDraft(draftId) {
  const userId = await currentUserId();
  if (userId == null) return { ok: false, reason: 'unauthenticated' };
  const res = await abandonDraftFor(userId, draftId);
  if (res.ok) revalidatePath('/sim');
  return res;
}
