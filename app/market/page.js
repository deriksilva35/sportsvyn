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
  hasMovement, MARKET_LEAGUES,
} from '@/lib/market/reads';
import PropsBoard from '@/components/market/PropsBoard';
import PropsTable from '@/components/market/PropsTable';
import PropsFilters from '@/components/market/PropsFilters';
import { LinesTable, FuturesTable } from '@/components/market/LineTable';
import {
  flattenLines, flattenFutures, sortRows, teamShort,
  LINES_COLUMNS, FUTURES_COLUMNS, LINES_PAGE, FUTURES_PAGE,
} from '@/lib/market/lineTables';
import { propsBoard, propsGames, shortName } from '@/lib/market/propsBoard';
import './market.css';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'The Market - Sportsvyn',
  description: 'Where the market is actually pricing NFL, CFB and Premier League games, and how that has changed. Consensus lines across books, de-vigged.',
};

const LEAGUE_LABEL = { nfl: 'NFL', cfb: 'CFB', epl: 'EPL' };
const CHIPS = [['all', 'All'], ['nfl', 'NFL'], ['cfb', 'CFB'], ['epl', 'EPL'], ['movers', 'Movers only']];

/**
 * THE THREE BOARDS THIS PAGE HOLDS.
 *
 * Until now all three rendered stacked on one scroll, which worked while props
 * was a five-card band and stops working the moment it becomes a full board.
 * Tabs give each one a home without changing what any of them says.
 *
 * LEDGER IS PHASE B AND IS ABSENT, NOT DISABLED. A greyed-out tab promises a
 * feature; no tab promises nothing, which is the truth.
 */
const TABS = [['lines', 'Lines'], ['props', 'Props'], ['futures', 'Futures']];
const DEFAULT_TAB = 'lines';

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

/**
 * BOTH AXES SURVIVE EVERY LINK. The league filter and the tab are independent -
 * a reader on PROPS who picks CFB stays on PROPS, and the tab row keeps
 * whatever filter is already applied. Building each href from both is what
 * stops one control silently resetting the other, which is the same fix the
 * /scores toolbar needed when its filters lived in component state.
 *
 * The default tab is omitted from the URL so /market stays /market.
 */
/**
 * Every board control keeps every other control's state. A reader who has
 * filtered to CFB, sorted by implied % and searched "Palmer" and then taps
 * MOVERS ONLY keeps all three - one control silently resetting the others is
 * the bug the /scores toolbar had while its filters lived in component state.
 */
function boardHref(state, tab, view, patch) {
  const next = {
    f: state.league, g: state.group, sort: state.sort, dir: state.dir,
    q: state.q, game: state.game, view: view === 'charts' ? 'charts' : null,
    board: state.boardOnly ? '1' : null, movers: state.moversOnly ? '1' : null,
    ...patch,
  };
  const qs = [`tab=${tab}`];
  if (next.view === 'charts') qs.push('view=charts');
  if (next.f && next.f !== 'all') qs.push(`f=${next.f}`);
  if (next.g && next.g !== 'all') qs.push(`g=${next.g}`);
  if (next.game) qs.push(`game=${next.game}`);
  if (next.sort && next.sort !== 'move') qs.push(`sort=${next.sort}`);
  if (next.dir) qs.push(`dir=${next.dir}`);
  if (next.q) qs.push(`q=${encodeURIComponent(next.q)}`);
  if (next.board) qs.push('board=1');
  if (next.movers) qs.push('movers=1');
  return `/market?${qs.join('&')}`;
}

/** The CARDS/TABLE toggle on LINES and FUTURES, keeping filter and game. */
function viewHref(filter, tab, view, game) {
  const qs = [`tab=${tab}`];
  if (view) qs.push(`view=${view}`);
  if (filter && filter !== 'all') qs.push(`f=${filter}`);
  if (game) qs.push(`game=${game}`);
  return `/market?${qs.join('&')}`;
}

