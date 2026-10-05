'use client';

// components/market/MarketClient.js - the /market board, filtered IN THE
// BROWSER (static /market).
//
// The page is force-static and ships the whole data set - every priced game,
// every future, every prop row - refreshed by the server every 60 s. This
// component reads the URL with useSearchParams and derives the board from it
// through lib/market/marketModel.js, the same parse and the same filters the
// server used to run per request. The URL grammar did not change and every
// href is still marketHref's: there is no second URL builder in this file.
//
// FILTERS ARE HISTORY ENTRIES, NOT NAVIGATIONS (market-diet, sun-13). Every
// control is still a real <a href> / GET form built by marketHref - so a
// filtered board is still a URL you can open, share and reload - but a plain
// click on one that stays on this path is caught here (onClickCapture /
// onSubmitCapture on the board's root) and becomes window.history.pushState.
// Next keeps useSearchParams in step with it, the board re-derives in the
// browser, and NO RSC REQUEST is made: the data is already on the page. The
// Links themselves carry prefetch={false}; with default prefetch each load
// fetched ~7 /market variants of 2.5 MB each, and every one was identical.
//
// PROPS ARE FETCHED, NOT SHIPPED. The static page carries no prop rows; the
// PROPS tab asks /api/market/props for its league or game (edge-cached,
// lib/market/propsWire.js), and the Charts view adds ?part=charts.
//
// THE PRERENDER IS THE UNFILTERED BOARD. useSearchParams on a static page
// renders on the client only, up to the nearest Suspense; the fallback here is
// the same board with no params, so the static HTML is the default /market -
// real rows, not a skeleton - and a filtered URL settles on hydration.

import { Suspense, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import SportsvynSegment from '@/components/shell/SportsvynSegment';
import PropsBoard from '@/components/market/PropsBoard';
import PropsTable from '@/components/market/PropsTable';
import PropsFilters from '@/components/market/PropsFilters';
import PropsIndex from '@/components/market/PropsIndex';
import { LinesTable, FuturesTable } from '@/components/market/LineTable';
import GameFilter from '@/components/market/GameFilter';
import { teamShort, LINES_COLUMNS, FUTURES_COLUMNS } from '@/lib/market/lineTables';
import { marketHref } from '@/lib/market/marketUrl';
import { marketModel, parseMarketUrl, spFrom, CHIPS, TABS } from '@/lib/market/marketModel';
import { isShellClient } from '@/lib/shell/appTabs';
import { propsUrl, unpackProps, unpackCharts, withCharts } from '@/lib/market/propsWire';

const LEAGUE_LABEL = { nfl: 'NFL', cfb: 'CFB', epl: 'EPL' };

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

// SHELL MODE FROM THE COOKIE, CLIENT-SIDE - the AppTabBar pattern. The server
// snapshot is false, so the static HTML carries no segment markup (the web
// never did) and the shell adds it on hydration.
const subscribe = () => () => {};

// ---------------------------------------------------------------------------
// THE PROPS FETCH. One answer per endpoint URL per minute in this tab - the
// same clock as the edge cache behind it - so flipping between tabs and views
// does not refetch. A failure is forgotten at once, never served for a minute.
// A 404 is an answer (no priced props for that game), not an error.
// ---------------------------------------------------------------------------
const WIRE_TTL_MS = 60_000;
const wireMemo = new Map();
export function _resetWireMemo() { wireMemo.clear(); }
function fetchWire(url) {
  const hit = wireMemo.get(url);
  if (hit && Date.now() - hit.at < WIRE_TTL_MS) return hit.p;
  const p = fetch(url).then((r) => {
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`props ${r.status}`);
    return r.json();
  });
  wireMemo.set(url, { at: Date.now(), p });
  p.catch(() => { if (wireMemo.get(url)?.p === p) wireMemo.delete(url); });
  return p;
}

/** { ready, data, error } for an endpoint URL; a null URL is ready with nothing. */
function useWire(url) {
  const [got, setGot] = useState({ url: null, data: null, error: null });
  useEffect(() => {
    if (!url) return undefined;
    let live = true;
    fetchWire(url).then(
      (data) => { if (live) setGot({ url, data, error: null }); },
      (error) => { if (live) setGot({ url, data: null, error }); },
    );
    return () => { live = false; };
  }, [url]);
  if (!url) return { ready: true, data: null, error: null };
  return got.url === url ? { ready: true, data: got.data, error: got.error } : { ready: false, data: null, error: null };
}

