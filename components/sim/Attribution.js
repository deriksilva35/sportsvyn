// components/sim/Attribution.js — the sim's quiet compliance zone. Renders the
// FFC ADP attribution (LICENSE REQUIREMENT: any surface showing FFC ADP must
// show this) and, in the same fine-print register right below it, the NFL
// non-affiliation line. No NFL stats-vendor attribution appears anywhere (that
// vendor's ToS denies name/likeness use — no name, not a smaller name).
// Presentational; the FFC text is single-sourced by the callers, the disclaimer
// by lib/legal.
import { NFL_NON_AFFILIATION } from '@/lib/legal';

export default function Attribution({ text, url }) {
  return (
    <footer className="sim-foot">
      <div>
        {text} · <a href={url} target="_blank" rel="noopener noreferrer">fantasyfootballcalculator.com</a>
      </div>
      <div className="sim-foot-noaff">{NFL_NON_AFFILIATION}</div>
    </footer>
  );
}
