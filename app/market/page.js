/**
 * /market — The Market. PHASE A: the price read, three leagues, one feed.
 *
 * WHAT THIS PAGE REPLACED. Until this relay it served a World Cup board whose
 * last match was 19 Jul 2026, under a headline reading "The Market · World Cup"
 * and a board reading "No priced markets right now." It was public, linked from
 * the site footer, and sitemapped at priority 0.8 — a dead tournament
 * advertised to every crawler that asked. The WC retirement swept /my and did
 * not reach here.
 *
 * ONE SURFACE, ONE SOURCE. Every number is an odds_markets row written by The
 * Odds API ingest. The API-Sports soccer feed still serves the soccer match
 * pages and is filtered out here by fetcher_version. Two vendors' consensus
 * prices are not comparable and are never blended into one number.
 *
 * PHASE A ENDS AT THE TOTAL ROW. The mock shows a modelline (MODEL x% · GAP)
 * and a LEDGER band; both need the gridiron model that does not exist yet, and
 * both are Phase B. They are ABSENT here, not empty — the keep-their-place law
 * governs sections whose data happens to be missing today, not features that
 * have not been built. An empty ledger would promise a grade sheet we cannot
 * yet write, which is the one thing a page about honesty must not do.
 *
 * NO VOLT ON PRICES. Volt is structural only — band heads and the active chip.
 * The board recommends nothing, so nothing on it is highlighted as an
 * opportunity. Movement is jade/terra because direction is a fact.
 */

import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import Link from 'next/link';
import {
  pricedSlate, futuresBoards, bookCounts, latestSnapshotAt, boardMatchIds,
  hasMovement, propsSlate, MARKET_LEAGUES,
} from '@/lib/market/reads';
import './market.css';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'The Market - Sportsvyn',
  description: 'Where the market is actually pricing NFL, CFB and Premier League games, and how that has changed. Consensus lines across books, de-vigged.',
};

const LEAGUE_LABEL = { nfl: 'NFL', cfb: 'CFB', epl: 'EPL' };
const CHIPS = [['all', 'All'], ['nfl', 'NFL'], ['cfb', 'CFB'], ['epl', 'EPL'], ['movers', 'Movers only']];

const WHEN = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit',
});
const DAY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });

function stamp(d) {
  if (!d) return null;
  const p = DAY.formatToParts(new Date(d)).reduce((a, x) => (a[x.type] = x.value, a), {});
  return `${p.year}-${p.month}-${p.day}`;
}
const american = (n) => (n == null ? '—' : n > 0 ? `+${n}` : `${n}`);
const pct = (n) => (n == null ? '' : `${n.toFixed(1)}%`);

function marketHref(filter) {
  return filter === 'all' ? '/market' : `/market?f=${filter}`;
}

/**
 * THE MOVEMENT GLYPH. Three states, and the third is the one that matters:
 * a dash is NOT zero. Null means no 24h baseline has been stamped for this
 * selection yet, which is "not observed", not "did not move" — and printing
 * ▲0.0 for it would invent an observation.
 */
function Move({ v }) {
  if (v == null || v === 0) return <span className="mv mut">—</span>;
  const up = v > 0;
  return (
    <span className={`mv ${up ? 'jade' : 'terra'}`}>
      {up ? '▲' : '▼'}{Math.abs(v).toFixed(1)}
    </span>
  );
}

function Row({ label, sel, price, implied, move }) {
  return (
    <div className="mrow">
      <span className="lbl">{label}</span>
      <span className="sel">{sel}</span>
      <span className="px">{price}</span>
      <span className="imp">{implied}</span>
      <Move v={move} />
    </div>
  );
}

