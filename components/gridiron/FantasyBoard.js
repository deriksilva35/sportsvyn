// components/gridiron/FantasyBoard.js — ADP movers + most-drafted, each half showing
// its real read when data exists, else its dormant frame (never mock data). ADP
// movers need a second FFC snapshot; most-drafted is guarded against thin volume.
//
// The FFC credit is rendered HERE, not by the host page: this board is the surface
// that shows the ADP data, so the license requirement travels with the component
// and cannot be lost the next time the board is moved or reused. It renders
// unconditionally — both halves are FFC-derived (movers directly, most-drafted via
// each pick's adp_at_pick), and a credit that blinks out with the dormant frame is
// a credit that is missing exactly when someone checks.
import { FFC_ATTRIBUTION } from '@/lib/fantasy/attribution';

const MIN_DRAFTS = 8; // below this, most-drafted is too thin to show as a real read

export default function FantasyBoard({ adp = null, mostDrafted = [], draftCount = 0 }) {
  const showMovers = Boolean(adp?.available && adp.movers.length > 0);
  const showDrafted = draftCount >= MIN_DRAFTS && mostDrafted.length > 0;

  return (
    <section className="gi-instrument gi-fb" data-surface="ink">
      <div className="gi-instrument-h">The Fantasy Board</div>
      <div className="gi-fb-cols">
        <div className="gi-fb-col">
          <div className="gi-fb-h">ADP movers</div>
          {showMovers ? (
            <ul className="gi-fb-list">
              {adp.movers.map((m) => (
                <li key={m.name} className="gi-fb-row">
                  <span className="gi-fb-nm">{m.name} <em>{m.position}</em></span>
                  <span className={`gi-fb-delta ${m.delta > 0 ? 'up' : 'down'}`}>{m.delta > 0 ? `▲ +${m.delta}` : `▼ ${m.delta}`}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="gi-fb-blank">Movers open on the next ADP snapshot.</div>
          )}
        </div>
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
