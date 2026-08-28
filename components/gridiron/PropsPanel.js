// components/gridiron/PropsPanel.js — the game page's player-prop read.
//
// Pre-game only, mounted under OddsStrip behind the same guard. Renders null
// when there are no priced props, which is the common case: props are scoped to
// the current game week and the Pick'em board, so most games never have any and
// a permanent empty panel would read as broken rather than as not-applicable.
//
// THE NON-EXCLUSIVITY NOTE RIDES WITH THE NUMBERS. Anytime prices are stored
// raw and single-sided - several players score in one game, so the field sums
// far above 100. A reader assuming these were de-vigged would draw a false
// conclusion from true numbers.

export default function PropsPanel({ card, leagueSlug }) {
  if (!card?.rows?.length) return null;
  const american = (n) => (n == null ? '—' : n > 0 ? `+${n}` : `${n}`);
  return (
    <section className="gi-props" aria-label="Player props">
      <div className="gi-props-h">
        <span className="lbl">Player props</span>
        <span className="src">Market · pre-kickoff consensus</span>
      </div>
      {card.rows.map((r) => (
        <div className="gi-props-row" key={`${r.marketType}:${r.label}`}>
          <span className="mk">{r.marketLabel}</span>
          <span className="who">{r.label}{r.value ? ` ${r.value}` : ''}</span>
          <span className="px">{american(r.american)}</span>
          <span className="imp">{r.impliedPct == null ? '' : `${r.impliedPct.toFixed(1)}%`}</span>
        </div>
      ))}
      {card.overflow > 0 ? <div className="gi-props-more">+{card.overflow} more priced</div> : null}
      {card.hasAnytime ? (
        <div className="gi-props-note">
          Anytime prices are as offered, not de-vigged - several players can score,
          so these do not sum to 100.
        </div>
      ) : null}
      {/* FULL MARKET. The board's filter is URL state (?f=), which already
          exists for the chips - so this deep-links to the reader's own league
          rather than dropping them at the top of a three-league page. No new
          plumbing: the param the chips already write is the param this reads. */}
      <a className="gi-market-cta" href={leagueSlug ? `/market?f=${leagueSlug}` : '/market'}>
        Full market &rarr;
      </a>
    </section>
  );
}
