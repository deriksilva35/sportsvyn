'use client';

/**
 * components/push/PushReRegister.js - silent token refresh on launch.
 *
 * THE SKRY'S DISCIPLINE, PORTED: if OS permission is already granted, re-run
 * registration quietly on every launch and let the server upsert. APNs
 * rotates tokens across device restores and OS updates, and a device holding
 * a rotated token is silently deaf - no error anywhere, pushes just stop.
 * The upsert's revive-in-place also heals a token an APNs 410 wrongly
 * revoked (Apple documents 410s as occasionally transient around app
 * reinstalls).
 *
 * NEVER PROMPTS - checkPermissions only, so a not-now stays a not-now.
 * No-op on the web and in the v1.1 binary (plugin absent). Mounted once,
 * next to OnboardingGate in GlobalHeaderServer, because launch lands on a
 * page with the global header by definition of the launch flow.
 */

import { useEffect } from 'react';
import { reRegisterIfGranted } from '@/lib/push/client';

export default function PushReRegister() {
  useEffect(() => { reRegisterIfGranted(); }, []);
  return null;
}
