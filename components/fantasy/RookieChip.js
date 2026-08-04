// components/fantasy/RookieChip.js — the R chip, in one place.
//
// ONE RENDERING EVERYWHERE. This started as a bare <span className="fb-rk"> in
// the Movement Board and is now shared by the board, the sim draft room and the
// tracker room. It is a component rather than a copied span so the four surfaces
// cannot drift apart: a chip that means "rookie" on one screen and looks
// different on the next reads as two different facts.
//
// It renders NOTHING for a falsy flag - never a placeholder, never an empty box.
// A player with no chip is a veteran or a player we have no rookie data for, and
// those two look identical on purpose: we do not have a "we don't know" chip,
// because the absence of a claim IS the claim (absence over inference).
//
// No 'use client': there is no state or handler here, so it renders in server
// and client trees alike. The style lives in rookieChip.css, imported below so
// it travels with the component - volt text on a transparent ground with a
// volt-dim border, the treatment that shipped and therefore the established one.

import './rookieChip.css';

export default function RookieChip({ rookie }) {
  if (!rookie) return null;
  return <span className="fb-rk" title="Rookie">R</span>;
}