// ---------------------------------------------------------------------------
// SAME-PATH LINKS AND FORMS BECOME pushState. Anything else - another path, a
// modified click, a new tab, the pinned /nfl/market chips that lead to the
// network /market - is left to the browser and to Link, exactly as before.
// ---------------------------------------------------------------------------
function samePathUrl(href) {
  if (typeof window === 'undefined' || !href) return null;
  const u = new URL(href, window.location.href);
  if (u.origin !== window.location.origin || u.pathname !== window.location.pathname) return null;
  return u.pathname + u.search;
}
function onBoardClick(e) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target?.closest?.('a[href]');
  if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
  const to = samePathUrl(a.getAttribute('href'));
  if (!to) return;
  e.preventDefault();
  e.stopPropagation();
  if (to !== window.location.pathname + window.location.search) window.history.pushState(null, '', to);
}
function onBoardSubmit(e) {
  const form = e.target;
  if (!form || form.tagName !== 'FORM' || (form.method || 'get').toLowerCase() !== 'get') return;
  const base = samePathUrl(form.getAttribute('action') || window.location.pathname);
  if (!base) return;
  e.preventDefault();
  e.stopPropagation();
  // THE SAME BUILDER AS EVERY LINK. A GET form serialises every named field;
  // marketHref reads them as the patch, drops the emptied ones (All games, a
  // cleared search) and writes the canonical URL the form would have reached.
  const patch = {};
  for (const [k, v] of new FormData(form)) if (typeof v === 'string' && v !== '') patch[k] = v;
  const to = marketHref({}, patch);
  if (to !== window.location.pathname + window.location.search) window.history.pushState(null, '', to);
}
const getShell = () => isShellClient({ cookie: document.cookie });
const getServerShell = () => false;

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
  const live = card.matchStatus === 'live';
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
        {/* A LIVE CARD SAYS SO INSTEAD OF SHOWING A KICKOFF THAT HAS PASSED.
            The slate admits live games; printing "SAT 3:30 PM" beside one
            already being played reads as a game still to come. */}
        <span className="when">
          {live
            ? <i className="live">LIVE</i>
            : (card.kickoffAt ? WHEN.format(new Date(card.kickoffAt)).toUpperCase() : 'TBD')}
        </span>
      </div>
      {/* THE NUMBERS FROZE AT KICKOFF. The consensus stops updating once play
          starts, so a live card stamps its prices rather than letting them
          read as a running line. Same word the props surfaces use. */}
      {live ? <div className="prek">Prices are pre-kick</div> : null}

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

