// components/market/PropsFilters.js — the props tab's one control surface.
//
// FILTER DEDUPE. The page-level league chips retire on this tab: LEAGUE lives
// in the filter stack here and nowhere else. Two chip rows both writing ?f=
// was a control that could disagree with itself on screen, and the mock is
// right that one is enough. LINES and FUTURES keep the page-level row, which
// is the only control they have.
//
// SHARED BY BOTH VIEWS. The same filters drive the table and the charts, so
// toggling the view keeps every narrowing a reader has done - including the
// selected game.

import Link from 'next/link';
import { MARKET_GROUPS } from '@/lib/market/propsBoard';

const LEAGUES = [['all', 'All'], ['nfl', 'NFL'], ['cfb', 'CFB'], ['epl', 'EPL']];

function Chips({ label, items, active, hrefFor, children }) {
  return (
    <div className="pb-frow">
      <span className="flbl">{label}</span>
      {items.map(([k, text]) => (
        <Link key={k} className={`ch ${active === k ? 'on' : ''}`} href={hrefFor(k)}>{text}</Link>
      ))}
      {children}
    </div>
  );
}

export default function PropsFilters({ state, games, hrefFor, view }) {
  return (
    <>
      <Chips label="League" items={LEAGUES} active={state.league} hrefFor={(k) => hrefFor({ f: k })}>
        <div className="pb-viewtog">
          <Link className={`ch ${view === 'table' ? 'on' : ''}`} href={hrefFor({ view: null })}>Table</Link>
          <Link className={`ch ${view === 'charts' ? 'on' : ''}`} href={hrefFor({ view: 'charts' })}>Charts</Link>
        </div>
      </Chips>

      <Chips label="Market"
        items={[['all', 'All'], ...MARKET_GROUPS.map((g) => [g.key, g.label])]}
        active={state.group} hrefFor={(k) => hrefFor({ g: k })} />

      {/* THE GAME DROPDOWN. A select rather than chips because 33 games is not
          a chip row, and a GET form rather than an onChange handler because
          this surface has no client components and does not need one - the
          submit button is the reader's own Enter, and every option is a real
          value the server reads back off the URL. */}
      <div className="pb-frow">
        <span className="flbl">Game</span>
        <form action="/market" method="get" className="pb-gameform">
          <input type="hidden" name="tab" value="props" />
          {view === 'charts' ? <input type="hidden" name="view" value="charts" /> : null}
          {state.group !== 'all' ? <input type="hidden" name="g" value={state.group} /> : null}
          {state.q ? <input type="hidden" name="q" value={state.q} /> : null}
          <select name="game" className="gsel" defaultValue={state.game ?? ''} aria-label="Filter to one game">
            <option value="">All games</option>
            {games.map((g) => (
              <option key={g.matchId} value={g.matchId}>
                {g.label}
              </option>
            ))}
          </select>
          <button type="submit" className="ch">Go</button>
        </form>
        {state.game ? (
          <Link className="ch" href={hrefFor({ game: null })}>Clear game</Link>
        ) : null}
      </div>

      <div className="pb-frow">
        <span className="flbl">Show</span>
        <Link className={`ch ${state.boardOnly ? 'on' : ''}`}
          href={hrefFor({ board: state.boardOnly ? null : '1' })}>Board games</Link>
        <Link className={`ch ${state.moversOnly ? 'on' : ''}`}
          href={hrefFor({ movers: state.moversOnly ? null : '1' })}>Movers only</Link>
        <form className="pb-search" action="/market" method="get">
          <input type="hidden" name="tab" value="props" />
          {view === 'charts' ? <input type="hidden" name="view" value="charts" /> : null}
          {state.league !== 'all' ? <input type="hidden" name="f" value={state.league} /> : null}
          {state.game ? <input type="hidden" name="game" value={state.game} /> : null}
          <input name="q" defaultValue={state.q} placeholder="Search player or team"
            aria-label="Search player or team" />
        </form>
      </div>
    </>
  );
}
