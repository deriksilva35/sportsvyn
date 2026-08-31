// components/wire/WireItem.js — one line of the wire.
//
// A HEADLINE WITHOUT A TAKE IS A COMPLETE ITEM. Nothing renders in the take's
// place - no skeleton, no "generating", no empty rule. Most items will never
// have one, and an absence that draws attention to itself is worse than the
// absence.
//
// AND A TAKE IS ALWAYS LABELLED. The take is machine-written and sits directly
// under a human-written headline in a product whose whole claim is that its
// numbers are checkable. The label is not decoration; it is the sentence that
// keeps the two apart.

import Link from 'next/link';
import { ageLabel, headlineParts } from '@/lib/wire/read';

// LANE COLOUR IS MEANING, not decoration: volt is the market, terra is a body,
// jade is a result. Everything else is muted, because everything else is
// somebody telling us something.
const LANE = {
  line: { label: 'LINE', cls: 'volt' },
  injury: { label: 'INJ', cls: 'terra' },
  final: { label: 'FINAL', cls: 'jade' },
  milestone: { label: 'STAT', cls: '' },
  record: { label: 'RECORD', cls: '' },
  poll: { label: 'POLL', cls: '' },
  contest: { label: 'BOARD', cls: '' },
  club: { label: 'CLUB', cls: '' },
};

/** NUMBERS IN THE HEADLINE WEAR THE MONO FACE - the split is pure and lives in
 *  lib/wire/read.js, where it can be tested without rendering anything. */
function Headline({ text }) {
  return headlineParts(text).map((p, i) => (p.num
    ? <span className="wi-n" key={i}>{p.t}</span>
    : <span key={i}>{p.t}</span>));
}

/** Where an item points. Lane 2 has a url of its own; lane 1 points at the
 *  page that holds the number it is about. */
export function itemHref(item) {
  return item.url ?? null;
}

export default function WireItem({ item, now }) {
  const lane = LANE[item.lane] ?? { label: String(item.lane ?? '').toUpperCase(), cls: '' };
  const href = itemHref(item);
  const age = ageLabel(item.published_at ?? item.seen_at, now);

  const body = (
    <>
      <div className="wi-h">
        <span className={`wi-lane ${lane.cls}`}>{lane.label}</span>
        <span className="wi-meta">{item.source}{age ? ` · ${age}` : ''}</span>
      </div>
      <div className="wi-t"><Headline text={item.headline} /></div>
      {item.take ? (
        <div className="wi-take">
          <p>{item.take}</p>
          <span className="wi-auto">Auto-generated</span>
        </div>
      ) : null}
    </>
  );

  return href
    ? <Link className="wi" href={href}>{body}</Link>
    : <div className="wi">{body}</div>;
}
