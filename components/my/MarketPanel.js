/**
 * MarketPanel: server component.
 *
 * The Market read for /my: the currently-tagged rows (generous / rich / wide)
 * from getMarketPanelData — 1x2 selections + totals tail lines across upcoming
 * scheduled matches. Row is selection label + tag chip / matchup sub-line with
 * price, market→model, and gap. Tournament-wide data; followedSet only drives
 * the volt treatment on rows where a followed team plays. WIDE rows read quieter
 * (muted) — they are disclosures of disagreement, not value. Footer carries the
 * ledger stats once anything has graded. No picks, no book.
 */

const TAG_CHIP = { generous: 'gen', rich: 'rich', wide: 'wide' };
const TAG_LABEL = { generous: 'Generous', rich: 'Rich', wide: 'Wide' };

function fmtAmerican(odds) {
  if (odds == null) return '';
  return odds > 0 ? `+${odds}` : String(odds);
}

function LedgerLine({ ledger }) {
  if (!ledger) return null;
  const parts = [`${ledger.tagged} tagged`, `${ledger.landed} landed`];
  if (ledger.implied_expectation_pct != null) parts.push(`prices implied ${ledger.implied_expectation_pct}%`);
  return <div className="mkt-foot">{parts.join(' · ')}</div>;
}

export default function MarketPanel({ rows, ledger, followedSet }) {
  const list = Array.isArray(rows) ? rows : [];

  if (list.length === 0) {
    return (
      <section className="panel panel-market">
        <h2 className="phead">
          The Market
          <a className="phead-action" href="/market">Full board {'→'}</a>
        </h2>
        <div className="pbody">
          <p className="grp-empty">No reads on the board right now.</p>
        </div>
        <LedgerLine ledger={ledger} />
      </section>
    );
  }

  return (
    <section className="panel panel-market">
      <h2 className="phead">
        The Market
        <a className="phead-action" href="/market">Full board {'→'}</a>
      </h2>
      <div className="pbody">
        {list.map((r) => {
          const homeFollowed = r.home_id != null && followedSet?.has(r.home_id);
          const awayFollowed = r.away_id != null && followedSet?.has(r.away_id);
          const followed = homeFollowed || awayFollowed;
          const cls = `mkt-row${followed ? ' is-followed' : ''}${r.tag === 'wide' ? ' is-wide' : ''}`;
          return (
            <div key={r.key} className={cls}>
              <div className="mkt-top">
                <span className="mkt-sel">{r.selection_label}</span>
                <span className={`tag ${TAG_CHIP[r.tag]}`}>{TAG_LABEL[r.tag]}</span>
              </div>
              <div className="mkt-sub">
                <span className="mkt-match">
                  {r.home_flag && <span className="mkt-flag" style={{ backgroundImage: `url(${r.home_flag})` }} aria-hidden="true" />}
                  <span className={homeFollowed ? 'is-vt' : ''}>{r.home_abbr}</span>
                  <span className="mkt-vs">{'–'}</span>
                  {r.away_flag && <span className="mkt-flag" style={{ backgroundImage: `url(${r.away_flag})` }} aria-hidden="true" />}
                  <span className={awayFollowed ? 'is-vt' : ''}>{r.away_abbr}</span>
                </span>
                <span className="mkt-nums">
                  <span className="mkt-price">{fmtAmerican(r.american)}</span>
                  <span className="mkt-pcts">
                    {r.market_pct.toFixed(0)}%<span className="mkt-arrow">{'→'}</span>{r.model_pct.toFixed(0)}%
                  </span>
                  <span className="mkt-gap">{`${r.gap >= 0 ? '+' : ''}${r.gap.toFixed(1)}`}</span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <LedgerLine ledger={ledger} />
    </section>
  );
}
