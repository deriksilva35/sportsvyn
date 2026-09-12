// components/pickem/SportSwitch.js - the board page's NFL / CFB switch.
//
// TWO BOARDS RUN AT ONCE and the row that brought you here can only open one
// of them. The switch is the second door: each pill carries that board's own
// state, so a reader can see "CFB 0 of 9" without leaving the NFL board to
// find out.
//
// ONLY BOARDS THAT EXIST RENDER, and a lone board renders no switch at all -
// a control with one option is furniture. The current pill is filled and is
// NOT a link to itself.

import Link from 'next/link';

export const SPORT_LABEL = Object.freeze({ nfl: 'NFL', cfb: 'CFB' });

/** @param boards [{ sport, pickedOpen, pickable, settled }] in render order */
export default function SportSwitch({ boards = [], sport }) {
  const live = boards.filter((b) => b && SPORT_LABEL[b.sport]);
  if (live.length < 2) return null;
  return (
    <nav className="pk-switch" aria-label="Pick'em sport">
      {live.map((b) => {
        const on = b.sport === sport;
        const state = b.settled ? 'settled' : `${b.pickedOpen ?? 0} of ${b.pickable ?? 0}`;
        const inner = <>{SPORT_LABEL[b.sport]}<small>{state}</small></>;
        return on
          ? <span key={b.sport} className="pk-sw on" aria-current="page">{inner}</span>
          : <Link key={b.sport} className="pk-sw" href={`/pickem/${b.sport}`}>{inner}</Link>;
      })}
    </nav>
  );
}
