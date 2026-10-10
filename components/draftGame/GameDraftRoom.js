'use client';

// The per-game Draft room (S1; to the fri-1 mock in S2): the clock, a row of four
// seat tiles (You in lime, the bots in navy: name + pick count), and the whole
// pool best first - position chip, name, "TEAM · proj N", a "Draft" pill; a row
// already taken is faded and carries its drafter's name.
//
// Everything comes from the server's roomView; a pick goes through
// pickGameDraftAction and the page re-reads. When the clock reaches zero the
// page re-reads too and the server's sweep makes the auto-pick - the client
// never decides a pick it did not send.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { pickGameDraftAction } from '@/app/actions/draftGame';
import { ROUNDS } from '@/lib/draftGame/rules';

const REASON = {
  locked: 'The game has kicked off. Your remaining picks were made for you.',
  timed_out: 'The clock ran out and the top player was picked for you.',
  taken: 'That player is gone. Pick again.',
  not_your_turn: 'Not your pick yet.',
  conflict: 'The room moved. Showing it now.',
  done: 'Your draft is complete.',
};

// Seconds left on the reader's clock, or null (no clock, or not yet ticked - the
// first tick lands after mount, so the server render and hydration agree).
function useSecondsLeft(deadline) {
  const [nowMs, setNowMs] = useState(null);
  useEffect(() => {
    if (!deadline) return undefined;
    const t = setInterval(() => setNowMs(Date.now()), 500);
    return () => clearInterval(t);
  }, [deadline]);
  if (!deadline || nowMs == null) return null;
  return Math.max(0, Math.ceil((new Date(deadline).getTime() - nowMs) / 1000));
}

export default function GameDraftRoom({ view }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const left = useSecondsLeft(view.yourTurn ? view.deadline : null);

  // The clock ran out: re-read, and the server auto-picks.
  useEffect(() => {
    if (left === 0) { const t = setTimeout(() => router.refresh(), 600); return () => clearTimeout(t); }
    return undefined;
  }, [left, router]);

  async function pick(id) {
    setBusy(true); setMsg(null);
    const r = await pickGameDraftAction(view.contestId, id).catch(() => ({ ok: false }));
    if (!r?.ok) setMsg(REASON[r?.reason] ?? 'Could not save that pick.');
    setBusy(false);
    router.refresh();
  }

  return (
    <section className="dgm-room" data-draft-game-room data-your-turn={view.yourTurn ? '1' : '0'}>
      {view.yourTurn && left != null && (
        <div className={`dgm-clock${left <= 10 ? ' dgm-clock--low' : ''}`} aria-live="polite">
          <b className="n">{left}</b>s to pick
        </div>
      )}
      {msg && <p className="dgm-err" role="alert">{msg}</p>}

      <div className="dgm-tiles">
        {view.seats.map((s) => (
          <div key={s.seat} className={`dgm-tile${s.you ? ' dgm-tile--you' : ''}`} data-seat={s.seat}>
            <b>{s.label}</b>
            <span className="n">{s.picks.length}/{ROUNDS}</span>
          </div>
        ))}
      </div>

      <ul className="dgm-pool" aria-label="The pool">
        {view.pool.map((p) => (
          <li key={p.id} className={`dgm-prow${p.takenBy ? ' dgm-prow--taken' : ''}`}>
            <span className={`dgm-pos dgm-pos--${String(p.pos).toLowerCase()}`}>{p.pos}</span>
            <span className="dgm-who">
              <b>{p.name}</b>
              <small>{p.team} · proj {Number(p.proj).toFixed(1)}</small>
            </span>
            {p.takenBy ? (
              <span className="dgm-by">{p.takenBy}</span>
            ) : (
              <button type="button" className="dgm-pill dgm-pill--sm" disabled={!view.yourTurn || busy} onClick={() => pick(p.id)}>
                Draft
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
