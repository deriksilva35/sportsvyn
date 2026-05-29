/**
 * WinProbability — rail slot for the 3-way market consensus from
 * odds_markets (after de-vig). Renders null when no odds are available —
 * the block is hidden entirely, NOT shown empty, since absence is more
 * honest than a percentage placeholder.
 */

export default function WinProbability({ probability = null, homeName, awayName }) {
  if (!probability) return null;

  const { home_pct, draw_pct, away_pct } = probability;

  return (
    <div className="winprob-prematch">
      <div className="winprob-prematch-label">
        <span>Win Probability</span>
        <span className="source">Market consensus</span>
      </div>
      <div className="winprob-prematch-bars" role="img" aria-label="Win probability bars">
        <div className="bar home" style={{ width: `${home_pct}%` }}>
          {home_pct.toFixed(1)}%
        </div>
        <div className="bar draw" style={{ width: `${draw_pct}%` }}>
          {draw_pct.toFixed(1)}%
        </div>
        <div className="bar away" style={{ width: `${away_pct}%` }}>
          {away_pct.toFixed(1)}%
        </div>
      </div>
      <div className="winprob-prematch-rows">
        <div className="winprob-prematch-cell home">
          <div className="team">{homeName ?? 'Home'}</div>
          <div className="pct">{home_pct.toFixed(1)}%</div>
        </div>
        <div className="winprob-prematch-cell">
          <div className="team">Draw</div>
          <div className="pct">{draw_pct.toFixed(1)}%</div>
        </div>
        <div className="winprob-prematch-cell">
          <div className="team">{awayName ?? 'Away'}</div>
          <div className="pct">{away_pct.toFixed(1)}%</div>
        </div>
      </div>
    </div>
  );
}
