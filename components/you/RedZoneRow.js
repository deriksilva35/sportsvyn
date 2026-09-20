'use client';

// components/you/RedZoneRow.js - the NFL red-zone switch.
//
// THE ONE WRITER ON THIS TAB, AND THE RULE IT TURNS OVER. You.js says alerts
// here are read-and-link-only: every row states what is true and points at the
// surface that changes it. That held while every alert had such a surface -
// a game's bell, a team's page, /account. A LEAGUE-WIDE STANDING INSTRUCTION
// HAS NO SUCH SURFACE: it is not about one game or one team, so there is
// nowhere else it could honestly live, and a row that only reported it would
// point at nothing. It writes, and it is the only row here that does.
//
// IT STATES ITS OWN COST. About 130 scores on a full Sunday, most of them
// inside two windows - a reader turning this on should know that before the
// first one arrives, not after the fortieth.
//
// BY SLUG, NOT BY ID. The route resolves 'nfl' and hands back the row id the
// PUT writes to, so no league id is baked into this bundle.

import { useEffect, useState } from 'react';

export default function RedZoneRow({ league = 'nfl', label = 'NFL red zone' }) {
  const [on, setOn] = useState(null);      // null = not loaded yet
  const [leagueId, setLeagueId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/push/prefs?league=${encodeURIComponent(league)}`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        setLeagueId(j?.leagueId ?? null);
        // source === 'league' means a league row is what answered. Anything
        // else - a default, or a team row that happened to be read - is not
        // this switch's state, and rendering it as ON would be a lie.
        setOn(j?.prefs?.source === 'league' && Boolean(j.prefs.master));
      })
      .catch(() => { if (alive) setOn(false); });
    return () => { alive = false; };
  }, [league]);

  const toggle = async () => {
    if (busy || on == null || leagueId == null) return;
    const next = !on;
    setBusy(true); setError(null);
    setOn(next);                                    // optimistic
    try {
      const res = await fetch('/api/push/prefs', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        // THE WHOLE ROW, like every other writer of this table: master plus
        // the five triggers. Scores and finals on, the rest off - red zone is
        // scores and results, not kickoffs and quarter ends.
        body: JSON.stringify({
          scope: 'league', scopeId: leagueId,
          master: next, kickoff: false, score: true, quarter: false, close: false, final: true,
        }),
      });
      if (!res.ok) throw new Error('save failed');
      const j = await res.json().catch(() => null);
      if (j?.prefs) setOn(j.prefs.source === 'league' && Boolean(j.prefs.master));
    } catch {
      setOn(!next);                                 // put it back
      setError('That did not save. Check your connection and try again.');
    } finally { setBusy(false); }
  };

  return (
    <div className="yu-set" data-row="redzone">
      <span className="yu-k">
        {label}
        <small>{error ?? 'Every score, every game · about 130 a Sunday'}</small>
      </span>
      <button
        type="button"
        className={`yu-v yu-tog${on ? ' on' : ''}`}
        onClick={toggle}
        disabled={busy || on == null}
        aria-pressed={on === true}
        aria-label={`${label}: every score, every game`}
      >
        {on == null ? '…' : on ? 'On' : 'Off'}
      </button>
    </div>
  );
}