function Card({ card, onBoard }) {
  const away = card.away.abbreviation || card.away.name || 'TBD';
  const home = card.home.abbreviation || card.home.name || 'TBD';
  const spread = card.spread.length ? card.spread[0] : null;
  const over = card.total.find((s) => s.label === 'Over') ?? null;
  return (
    <div className="g">
      <div className="top">
        <span className="match">
          {away} at {home}
          {onBoard ? <> <span className="boardpill">Board</span></> : null}
        </span>
        <span className="when">{card.kickoffAt ? WHEN.format(new Date(card.kickoffAt)).toUpperCase() : 'TBD'}</span>
      </div>

      {card.h2h.map((s, i) => (
        <Row key={s.label}
          label={i === 0 ? (card.threeWay ? '1X2' : 'ML') : ''}
          sel={s.label} price={american(s.american)} implied={pct(s.impliedPct)} move={s.moveProb} />
      ))}

      {/* The spread's own price is near-constant at -110; the LINE is the news,
          so the line is the selection and the juice is the price. Soccer's is
          an Asian handicap and reads the same way. */}
      {spread ? (
        <Row label="Spread" sel={`${spread.label} ${spread.value ?? ''}`.trim()}
          price={american(spread.american)} implied="" move={spread.moveProb} />
      ) : null}

      {over ? (
        <Row label="Total" sel={`O/U ${over.value ?? ''}`.trim()}
          price={american(over.american)} implied="" move={over.moveProb} />
      ) : null}
    </div>
  );
}

/**
 * A PROPS CARD, in the board's own mrow grammar. Same five columns, so the two
 * bands read as one page rather than two features.
 *
 * THE NON-EXCLUSIVITY NOTE IS NOT DECORATION. Anytime prices are stored raw and
 * single-sided because several players score in one game - the outcomes are not
 * mutually exclusive and the field sums far above 100 (577% on a live NFL card).
 * A reader who assumes these are de-vigged probabilities would draw a false
 * conclusion from true numbers, so the card says so where the numbers are.
 */
export function PropsCard({ card, onBoard }) {
  const away = card.away.abbreviation || card.away.name || 'TBD';
  const home = card.home.abbreviation || card.home.name || 'TBD';
  return (
    <div className="g">
      <div className="top">
        <span className="match">
          {away} at {home}
          {onBoard ? <> <span className="boardpill">Board</span></> : null}
        </span>
        <span className="when">{card.kickoffAt ? WHEN.format(new Date(card.kickoffAt)).toUpperCase() : 'TBD'}</span>
      </div>
      {card.rows.map((r) => (
        <Row key={`${r.marketType}:${r.label}`}
          label={r.marketLabel}
          sel={`${r.label}${r.value ? ` ${r.value}` : ''}`}
          price={american(r.american)}
          implied={r.impliedPct == null ? '' : pct(r.impliedPct)}
          move={r.moveProb} />
      ))}
      {card.overflow > 0 ? (
        <div className="overflow">+{card.overflow} more priced</div>
      ) : null}
      {card.hasAnytime ? (
        <div className="propnote">
          Anytime prices are as offered, not de-vigged - several players can score,
          so these do not sum to 100.
        </div>
      ) : null}
    </div>
  );
}

function Band({ slug, cards, boardIds, books }) {
  const n = books.get(slug);
  const note = [
    cards.length ? `${cards.length} priced` : null,
    n ? `median of ${n} books, de-vigged` : null,
  ].filter(Boolean).join(' · ');
  return (
    <section key={slug}>
      <div className="bandhead">
        <span className="b">{LEAGUE_LABEL[slug] ?? slug.toUpperCase()}</span>
        <span className="c">{note}</span>
      </div>
      {cards.length === 0 ? (
        <div className="emptyband">No priced {LEAGUE_LABEL[slug] ?? slug} markets right now.</div>
      ) : (
        <div className="grid">
          {cards.map((c) => <Card key={c.matchId} card={c} onBoard={boardIds.has(c.matchId)} />)}
        </div>
      )}
    </section>
  );
}

