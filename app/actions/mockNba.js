'use server';

// app/actions/mockNba.js - the NBA mock draft's two writes (sun-7). Thin doors;
// lib/mockNba/record.js owns the rules.
//
// recordMockDraftAction: a finished mock's picks, kept ANONYMOUSLY (no user id is
// read or stored) - signed out or in alike. saveMockSettingsAction: a signed-in
// reader's setup, so the next mock opens with it; "Reset to default" clears it.
// The *MockSetupAction doors (mon-2): NAMED setups - save as, overwrite/rename,
// delete - signed in only (lib/mockNba/setups.js owns the rules).

import { auth } from '@/auth';
import { cleanMockRecord, recordMock, saveMockSettings, clearMockSettings } from '@/lib/mockNba/record';
import { createSetup, updateSetup, deleteSetup } from '@/lib/mockNba/setups';
import { ageGateRefusal } from '@/lib/auth/ageGateDb';

export async function recordMockDraftAction(payload) {
  const row = cleanMockRecord(payload);
  if (!row) return { ok: false, reason: 'invalid' };
  try { await recordMock(row); return { ok: true }; } catch { return { ok: false, reason: 'error' }; }
}

export async function saveMockSettingsAction(settings) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return { ok: false, reason: 'signed_out' };
  const ageRefused = await ageGateRefusal(userId); if (ageRefused) return ageRefused;
  if (settings == null) { await clearMockSettings(Number(userId)); return { ok: true, settings: null }; }
  return { ok: true, settings: await saveMockSettings(Number(userId), settings) };
}

export async function createMockSetupAction(name, settings) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return { ok: false, reason: 'signed_out' };
  const ageRefused = await ageGateRefusal(userId); if (ageRefused) return ageRefused;
  return createSetup(Number(userId), name, settings);
}

/** Overwrite (settings), rename (name), or both. */
export async function updateMockSetupAction(id, patch) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return { ok: false, reason: 'signed_out' };
  const ageRefused = await ageGateRefusal(userId); if (ageRefused) return ageRefused;
  return updateSetup(Number(userId), Number(id), { name: patch?.name, settings: patch?.settings });
}

export async function deleteMockSetupAction(id) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return { ok: false, reason: 'signed_out' };
  const ageRefused = await ageGateRefusal(userId); if (ageRefused) return ageRefused;
  return deleteSetup(Number(userId), Number(id));
}
