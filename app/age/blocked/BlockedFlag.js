'use client';

// Sets the per-install refusal flag the moment the refusal screen paints, so a
// browser that arrives here by any path (the form, /age/check) carries it.
import { useEffect } from 'react';
import { setDeviceBlocked } from '../deviceFlag';

export default function BlockedFlag() {
  useEffect(() => { setDeviceBlocked(); }, []);
  return null;
}
