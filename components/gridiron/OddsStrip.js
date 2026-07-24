// components/gridiron/OddsStrip.js — pre-game h2h consensus for the /scores card
// Why-Watch pane. Ink surface, tokens per design-tokens v1.1, JetBrains Mono for
// all numbers. The 2-way analog of the soccer WinProbability rail (no draw cell).
//
// Renders null when there is no clean two-sided h2h read — absence over inference,
// never a placeholder. Placement gates this to scheduled games (freeze-at-kickoff),
// so the strip is inherently a pre-kickoff read.

import {
  normalizeTwoWayPct, formatAmerican, formatSignedPct, probDirection, relativeTime,
} from '@/lib/gridiron/oddsFormat';

function Side({ side, pct, fav }) {
  const dir = probDirection(side.moveProb);
  const american = formatAmerican(side.american);
  return (
    <div className={`gi-odds-side ${fav ? 'fav' : ''}`}>
      <div className="abbr">{side.abbr}</div>
      <div className="pct">
        {pct.toFixed(1)}%
        {dir !== 'flat' && (
          <span className={`mv ${dir}`}>{dir === 'up' ? '▲' : '▼'} {formatSignedPct(side.moveProb)}</span>
        )}
      </div>
      {american && <div className="am">{american}</div>}
    </div>
  );
}

export default function OddsStrip({ odds }) {
  if (!odds || !odds.home || !odds.away) return null;
  // Order away | home to match the card's away-over-home team lines.
  const pct = normalizeTwoWayPct(odds.away.implied, odds.home.implied);
  if (!pct) return null;
  const awayPct = pct.a;
  const homePct = pct.b;
  const homeFav = homePct >= awayPct;
  const books = odds.numBooks ?? (odds.sourceBooks?.length || null);
  const updated = relativeTime(odds.fetchedAt);

  return (
    <div className="gi-odds">
      <div className="gi-odds-h">
        <span className="lbl">Win Probability</span>
        <span className="src">Market · pre-kickoff consensus</span>
      </div>
      <div className="gi-odds-bar" role="img" aria-label="Win probability">
        <div className={`seg away ${!homeFav ? 'fav' : ''}`} style={{ width: `${awayPct}%` }} />
        <div className={`seg home ${homeFav ? 'fav' : ''}`} style={{ width: `${homePct}%` }} />
      </div>
      <div className="gi-odds-sides">
        <Side side={odds.away} pct={awayPct} fav={!homeFav} />
        <Side side={odds.home} pct={homePct} fav={homeFav} />
      </div>
      <div className="gi-odds-fine">
        {books != null ? `Consensus of ${books} book${books === 1 ? '' : 's'}` : 'Market consensus'}
        {updated ? ` · updated ${updated}` : ''}
      </div>
    </div>
  );
}