function MarketBody({ data, sp, pinned = null, leagueHeader = null, header = null }) {
  const isShell = useSyncExternalStore(subscribe, getShell, getServerShell);
  // PROPS ON DEMAND. The URL decides the scope (a game, or a league) before
  // any data exists, so the fetch is keyed on it; LINES and FUTURES ask for
  // nothing. Charts add the ten-game history for the same scope.
  const pre = parseMarketUrl(sp, pinned);
  const wantProps = pre.tab === 'props';
  const rowsWire = useWire(wantProps ? propsUrl(pre.boardState) : null);
  const chartsWire = useWire(wantProps && pre.view === 'charts' ? propsUrl(pre.boardState, 'charts') : null);
  const propsRows = useMemo(() => unpackProps(rowsWire.data), [rowsWire.data]);
  const charts = useMemo(() => unpackCharts(chartsWire.data), [chartsWire.data]);
  const propsReady = rowsWire.ready && chartsWire.ready;
  const propsError = rowsWire.error ?? chartsWire.error;
  const model = useMemo(
    () => marketModel({ ...data, propsRows: withCharts(propsRows, charts) }, sp, pinned),
    [data, propsRows, charts, sp, pinned],
  );
  const {
    filter, tab, view, urlState, boardState, board, games, boardIds, books, futures,
    indexTeams, indexStats, shown, total, cardBands, lineGameOptions,
    linesSort, futuresSort, linesRows, linesTotal, futuresRows, futuresTotal,
  } = model;
  const href = (patch) => marketHref(urlState, patch);
  const snap = stamp(data.snapAt);

  return (
    <div className="gi" data-surface="ink" onClickCapture={onBoardClick} onSubmitCapture={onBoardSubmit}>
      {/* THE WORDMARK BAND RENDERS ON EVERY ROUTE. It was gated on the pin,
          which meant the league wearings of this board had no global header at
          all - no wordmark, no way out to the rest of the site. The league
          header goes UNDER it, not instead of it. The header is the page's
          (a client header since static /market); this only places it. */}
      {header ?? null}
      {leagueHeader ?? null}
      {isShell && <SportsvynSegment />}
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
            <Link key={k} prefetch={false} className={`tab ${tab === k ? 'on' : ''}`} href={href({ tab: k })}>{label}</Link>
          ))}
        </div>

        {/* FILTER DEDUPE: the page-level chip row retires on PROPS, where the
            LEAGUE filter row is the single control. Two rows both writing ?f=
            was a control that could disagree with itself on screen. LINES and
            FUTURES keep it - it is the only control they have. */}
        {/* PINNED HIDES THE LEAGUE CHIPS but keeps MOVERS ONLY - it is state,
            not a league, and it is as useful inside /nfl as outside it. */}
        {tab === 'props' ? null : (
          <div className="chips">
            {CHIPS.filter(([k]) => !pinned || k === 'movers').map(([k, label]) => (
              <Link key={k} prefetch={false} className={`ch ${filter === k ? 'on' : ''}`} href={href({ f: k })}>{label}</Link>
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
              <Link prefetch={false} className={`ch ${view === 'cards' ? 'on' : ''}`} href={href({ view: null })}>Cards</Link>
              <Link prefetch={false} className={`ch ${view === 'table' ? 'on' : ''}`} href={href({ view: 'table' })}>Table</Link>
            </div>
            <GameFilter tab="lines" urlState={urlState} games={lineGameOptions}
              current={boardState.game} hrefFor={href} />
            {view === 'table' ? (
              <LinesTable rows={linesRows} total={linesTotal} columns={LINES_COLUMNS}
                sort={linesSort} dir={boardState.dir || undefined}
                hrefFor={href} />
            ) : cardBands.length === 0 ? (
              // The league chip and the game dropdown can be set to disagree -
              // a CFB game with the NFL chip on. Say which one is hiding it
              // rather than leaving a blank page to be read as no prices.
              <div className="emptyband">
                That game is not in the selected league. <Link prefetch={false} href={href({ f: null })}>Show all leagues</Link>.
              </div>
            ) : cardBands.map((s) => (
              <Band key={s} slug={s} cards={shown.get(s) ?? []} boardIds={boardIds} books={books} />
            ))}
          </>
        ) : null}

        {/* THE FULL BOARD replaces the five-card band. The band's PropsCard is
            retired with it - one props presentation, not two. */}
        {tab === 'props' && board ? (
          <section>
            <PropsFilters state={boardState} games={games} view={view} urlState={urlState}
              hrefFor={href} />
            {!propsReady ? (
              <div className="emptyband">Loading props...</div>
            ) : propsError ? (
              <div className="emptyband">Props could not be loaded just now. Try again in a minute.</div>
            ) : view === 'index' ? (
              /* THE INDEX carries its own filter stack (sport / team / pos /
                 stat / hit) and its own empty state, because "loosen a filter"
                 is the only useful thing to say to a reader who narrowed five
                 of them. It is not wrapped in the rows.length check above for
                 that reason. */
              <PropsIndex
                rows={board.rows}
                filtered={board.filtered ?? board.rows.length}
                state={boardState}
                /* ONE KEY PER PATCH, and this is not style. marketHref merges
                   { ...current, ...patch }, so a key present-but-undefined
                   OVERWRITES the current value and then serialises to nothing -
                   which would make every chip tap silently clear the other four
                   filters. The patch is built from the key actually being set. */
                hrefFor={(patch) => {
                  const out = {};
                  if ('league' in patch) { out.f = patch.league === 'all' ? null : patch.league; out.team = null; }
                  if ('team' in patch) out.team = patch.team === 'all' ? null : patch.team;
                  if ('pos' in patch) out.pos = patch.pos === 'all' ? null : patch.pos;
                  if ('marketType' in patch) out.mkt = patch.marketType === 'all' ? null : patch.marketType;
                  if ('minHitPct' in patch) out.hit = Number(patch.minHitPct) > 0 ? String(patch.minHitPct) : null;
                  if ('sort' in patch) out.sort = patch.sort;
                  return href(out);
                }}
                teams={indexTeams}
                stats={indexStats}
                cardHref={(r) => (r.playerSlug
                  ? `/market/props/${r.playerSlug}?match=${r.matchId}` : null)}
              />
            ) : board.rows.length === 0 ? (
              <div className="emptyband">No priced props match those filters.</div>
            ) : view === 'charts' ? (
              <PropsBoard rows={board.rows} total={board.total} state={boardState} chromeless
                hrefFor={href} />
            ) : (
              <PropsTable rows={board.rows} total={board.total}
                sort={boardState.sort} dir={boardState.dir || undefined}
                hrefFor={href} />
            )}
          </section>
        ) : null}

        {tab === 'futures' ? (
          <section>
            <div className="pb-frow">
              <span className="flbl">View</span>
              <Link prefetch={false} className={`ch ${view === 'cards' ? 'on' : ''}`} href={href({ view: null })}>Cards</Link>
              <Link prefetch={false} className={`ch ${view === 'table' ? 'on' : ''}`} href={href({ view: 'table' })}>Table</Link>
            </div>
            {/* NO GAME DROPDOWN ON FUTURES, and not as an oversight: a title
                market has no game to be filtered to. A control that could
                only ever empty the tab is worse than an absent one. */}
            {view === 'table' ? (
              <FuturesTable rows={futuresRows} total={futuresTotal} columns={FUTURES_COLUMNS}
                sort={futuresSort} dir={boardState.dir || undefined}
                counts={futures.map((f) => ({ leagueSlug: f.leagueSlug, priced: f.priced }))}
                hrefFor={href} />
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

function WithParams(props) {
  const params = useSearchParams();
  return <MarketBody {...props} sp={spFrom(params)} />;
}

export default function MarketClient(props) {
  return (
    <Suspense fallback={<MarketBody {...props} sp={{}} />}>
      <WithParams {...props} />
    </Suspense>
  );
}