export default async function MarketPage({ searchParams }) {
  const sp = (await searchParams) ?? {};
  const raw = typeof sp.f === 'string' ? sp.f : 'all';
  const filter = CHIPS.some(([k]) => k === raw) ? raw : 'all';

  const [byLeague, futures, books, snapAt, boardIds, props] = await Promise.all([
    pricedSlate(), futuresBoards(), bookCounts(), latestSnapshotAt(), boardMatchIds(),
    propsSlate().catch(() => []),
  ]);
  // BOARD GAMES FIRST here too - the same editorial rule the CFB band uses.
  props.sort((a, b) => (boardIds.has(b.matchId) ? 1 : 0) - (boardIds.has(a.matchId) ? 1 : 0));

  // BOARD GAMES FIRST, WITHIN CFB — the only editorial ordering on the page.
  // Everything else is kickoff order, because a record of what the market is
  // doing has no other opinion about which game matters.
  const cfb = byLeague.get('cfb') ?? [];
  cfb.sort((a, b) => (boardIds.has(b.matchId) ? 1 : 0) - (boardIds.has(a.matchId) ? 1 : 0));

  const leagues = MARKET_LEAGUES.filter((s) => filter === 'all' || filter === 'movers' || filter === s);
  const shown = new Map();
  for (const s of leagues) {
    const list = byLeague.get(s) ?? [];
    shown.set(s, filter === 'movers' ? list.filter(hasMovement) : list);
  }
  const total = [...shown.values()].reduce((a, l) => a + l.length, 0);
  const snap = stamp(snapAt);

  return (
    <div className="gi" data-surface="ink">
      <GlobalHeaderServer activeNav="market" />
      <div className="mk-wrap">
        <div className="mk-head">
          <div className="kicker">NFL · CFB · EPL · Lines</div>
          {/* THE REVERSE DOOR. /scores points here; this points back. A
              cross-link that only runs one way teaches readers the two boards
              are a hierarchy rather than siblings. */}
          <Link className="gi-cross" href="/scores">Scoreboard &rarr;</Link>
        </div>
        <h1 className="h1">The Market</h1>
        <p className="stance">
          Where the market is actually pricing games, and how that has changed. Not a pick.
          Not a recommendation. A record of what the books are doing.
        </p>
        <div className="meta">
          {snap ? `SNAPSHOT ${snap} · ` : ''}CONSENSUS ACROSS BOOKS, DE-VIGGED · UPDATED EVERY 15 MIN
        </div>

        <div className="chips">
          {CHIPS.map(([k, label]) => (
            <Link key={k} className={`ch ${filter === k ? 'on' : ''}`} href={marketHref(k)}>{label}</Link>
          ))}
        </div>

        {filter === 'movers' && total === 0 ? (
          <div className="emptyband">Nothing has moved in the last 24 hours.</div>
        ) : null}

        {leagues.map((s) => (
          <Band key={s} slug={s} cards={shown.get(s) ?? []} boardIds={boardIds} books={books} />
        ))}

        {props.length && (filter === 'all' || filter === 'movers') ? (
          <section>
            <div className="bandhead">
              <span className="b">Player props</span>
              <span className="c">{props.length} game{props.length === 1 ? '' : 's'} priced · board games first</span>
            </div>
            <div className="grid">
              {props.map((c) => (
                <PropsCard key={c.matchId} card={c} onBoard={boardIds.has(c.matchId)} />
              ))}
            </div>
          </section>
        ) : null}

        {filter === 'all' || filter === 'movers' ? (
          <section>
            <div className="bandhead">
              <span className="b">Futures</span>
              <span className="c">Championship winners · top 5 shown</span>
            </div>
            <div className="grid">
              {futures.map((f) => (
                <div className="g" key={f.leagueSlug}>
                  <div className="top">
                    <span className="match">{LEAGUE_LABEL[f.leagueSlug] ?? f.leagueSlug.toUpperCase()} · Title</span>
                    <span className="when">{f.priced} priced</span>
                  </div>
                  {f.top.map((t) => (
                    <div className="frow" key={t.label}>
                      <span className="sel">{t.label}</span>
                      <span className="r">{american(t.american)} <span className="mut">{pct(t.impliedPct)}</span></span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <p className="note">
          Consensus is the median price across the books we read, with the overround removed so
          the outcomes of a market sum to 100%. Movement is the change in de-vigged probability
          against a baseline stamped once a day. A dash means no baseline yet, which is not the
          same as no movement. No picks, no units, no sportsbook links.
        </p>
      </div>
    </div>
  );
}
