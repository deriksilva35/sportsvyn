'use client';

// The per-game Draft room (thu-3 S1): header, the four seats, the board, the
// clock. Everything it shows comes from the server's roomView; a pick goes
// through pickGameDraftAction and the page re-reads. When the clock reaches
// zero the page re-reads too, and the server's sweep makes the auto-pick - the
// client never decides a pick it did not send.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { pickGameDraftAction } from '@/app/actions/draftGame';
import { COPY, ROUNDS } from '@/lib/draftGame/rules';

const REASON = {
  locked: 'The game has kicked off. Your remaining picks were made for you.',
  timed_out: 'The clock ran out and the top player was picked for you.',
  taken: 'That player is gone. Pick again.',
  not_your_turn: 'Not your pick yet.',
  conflict: 'The room moved. Showing it now.',
  done: 'Your draft is complete.',
};

const seatName = (s) => (s.you ? 'You' : `Bot ${s.seat}`);

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

  const mine = view.seats.find((s) => s.you)?.picks ?? [];
  return (
    <section className="dgm-room" data-draft-game-room data-your-turn={view.yourTurn ? '1' : '0'}>
      <div className="dgm-room-top">
        <span className="dgm-round" data-room-header>{view.header}</span>
        <span className="dgm-count">{COPY.count}</span>
      </div>
      {view.yourTurn && left != null && (
        <div className={`dgm-clock${left <= 10 ? ' dgm-clock--low' : ''}`} aria-live="polite">
          <b className="n">{left}</b>s to pick
        </div>
      )}
      {msg && <p className="dgm-err" role="alert">{msg}</p>}

      <div className="dgm-seats">
        {view.seats.map((s) => (
          <div key={s.seat} className={`dgm-seat${s.you ? ' dgm-seat--you' : ''}`}>
            <div className="dgm-seat-hd">{seatName(s)} <span className="dgm-seat-n">{s.picks.length}/{ROUNDS}</span></div>
            <ol className="dgm-picks">
              {s.picks.map((p) => (
                <li key={p.id}><span className="dgm-pos">{p.pos}</span> {p.name} <span className="dgm-tm">{p.team}</span></li>
              ))}
            </ol>
          </div>
        ))}
      </div>

      {view.done ? (
        <p className="dgm-done" data-draft-game-done>
          Your four: {mine.map((p) => p.name).join(', ')}. Your best three score. Over when the game ends.
        </p>
      ) : view.locked ? (
        <p className="dgm-done">The game has kicked off. The draft is closed.</p>
      ) : (
        <ul className="dgm-board" aria-label="Available players">
          {view.available.map((p) => (
            <li key={p.id} className="dgm-prow">
              <span className="dgm-pos">{p.pos}</span>
              <span className="dgm-who"><b>{p.name}</b> <small>{p.team}</small></span>
              <span className="dgm-proj n">{Number(p.proj).toFixed(1)}</span>
              <button type="button" className="dgm-pick" disabled={!view.yourTurn || busy} onClick={() => pick(p.id)}>
                Pick
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
