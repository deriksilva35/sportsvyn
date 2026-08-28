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
import { hiddenFields } from '@/lib/market/marketUrl';
import GameFilter from './GameFilter';

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

export default function PropsFilters({ state, games, hrefFor, view, urlState }) {
  // A FORM POSTS ONLY ITS NAMED FIELDS, so any param missing from the hidden
  // set is a param the reader silently loses on submit - the same loss as a
  // hand-built href, arriving through a different door. hiddenFields derives
  // them from the live state rather than from a list someone maintains.
  const searchHidden = hiddenFields(urlState, ['q']);
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

      {/* THE GAME DROPDOWN, now shared with the LINES tab - one control, not a
          copy that would drift. */}
      <GameFilter tab="props" urlState={urlState} games={games}
        current={state.game} hrefFor={hrefFor} />

      <div className="pb-frow">
        <span className="flbl">Show</span>
        <Link className={`ch ${state.boardOnly ? 'on' : ''}`}
          href={hrefFor({ board: state.boardOnly ? null : '1' })}>Board games</Link>
        <Link className={`ch ${state.moversOnly ? 'on' : ''}`}
          href={hrefFor({ movers: state.moversOnly ? null : '1' })}>Movers only</Link>
        <form className="pb-search" action="/market" method="get">
          <input type="hidden" name="tab" value="props" />
          {searchHidden.filter(([k]) => k !== 'tab').map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <input name="q" defaultValue={state.q} placeholder="Search player or team"
            aria-label="Search player or team" />
        </form>
      </div>
    </>
  );
}
