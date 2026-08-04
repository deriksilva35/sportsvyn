// components/gridiron/FantasyBoard.js — most-drafted across the mock-draft
// population, showing its real read when data exists, else its dormant frame
// (never mock data). Guarded against thin volume.
//
// THE ADP-MOVERS HALF WAS REMOVED when the Movement card landed above this board
// on /nfl. It diffed the two most-recent snapshots with no epoch and no sample
// floor, so it could show a mover the Movement card deliberately withholds -
// two ADP readings disagreeing on one screen, which makes the gates look
// arbitrary exactly where a reader can see both. One instrument reports ADP
// movement now, and it is the gated one. Its reader (getAdpMovers/adpMovers)
// had no other caller and was deleted with it.
//
// The FFC credit is rendered HERE, not by the host page: this board is the surface
// that shows the ADP data, so the license requirement travels with the component
// and cannot be lost the next time the board is moved or reused. It renders
// unconditionally — both halves are FFC-derived (movers directly, most-drafted via
// each pick's adp_at_pick), and a credit that blinks out with the dormant frame is
// a credit that is missing exactly when someone checks.
import { FFC_ATTRIBUTION } from '@/lib/fantasy/attribution';

const MIN_DRAFTS = 8; // below this, most-drafted is too thin to show as a real read

export default function FantasyBoard({ mostDrafted = [], draftCount = 0 }) {
  const showDrafted = draftCount >= MIN_DRAFTS && mostDrafted.length > 0;

  return (
    <section className="gi-instrument gi-fb" data-surface="ink">
      <div className="gi-instrument-h">The Fantasy Board</div>
      <div className="gi-fb-cols">
        <div className="gi-fb-col">
          <div className="gi-fb-h">Most drafted</div>
          {showDrafted ? (
            <ul className="gi-fb-list">
              {mostDrafted.map((p) => (
                <li key={p.player} className="gi-fb-row">
                  <span className="gi-fb-nm">{p.player} <em>{p.position}</em></span>
                  <span className="gi-fb-pct">{p.pctOfDrafts}%</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="gi-fb-blank">Most-drafted opens as the sim fills up.</div>
          )}
        </div>
      </div>
      <div className="gi-fb-attr">
        {FFC_ATTRIBUTION.text} · <a href={FFC_ATTRIBUTION.url} target="_blank" rel="noopener noreferrer">{FFC_ATTRIBUTION.host}</a>
      </div>
    </section>
  );
}
