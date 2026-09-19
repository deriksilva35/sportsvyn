// components/gridiron/PropsPanel.js — the game page's player-prop read.
//
// Pre-game AND LIVE, mounted under OddsStrip behind the same guard. Renders
// null when there are no priced props, which is the common case: props are
// scoped to the current game week and the Pick'em board, so most games never
// have any and a permanent empty panel would read as broken rather than as
// not-applicable. A FINAL NEVER REACHES HERE - the reader's slate excludes it,
// because once the game is over the price is history and the result belongs to
// the page itself.
//
// A LIVE GAME'S NUMBERS ARE A STAMP, NOT A QUOTE. The consensus stops updating
// at kickoff, so the panel says "pre-kick" - the same word the props index and
// the player card use - rather than letting a frozen price read as current.
//
// THE NON-EXCLUSIVITY NOTE RIDES WITH THE NUMBERS. Anytime prices are stored
// raw and single-sided - several players score in one game, so the field sums
// far above 100. A reader assuming these were de-vigged would draw a false
// conclusion from true numbers.

export default function PropsPanel({ card, leagueSlug, matchId }) {
  if (!card?.rows?.length) return null;
  const american = (n) => (n == null ? '—' : n > 0 ? `+${n}` : `${n}`);
  return (
    <section className="gi-props" aria-label="Player props">
      <div className="gi-props-h">
        <span className="lbl">Player props</span>
        <span className="src">
          {card.matchStatus === 'live'
            ? <><i className="live">LIVE</i> · prices are pre-kick</>
            : 'Market · pre-kickoff consensus'}
        </span>
      </div>
      {/* A ROW OPENS THE PLAYER'S CARD when we know who it is about. An
          unlinked row keeps every number it had and is simply not a link -
          the resolver could not name the player, and a link to a card we
          cannot build is worse than no link. */}
      {card.rows.map((r) => {
        const body = (
          <>
            <span className="mk">{r.marketLabel}</span>
            <span className="who">{r.label}{r.value ? ` ${r.value}` : ''}</span>
            <span className="px">{american(r.american)}</span>
            <span className="imp">{r.impliedPct == null ? '' : `${r.impliedPct.toFixed(1)}%`}</span>
          </>
        );
        const key = `${r.marketType}:${r.label}`;
        return r.playerSlug && matchId
          ? (
            <a className="gi-props-row" key={key}
              href={`/market/props/${r.playerSlug}?match=${matchId}`}>{body}</a>
          )
          : <div className="gi-props-row" key={key}>{body}</div>;
      })}
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
          plumbing: the param the chips already write is the param this reads.
          NOW THE GAME'S OWN SHEET: a reader arriving from a game's market
          module wants THAT game's props, not the whole board filtered to its
          league. ?game= is the narrower, truer destination; the league link
          remains the fallback when no match id is to hand. */}
      <a className="gi-market-cta" href={matchId ? `/market?tab=props&game=${matchId}` : (leagueSlug ? `/market?tab=props&f=${leagueSlug}` : '/market?tab=props')}>
        Full market &rarr;
      </a>
    </section>
  );
}
