// components/today/LeagueChips.js - the tuner, and what it remembers.
//
// SIGNED IN, THE CHIPS PERSIST; SIGNED OUT THEY DO NOT, AND THERE IS NO NAG.
// A reader who has not made an account still gets a working tuner for the
// length of their visit - the chips are real, the bands respond - it simply
// is not written anywhere. Prompting them to sign in to turn a league off
// would be asking for an account in exchange for a preference, which is the
// opposite of what the registry line says.
//
// THE BANDS ARE ALREADY RENDERED. Every band ships in the HTML and the chips
// toggle a class, rather than refetching a page per click: the server has
// already paid for all four reads, the payload difference is a few kilobytes,
// and a filter that round-trips feels broken in a way a filter that doesn't
// never does.
//
// PERSISTENCE IS FIRE-AND-FORGET, deliberately. If saveUserLayout fails the
// chips stay where the reader put them for this session; the alternative is
// snapping a chip back under someone's finger because a write lost a race.

'use client';

import { useEffect, useState, useTransition } from 'react';
import { saveUserLayout } from '@/app/actions/dashboard';

export default function LeagueChips({ leagues, initialOn, signedIn = false }) {
  const [on, setOn] = useState(() => new Set(initialOn));
  const [, startTransition] = useTransition();

  // The bands are server-rendered; this reflects the chip state onto them.
  useEffect(() => {
    for (const l of leagues) {
      const band = document.querySelector(`.band[data-band="${l.id}"]`);
      if (band) band.classList.toggle('off', !on.has(l.id));
    }
    const empty = document.getElementById('today-empty');
    if (empty) empty.classList.toggle('show', on.size === 0);
  }, [on, leagues]);

  function toggle(id) {
    const next = new Set(on);
    if (next.has(id)) next.delete(id); else next.add(id);
    setOn(next);
    if (!signedIn) return;
    // ORDER MATTERS IN THE STORE, so the saved array follows the rail's order
    // rather than Set insertion order - otherwise a toggle-off-and-on would
    // quietly rewrite the reader's league order.
    const ordered = leagues.filter((l) => next.has(l.id)).map((l) => ({ id: l.id }));
    startTransition(() => { saveUserLayout(ordered, 'today').catch(() => {}); });
  }

  return (
    <>
      <div className="tuner">
        {leagues.map((l) => (
          <button key={l.id} type="button"
            className={`spill${on.has(l.id) ? ' on' : ''}`}
            aria-pressed={on.has(l.id)}
            onClick={() => toggle(l.id)}>
            {/* The live dot only appears when that league has a game on right
                now - it is the signal query's own bool_or, not a guess from a
                kickoff time. */}
            {l.live ? <span className="chipdot" aria-label="live" /> : null}
            {l.label}{l.note ? <span className="ct">{l.note}</span> : null}
          </button>
        ))}
        {/* Dead by design: a locked-SOON chip states the year and does nothing.
            It is not disabled-looking-clickable, it simply has no handler. */}
        <span className="spill soon">MLB <i>2027</i></span>
      </div>
      <div className="regline">
        <span className="dot" />
        {signedIn
          ? 'Saved to your account · one registry with My Sportsvyn'
          : 'Tuned for this visit · sign in to keep it'}
      </div>
    </>
  );
}
