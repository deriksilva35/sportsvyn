// components/league/GamesStrip.js — the Sportsvyn games that run for this code.
//
// THE PRIMARY-BUTTON LAW. This strip is the ONLY place a volt button appears on
// the league landing. Volt is the colour of "you can act", and a screen with
// three of them has none - so the scores module, the rail and the standings
// snapshot all use links, and the one thing a reader can DO from here wears the
// primary.
//
// AND ONLY ON AN OPEN ACTION. A tile whose game the reader has already entered,
// or which has no contest yet, is QUIET: ink-2, muted, still a link. Signed out,
// every tile is quiet and its button reads "Sign in to play", because the game
// and its lock are true for everybody but the action is not available yet.
//
// LEAGUE MEMBERSHIP IS DATA - see GAME_META.leagues. /cfb draws one wide Pick'em
// tile because Pick'em is the only game with a college board; /nfl draws four.

import Link from 'next/link';
import { tileNumber } from '@/lib/gridiron/leagueLanding';

function Tile({ tile, signedIn, wide }) {
  const { card, open } = tile;
  const num = tileNumber(card);
  const href = card?.href ?? '#';
  return (
    <div className={`lgt${open ? ' on' : ''}${wide ? ' wide' : ''}`}>
      <div className="lgt-eye">{card?.name ?? tile.label}</div>
      <div className="lgt-st">{card?.blurb ?? ''}</div>
      {num ? (
        <div className="lgt-num">
          {num.value}
          {num.unit ? <span className="lgt-unit">{num.unit}</span> : null}
        </div>
      ) : null}
      {/* THE LOCK IS TRUE FOR EVERYBODY, so it renders signed out too. */}
      {card?.closesLabel || card?.opensLabel ? (
        <div className="lgt-ctx">{card.closesLabel ?? card.opensLabel}</div>
      ) : null}
      {open ? (
        <Link className="lgt-btn" href={href}>Play</Link>
      ) : (
        <Link className="lgt-link" href={signedIn ? href : `/signin?next=${encodeURIComponent(href)}`}>
          {signedIn ? 'Open' : 'Sign in to play'}
        </Link>
      )}
    </div>
  );
}

export default function GamesStrip({ tiles, signedIn = false }) {
  if (!tiles?.length) return null;
  const wide = tiles.length === 1;
  return (
    <section className="lgs" aria-label="Sportsvyn games">
      <div className={`lgs-scroll${wide ? ' one' : ''}`}>
        {tiles.map((t) => <Tile key={t.key} tile={t} signedIn={signedIn} wide={wide} />)}
      </div>
    </section>
  );
}
