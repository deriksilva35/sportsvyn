// components/wire/WireModule.js — the wire on a league landing.
//
// FOUR ITEMS, NEWEST FIRST, ACROSS EVERY LANE. Not four of each - the wire's
// value on a landing is "what just happened", and segmenting it there would
// make a quiet lane look as loud as a busy one.
//
// ABSENT AT ZERO, like every other module on that page.

import Link from 'next/link';
import WireItem from './WireItem';
import { updatedLabel } from '@/lib/wire/read';

export default function WireModule({ leagueSlug, items, newest, now }) {
  if (!items?.length) return null;
  const upd = updatedLabel(newest, now);
  return (
    <section className="wmod" aria-label="The Wire">
      <div className="wmod-h">
        <h2>The Wire</h2>
        {upd ? <span className="wmod-upd">{upd}</span> : null}
      </div>
      {items.map((i) => <WireItem key={i.id} item={i} now={now} />)}
      <Link className="wmod-all" href={`/${leagueSlug}/wire`}>The Wire →</Link>
    </section>
  );
}
