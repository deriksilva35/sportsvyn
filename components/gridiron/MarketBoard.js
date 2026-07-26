// components/gridiron/MarketBoard.js — biggest de-vigged h2h implied-prob moves for
// the league's scheduled games (real reads). Empty until movement accrues, then it
// renders live. "No picks, no books."

import { MARKET_FINE } from './leagueCopy';

export default function MarketBoard({ movers = [] }) {
  return (
    <section className="gi-instrument gi-mb" data-surface="ink">
      <div className="gi-instrument-h gi-ed-h"><span>The Market Board</span><span className="gi-ed-kick">Biggest moves · this week</span></div>
      {movers.length === 0 ? (
        <div className="gi-mb-blank">Line moves open here as the market starts to run.</div>
      ) : (
        <ul className="gi-mb-list">
          {movers.map((m) => (
            <li key={m.label} className="gi-mb-row">
              <span className="gi-mb-pair">{m.label}</span>
              <span className="gi-mb-line">{m.prevPct != null ? `${m.prevPct.toFixed(0)}%` : '—'}</span>
              <span className="gi-mb-arrow">→</span>
              <span className="gi-mb-now">{m.nowPct != null ? `${m.nowPct.toFixed(0)}%` : '—'}</span>
              <span className={`gi-mb-chip ${m.move > 0 ? 'up' : 'dn'}`}>
                {m.move > 0 ? `▲ ${m.move.toFixed(1)}` : `▼ ${Math.abs(m.move).toFixed(1)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="gi-mb-fine">{MARKET_FINE}</div>
    </section>
  );
}
