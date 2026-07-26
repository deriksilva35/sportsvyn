// components/gridiron/FantasyBoard.js — ADP movers + most-drafted, each half showing
// its real read when data exists, else its dormant frame (never mock data). ADP
// movers need a second FFC snapshot; most-drafted is guarded against thin volume.

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
    </section>
  );
}
