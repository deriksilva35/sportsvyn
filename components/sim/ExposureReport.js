// components/sim/ExposureReport.js — the Draft Pass anchor feature on /sim/history.
// Two states: `locked` (free users — name the feature, show nothing computed; it
// sells the Pass at the moment of curiosity) and the computed report (sim
// entitlement). Presentational; entitlement is decided server-side. Hyphens only.

import Link from 'next/link';
import { SHELL_LOCKED_NOTE } from './membershipCopy';

function leanLabel(lean, avgValue) {
  if (avgValue == null) return 'Not enough graded picks yet.';
  if (lean === 'value') return `Value lean - your picks land about ${avgValue} spots later than ADP.`;
  if (lean === 'reach') return `Reach lean - your picks land about ${Math.abs(avgValue)} spots ahead of ADP.`;
  return 'Even - your picks track ADP closely.';
}

/**
 * `locked` IS NOW ALWAYS FALSE from app/sim/history - the Exposure Report is
 * free for the 2026 season. The branch is kept rather than deleted because the
 * component is the only thing that knows how to present a locked state, and
 * re-deriving that from scratch if pricing returns would cost more than the
 * dead code does. It is unreachable, not wrong.
 */
export default function ExposureReport({ report = null, locked = false, shell = false }) {
  if (locked) {
    // SHELL (App Store 3.1.1): name the feature, do not sell it. No plan name in
    // the lock chip, no "unlocks with the Draft Pass", and no /membership CTA -
    // the link is not rendered at all rather than hidden.
    if (shell) {
      return (
        <section className="expo expo--locked" aria-label="Exposure Report (locked)" data-shell="1">
          <div className="expo-h">
            <span className="expo-kicker">Exposure Report</span>
            <span className="expo-lock">Members</span>
          </div>
          <p className="expo-lock-copy">
            See who you draft most, your average round on each, and whether you lean
            value or reach against ADP - across every draft you run. {SHELL_LOCKED_NOTE}
          </p>
        </section>
      );
    }
    return (
      <section className="expo expo--locked" aria-label="Exposure Report (locked)">
        <div className="expo-h">
          <span className="expo-kicker">Exposure Report</span>
          <span className="expo-lock">Draft Pass</span>
        </div>
        <p className="expo-lock-copy">
          See who you draft most, your average round on each, and whether you lean
          value or reach against ADP - across every draft you run. Unlocks with the
          Draft Pass.
        </p>
        <Link href="/membership" className="expo-cta">See the Draft Pass</Link>
      </section>
    );
  }

  if (!report || report.draftCount === 0) {
    return (
      <section className="expo" aria-label="Exposure Report">
        <div className="expo-h"><span className="expo-kicker">Exposure Report</span></div>
        <p className="expo-empty">Complete a draft to build your exposure profile.</p>
      </section>
    );
  }

  const { mostDrafted, valueByRound, overallLean, draftCount } = report;
  return (
    <section className="expo" aria-label="Exposure Report">
      <div className="expo-h">
        <span className="expo-kicker">Exposure Report</span>
        <span className="expo-sub">{draftCount} {draftCount === 1 ? 'draft' : 'drafts'}</span>
      </div>
      <div className="expo-lean">{leanLabel(overallLean.lean, overallLean.avgValue)}</div>

      {mostDrafted.length > 0 && (
        <div className="expo-block">
          <div className="expo-block-h">Most drafted</div>
          <ul className="expo-list">
            {mostDrafted.map((p) => (
              <li key={p.player} className="expo-row">
                <span className="expo-nm">{p.player} <span className="expo-pos">{p.position}</span></span>
                <span className="expo-stat">{p.count}x · {p.pctOfDrafts}% · avg R{p.avgRound}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {valueByRound.length > 0 && (
        <div className="expo-block">
          <div className="expo-block-h">Value vs ADP by round</div>
          <ul className="expo-vlist">
            {valueByRound.map((r) => (
              <li key={r.round} className="expo-vrow">
                <span className="expo-vr">R{r.round}</span>
                <span className={`expo-vv ${r.avgValue > 0 ? 'val' : r.avgValue < 0 ? 'reach' : ''}`}>
                  {r.avgValue > 0 ? `+${r.avgValue} value` : r.avgValue < 0 ? `${r.avgValue} reach` : 'even'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
