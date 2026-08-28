// components/market/GameFilter.js — the GAME dropdown, shared by PROPS and LINES.
//
// ONE CONTROL, TWO TABS. The props tab shipped this first; the lines tab now
// uses the same object rather than a copy that would drift. Same gsel grammar,
// same GET-form-plus-Go, same ?game={id} URL state.
//
// A GET FORM, NOT A HANDLER. This surface has no client components and does not
// need one: the Go button is the submit, the reader's own Enter also submits,
// and every option is a real value the server reads back off the URL. An
// onChange would mean the first 'use client' on this page for one control -
// which is the deferred package's whole point, and it arrives once or not yet.
//
// THE HIDDEN FIELDS ARE DERIVED, NOT LISTED. A form posts only its named
// fields, so a param missing here is a param the reader loses on submit. That
// is the same class of loss as a hand-built href and it was found the same way;
// hiddenFields reads the live URL state so nothing can be forgotten.

import Link from 'next/link';
import { hiddenFields } from '@/lib/market/marketUrl';

export default function GameFilter({ tab, urlState, games, current, hrefFor }) {
  const hidden = hiddenFields(urlState, ['game']).filter(([k]) => k !== 'tab');
  return (
    <div className="pb-frow">
      <span className="flbl">Game</span>
      <form action="/market" method="get" className="pb-gameform">
        <input type="hidden" name="tab" value={tab} />
        {hidden.map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <select name="game" className="gsel" defaultValue={current ?? ''} aria-label="Filter to one game">
          <option value="">All games</option>
          {games.map((g) => (
            <option key={g.matchId} value={g.matchId}>{g.label}</option>
          ))}
        </select>
        <button type="submit" className="ch">Go</button>
      </form>
      {current ? <Link className="ch" href={hrefFor({ game: null })}>Clear game</Link> : null}
    </div>
  );
}