function marketHref(filter, tab) {
  const q = [];
  if (filter && filter !== 'all') q.push(`f=${filter}`);
  if (tab && tab !== DEFAULT_TAB) q.push(`tab=${tab}`);
  return q.length ? `/market?${q.join('&')}` : '/market';
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

      {/* SHORT NAMES, THE ONE EDIT TO A HOMED TAB - and the SOURCE matters.
          Full club names truncate to nonsense in this column at phone width, a
          live defect today. The fix is the TEAM'S OWN ABBREVIATION from the
          teams table, not a name-shortening rule: the props board's
          first-initial-plus-surname is right for people and produces garbage
          for clubs ("TCU Horned Frogs" -> "T. Frogs"). Two different kinds of
          name, two different sources. A club with no abbreviation keeps its
          full name, and Draw is neither team. */}
      {card.h2h.map((s, i) => (
        <Row key={s.label}
          label={i === 0 ? (card.threeWay ? '1X2' : 'ML') : ''}
          sel={teamShort(s.label, card)}
          price={american(s.american)} implied={pct(s.impliedPct)} move={s.moveProb} />
      ))}

      {/* The spread's own price is near-constant at -110; the LINE is the news,
          so the line is the selection and the juice is the price. Soccer's is
          an Asian handicap and reads the same way. */}
      {spread ? (
        <Row label="Spread" sel={`${teamShort(spread.label, card)} ${spread.value ?? ''}`.trim()}
          price={american(spread.american)} implied="" move={spread.moveProb} />
      ) : null}

      {over ? (
        <Row label="Total" sel={`O/U ${over.value ?? ''}`.trim()}
          price={american(over.american)} implied="" move={over.moveProb} />
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
  const rawTab = typeof sp.tab === 'string' ? sp.tab : DEFAULT_TAB;
  const tab = TABS.some(([k]) => k === rawTab) ? rawTab : DEFAULT_TAB;

  // BOARD STATE IS ALL URL STATE, so a board a reader has narrowed is a board
  // they can share. Nothing here is component state.
  // TABLE IS THE DEFAULT VIEW, so it carries no param and every existing props
  // deep link lands on it. Charts is the marked alternate.
  // TWO DEFAULTS, DELIBERATELY OPPOSITE. On PROPS the table is the default
  // (?view=charts is marked); on LINES and FUTURES the CARDS are the default
  // (?view=table is marked). Each tab's unmarked URL renders exactly what it
  // rendered before its second view existed, which is what makes every shipped
  // link safe.
  const view = tab === 'props'
    ? (sp.view === 'charts' ? 'charts' : 'table')
    : (sp.view === 'table' ? 'table' : 'cards');
  const boardState = {
    league: filter === 'movers' ? 'all' : filter,
    game: typeof sp.game === 'string' && sp.game !== '' ? sp.game : null,
    dir: sp.dir === 'asc' || sp.dir === 'desc' ? sp.dir : null,
    group: typeof sp.g === 'string' ? sp.g : 'all',
    sort: typeof sp.sort === 'string' ? sp.sort : (typeof sp.s === 'string' ? sp.s : 'move'),
    q: typeof sp.q === 'string' ? sp.q : '',
    boardOnly: sp.board === '1',
    moversOnly: sp.movers === '1' || filter === 'movers',
  };

  const [byLeague, futures, books, snapAt, boardIds, board, games] = await Promise.all([
    pricedSlate(), futuresBoards(), bookCounts(), latestSnapshotAt(), boardMatchIds(),
    tab === 'props' ? propsBoard(boardState).catch(() => ({ rows: [], total: 0 })) : Promise.resolve(null),
    tab === 'props' ? propsGames().catch(() => []) : Promise.resolve([]),
  ]);

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

  // FLATTENED FROM THE READS THE CARDS ALREADY USE - no new queries and no new
  // numbers, so the table cannot disagree with the cards beside it.
  const linesSort = typeof sp.sort === 'string' ? sp.sort : 'game';
  const futuresSort = typeof sp.sort === 'string' ? sp.sort : 'implied';
  const allLines = tab === 'lines' && view === 'table'
    ? flattenLines(byLeague, { boardIds, leagues, game: boardState.game }) : [];
  const linesTotal = allLines.length;
  const linesRows = sortRows(allLines, LINES_COLUMNS, linesSort, boardState.dir, 'game').slice(0, LINES_PAGE);
  const allFutures = tab === 'futures' && view === 'table' ? flattenFutures(futures) : [];
  const futuresTotal = allFutures.length;
  const futuresRows = sortRows(allFutures, FUTURES_COLUMNS, futuresSort, boardState.dir, 'implied').slice(0, FUTURES_PAGE);

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

        <div className="tabs">
          {TABS.map(([k, label]) => (
            <Link key={k} className={`tab ${tab === k ? 'on' : ''}`} href={marketHref(filter, k)}>{label}</Link>
          ))}
        </div>

        {/* FILTER DEDUPE: the page-level chip row retires on PROPS, where the
            LEAGUE filter row is the single control. Two rows both writing ?f=
            was a control that could disagree with itself on screen. LINES and
            FUTURES keep it - it is the only control they have. */}
        {tab === 'props' ? null : (
          <div className="chips">
            {CHIPS.map(([k, label]) => (
              <Link key={k} className={`ch ${filter === k ? 'on' : ''}`} href={marketHref(k, tab)}>{label}</Link>
            ))}
          </div>
        )}

        {/* LINES — the shipped board, MOVED not edited. Every element below is
            the markup it always was; only its address changed. */}
        {tab === 'lines' && filter === 'movers' && total === 0 ? (
          <div className="emptyband">Nothing has moved in the last 24 hours.</div>
        ) : null}

        {tab === 'lines' ? (
          <>
            <div className="pb-frow">
              <span className="flbl">View</span>
              <Link className={`ch ${view === 'cards' ? 'on' : ''}`} href={viewHref(filter, tab, null, boardState.game)}>Cards</Link>
              <Link className={`ch ${view === 'table' ? 'on' : ''}`} href={viewHref(filter, tab, 'table', boardState.game)}>Table</Link>
            </div>
            {view === 'table' ? (
              <LinesTable rows={linesRows} total={linesTotal} columns={LINES_COLUMNS}
                sort={linesSort} dir={boardState.dir || undefined}
                hrefFor={(patch) => boardHref(boardState, tab, view, patch)} />
            ) : leagues.map((s) => (
              <Band key={s} slug={s} cards={shown.get(s) ?? []} boardIds={boardIds} books={books} />
            ))}
          </>
        ) : null}

        {/* THE FULL BOARD replaces the five-card band. The band's PropsCard is
            retired with it - one props presentation, not two. */}
        {tab === 'props' && board ? (
          <section>
            <PropsFilters state={boardState} games={games} view={view}
              hrefFor={(patch) => boardHref(boardState, tab, view, patch)} />
            {board.rows.length === 0 ? (
              <div className="emptyband">No priced props match those filters.</div>
            ) : view === 'charts' ? (
              <PropsBoard rows={board.rows} total={board.total} state={boardState} chromeless
                hrefFor={(patch) => boardHref(boardState, tab, view, patch)} />
            ) : (
              <PropsTable rows={board.rows} total={board.total}
                sort={boardState.sort} dir={boardState.dir || undefined}
                hrefFor={(patch) => boardHref(boardState, tab, view, patch)} />
            )}
          </section>
        ) : null}

        {tab === 'futures' ? (
          <section>
            <div className="pb-frow">
              <span className="flbl">View</span>
              <Link className={`ch ${view === 'cards' ? 'on' : ''}`} href={viewHref(filter, tab, null, null)}>Cards</Link>
              <Link className={`ch ${view === 'table' ? 'on' : ''}`} href={viewHref(filter, tab, 'table', null)}>Table</Link>
            </div>
            {view === 'table' ? (
              <FuturesTable rows={futuresRows} total={futuresTotal} columns={FUTURES_COLUMNS}
                sort={futuresSort} dir={boardState.dir || undefined}
                counts={futures.map((f) => ({ leagueSlug: f.leagueSlug, priced: f.priced }))}
                hrefFor={(patch) => boardHref(boardState, tab, view, patch)} />
            ) : (
            <>
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
            </>
            )}
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
