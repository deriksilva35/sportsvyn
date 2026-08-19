'use client';

// components/gridiron/DateRail.js - the scoreboard's date navigation.
//
// THREE JOBS, one component:
//
//   SOFT NAV. The arrows were plain <a>s that never got the segment's Link
//   conversion - every date change replayed the teardown glitch the segment
//   fix killed (chrome pop, 54px shift). <Link> throughout.
//
//   A PENDING SIGNAL. Same-route searchParams navigation does NOT remount
//   loading.js - the segment boundary never changes - so a date change holds
//   the old slate painted with zero feedback for the read's ~200-400ms. This
//   is exactly the case Next's own docs assign to useLinkStatus ("destination
//   is dynamic and doesn't include a loading.js that would allow instant
//   navigation"): the tapped arrow dims and the rail goes aria-busy until the
//   new slate lands.
//
//   THE JUMP. One-day arrows were the only nav across a six-month season. The
//   center date is now a real <input type=date> - native picker in WKWebView
//   and every browser, zero dependency - bounded to the season's slate range,
//   overlaid invisibly on the styled label so the tap target IS the date.
//
// Every href routes through scoresHref with the FULL current filter state -
// that is fix B, and it is the module contract, not a per-link courtesy.

import Link from 'next/link';
import { useLinkStatus } from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { scoresHref } from '@/lib/gridiron/scoresNav';

function Arrow({ href, children, label }) {
  const { pending } = useLinkStatus();
  return (
    <Link href={href} aria-label={label} className={pending ? 'pend' : ''}>{children}</Link>
  );
}

export default function DateRail({ date, label, prev, next, min, max, sport, live }) {
  const router = useRouter();
  const [jumping, startJump] = useTransition();
  const q = { sport, live };

  return (
    <div className={`gi-datenav${jumping ? ' pend' : ''}`} aria-busy={jumping || undefined}>
      <Arrow href={scoresHref(prev, q)} label="Previous day">‹</Arrow>
      <span className="cur gi-datejump">
        <b>{label.wd}</b> {label.md} {label.year}
        {/* The invisible native input rides the label. Not display:none - a
            hidden input cannot be tapped; opacity 0 over the full label keeps
            the OS picker one tap away with the styled text as its face. */}
        <input
          type="date"
          value={date}
          min={min}
          max={max}
          aria-label="Jump to date"
          onChange={(e) => {
            const v = e.target.value;
            if (v) startJump(() => router.push(scoresHref(v, q)));
          }}
        />
      </span>
      <Arrow href={scoresHref(next, q)} label="Next day">›</Arrow>
    </div>
  );
}
