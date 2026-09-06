/**
 * components/draft/RankedComplete.js - where a RANKED draft ends.
 *
 * THE DEFECT THIS CLOSES (relay 3 item 4). A ranked draft is a `drafts` row
 * with mode='sim' that a contest_entries row points at, so it lives at
 * /sim/draft/[id] exactly like a practice mock. That route's completion
 * branch was a two-way split - isTrackerDraft ? TrackerResults :
 * DraftResults - with no ranked case at all, so finishing the week's ranked
 * entry dropped the player into the practice shell: a "← Mock" breadcrumb,
 * the get-the-app banner, the sim tab bar, and a mock's value-ledger results
 * board. Nothing about that page told them their week's entry was in.
 *
 * NO SIM CHROME HERE. This is the Weekly's own surface language - the same
 * .hdr/.yr/.mathline vocabulary /draft itself uses - because a ranked draft
 * belongs to Games, not to Practice. The only way onward is back to /games.
 */

import Link from 'next/link';
import StandaloneDate from '@/components/StandaloneDate';

export default function RankedComplete({ picks, seat, week, locksAt, settlesAt }) {
  return (
    <>
      <header className="hdr">
        <span className="ed">
          The Draft &middot; Week {week}{seat != null ? ` · seat ${seat}` : ''}
        </span>
        <span className="clock">your entry is in</span>
      </header>

      <div className="yr">
        <h1>Roster set.</h1>
        <div className="sub">
          Eight rounds, no bench. Your best six score automatically - there is no
          lineup to set and nothing else to do.
        </div>
      </div>

      <div className="secl"><b>Your eight</b><span>in round order</span></div>
      <div className="list">
        {picks.map((p) => (
          <div className="pr" key={p.round ?? p.name}>
            <span className="pos">R{p.round}</span>
            <span className="nm">
              <b>{p.name}</b>
              <small>{[p.pos, p.team].filter(Boolean).join(' · ') || ' '}</small>
            </span>
          </div>
        ))}
      </div>

      <div className="mathline">
        Locks <StandaloneDate iso={locksAt} />
        {settlesAt ? <> &middot; graded <StandaloneDate iso={settlesAt} /></> : null}
      </div>

      {/* ONE WAY ONWARD, and it goes to Games rather than /sim. The mock
          shell's tab bar used to be the only navigation here, which is what
          made a ranked entry feel like a practice round. */}
      <Link className="btn" href="/games">Back to Games</Link>
    </>
  );
}
