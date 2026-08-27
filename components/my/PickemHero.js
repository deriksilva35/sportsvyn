// components/my/PickemHero.js - the one urgency moment, and it is conditional.
//
// RENDERS ONLY WHILE AN OPEN BOARD HAS UNPICKED GAMES for this user. No board,
// a settled board, or a completed card renders NOTHING - a dashboard whose hero
// is permanently lit teaches a reader to ignore it, and the whole point of this
// block is that it means something when it appears.
//
// ONE PRIMARY PER SCREEN: this is the only volt-filled button on /my.

import { lockLabel } from '@/lib/pickem/read';

/** "2d 16h" - the gap to first kickoff, stated the way a reader counts it. */
export function timeToKickoff(kickoffAt, now = new Date()) {
  if (!kickoffAt) return null;
  const ms = new Date(kickoffAt).getTime() - new Date(now).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const h = Math.floor(ms / 3600_000);
  const d = Math.floor(h / 24);
  return d > 0 ? `${d}d ${h % 24}h` : `${h}h ${Math.floor((ms % 3600_000) / 60_000)}m`;
}

export default function PickemHero({ card, now = new Date() }) {
  if (!card) return null;
  const left = card.total - card.picked;
  if (left <= 0) return null;                 // nothing outstanding, no hero
  const away = timeToKickoff(card.nextKickoff, now);
  if (away == null) return null;              // board already locked

  return (
    <section className="hero">
      <div className="tag hero-tag">
        Pick&rsquo;em - Board 1 locks {lockLabel(card.nextKickoff)}
      </div>
      <div className="q">{left} {left === 1 ? 'pick' : 'picks'} left.</div>
      <div className="ctx">
        {card.picked} of {card.total} made &middot; first kickoff in {away}
      </div>
      <a className="play" href="/pickem">FINISH YOUR PICKS</a>
    </section>
  );
}
