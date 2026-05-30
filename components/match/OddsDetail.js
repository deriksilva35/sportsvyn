/**
 * OddsDetail — body of the "Odds & Projections" tab.
 *
 * Renders the current Match Winner (1X2) consensus across all books:
 * American odds, decimal odds, de-vigged implied probability, side by
 * side across the three outcomes. Volt-tints the column that the market
 * implies is most likely (home > away, or vice versa).
 *
 * Metadata footer surfaces num_books + last-fetched relative time so the
 * reader knows freshness without making them guess.
 *
 * Graceful empty: when odds === null (no current rows in odds_markets
 * for this match), renders the same tab-stub treatment used by other
 * unwired tabs — honest "not priced yet" with no fake numbers.
 */

function formatAmerican(odds) {
  if (odds == null) return '—';
  return odds > 0 ? `+${odds}` : String(odds);
}

function formatDecimal(odds) {
  if (odds == null) return '—';
  return Number(odds).toFixed(3);
}

function formatPct(pct) {
  if (pct == null) return '—';
  return `${Number(pct).toFixed(1)}%`;
}

function relativeTime(date) {
  if (!date) return null;
  const then = new Date(date).getTime();
  if (Number.isNaN(then)) return null;
  const now = Date.now();
  const diffSec = Math.max(0, Math.round((now - then) / 1000));
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (diffSec < 60) return rtf.format(-diffSec, 'second');
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return rtf.format(-diffMin, 'minute');
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 48) return rtf.format(-diffHr, 'hour');
  const diffDay = Math.round(diffHr / 24);
  return rtf.format(-diffDay, 'day');
}

export default function OddsDetail({ odds = null, homeName, awayName }) {
  if (!odds) {
    return <div className="tab-stub">Odds populate as books price the match.</div>;
  }

  // Favored side (highest implied % among home/away — draw not eligible)
  let favoredSide = null;
  if (odds.home.implied_pct > odds.away.implied_pct) favoredSide = 'home';
  else if (odds.away.implied_pct > odds.home.implied_pct) favoredSide = 'away';

  const reltime = relativeTime(odds.fetched_at);
  const homeFav = favoredSide === 'home' ? ' favored' : '';
  const awayFav = favoredSide === 'away' ? ' favored' : '';

  return (
    <div className="odds-detail">
      <div className="odds-detail-header">
        <div className="odds-detail-title">Match Winner (1X2)</div>
        <div className="odds-detail-meta">
          Consensus median{odds.num_books ? ` · ${odds.num_books} books` : ''}
          {reltime ? ` · updated ${reltime}` : ''}
        </div>
      </div>

      <div className="odds-detail-table">
        {/* Column headers (team names) */}
        <div className="col-head"></div>
        <div className={`col-head team-name${homeFav}`}>{homeName ?? 'Home'}</div>
        <div className="col-head team-name">Draw</div>
        <div className={`col-head team-name${awayFav}`}>{awayName ?? 'Away'}</div>

        {/* American odds row */}
        <div className="row-label">American</div>
        <div className={`cell${homeFav}`}>{formatAmerican(odds.home.american_odds)}</div>
        <div className="cell">{formatAmerican(odds.draw.american_odds)}</div>
        <div className={`cell${awayFav}`}>{formatAmerican(odds.away.american_odds)}</div>

        {/* Decimal odds row */}
        <div className="row-label">Decimal</div>
        <div className={`cell${homeFav}`}>{formatDecimal(odds.home.decimal_odds)}</div>
        <div className="cell">{formatDecimal(odds.draw.decimal_odds)}</div>
        <div className={`cell${awayFav}`}>{formatDecimal(odds.away.decimal_odds)}</div>

        {/* Implied probability row */}
        <div className="row-label">Implied</div>
        <div className={`cell${homeFav}`}>{formatPct(odds.home.implied_pct)}</div>
        <div className="cell">{formatPct(odds.draw.implied_pct)}</div>
        <div className={`cell${awayFav}`}>{formatPct(odds.away.implied_pct)}</div>
      </div>

      <div className="odds-detail-footer">
        De-vigged probabilities sum to 100%
      </div>
    </div>
  );
}
