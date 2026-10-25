'use client';

// A Games / Stats tab: a plain Link that also remembers where it is taking the
// reader (lib/scores/statsFilter.js, the sv_scores_tab cookie - the pattern of
// Top25Link). `tab` is the tab AFTER the tap.

import Link from 'next/link';
import { tabCookieString } from '@/lib/scores/statsFilter';

export default function TabLink({ tab, ...props }) {
  return (
    <Link
      {...props}
      onClick={() => { try { document.cookie = tabCookieString(tab); } catch { /* no cookies: no memory */ } }}
    />
  );
}
