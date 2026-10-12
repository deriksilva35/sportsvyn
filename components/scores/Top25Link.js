'use client';

// The Top 25 chip / pill: a plain Link that also remembers where it is taking
// the reader (lib/scores/top25Memory.js). `next` is the state AFTER the tap.

import Link from 'next/link';
import { top25CookieString } from '@/lib/scores/top25Memory';

export default function Top25Link({ next, ...props }) {
  return (
    <Link
      {...props}
      onClick={() => { try { document.cookie = top25CookieString(next); } catch { /* no cookies: no memory */ } }}
    />
  );
}
