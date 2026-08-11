'use server';

/**
 * Server actions for the first-launch sheet's ledger.
 *
 * THE USER IS RESOLVED HERE, NOT PASSED IN. The client knows who it is, but a
 * client-supplied user id is a client-supplied user id - it would let anyone
 * write rows against anyone. auth() is one call and it removes the question.
 *
 * BOTH ACTIONS SWALLOW EVERYTHING. They are called from a modal that sits
 * between a new account and the draft button; an analytics write must never be
 * able to keep that modal on screen. Every failure returns null/false and the
 * sheet carries on as if nothing happened, because from the user's point of
 * view nothing did.
 */

import { auth } from '@/auth';
import { recordSheetShown, recordSheetDismissed } from '@/lib/auth/welcomeSheetLedger';

export async function sheetShown() {
  try {
    const session = await auth();
    const userId = session?.user?.id ?? null;
    if (userId == null) return null;
    return await recordSheetShown(userId);
  } catch {
    return null;
  }
}

export async function sheetDismissed(id, control) {
  try {
    if (id == null) return false;
    return await recordSheetDismissed(Number(id), control);
  } catch {
    return false;
  }
}
