'use client';

// The per-game Draft room (S1; to the fri-1 mock in S2): the clock, a row of four
// seat tiles (You in lime, the bots in navy: name + pick count), and the whole
// pool best first - position chip, name, "TEAM · proj N", a "Draft" pill; a row
// already taken is faded and carries its drafter's name.
//
// THE NBA NIGHTLY DRAFT (nightly mode) takes the same data to its own look
// (wed-1b): one-line pool rows (NightlyPoolRow), ARM then CONFIRM - the row's
// Draft pill arms it (a lime tint on that row), and ONE sticky bottom bar
// confirms ("Armed: <name>" + "Draft <name>"). The clock is the header's pill.
//
// Everything comes from the server's roomView; a pick goes through
// pickGameDraftAction and the page re-reads. When the clock reaches zero the
// page re-reads too and the server's sweep makes the auto-pick - the client
// never decides a pick it did not send.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { pickGameDraftAction } from '@/app/actions/draftGame';
import { ROUNDS } from '@/lib/draftGame/rules';
import SeatStrip from '@/components/draftRoom/SeatStrip';
import PoolRow from '@/components/draftRoom/PoolRow';
import NightlyPoolRow from '@/components/draftGame/NightlyPoolRow';
import useSecondsLeft from '@/components/draftGame/useSecondsLeft';
import { slotRows } from '@/components/draftGame/slotRows';

export { slotRows };

const REASON = {
  locked: 'The game has kicked off. Your remaining picks were made for you.',
  timed_out: 'The clock ran out and the top player was picked for you.',
  taken: 'That player is gone. Pick again.',
  not_your_turn: 'Not your pick yet.',
  conflict: 'The room moved. Showing it now.',
  done: 'Your draft is complete.',
};

export default function GameDraftRoom({ view }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  // ARM, THEN CONFIRM (nightly): a row's Draft pill arms it, the sticky bar drafts it.
  const [armed, setArmed] = useState(null);
  const [tab, setTab] = useState('players');
  const nightly = view.nightly === true;
  const rounds = view.shape?.rounds ?? ROUNDS;
  const legal = new Set((view.available ?? []).map((r) => Number(r.id)));
  const mine = view.seats.find((s) => s.you)?.picks ?? [];
  const left = useSecondsLeft(view.yourTurn ? view.deadline : null);
  // An armed row that is no longer a legal pick on your turn (the room moved) is not armed.
  const armedRow = nightly && view.yourTurn ? view.pool.find((p) => p.id === armed && !p.takenBy && legal.has(Number(p.id))) ?? null : null;

  // The clock ran out: re-read, and the server auto-picks.
  useEffect(() => {
    if (left === 0) { const t = setTimeout(() => router.refresh(), 600); return () => clearTimeout(t); }
    return undefined;
  }, [left, router]);

  async function pick(id) {
    setArmed(null);
    setBusy(true); setMsg(null);
    const r = await pickGameDraftAction(view.contestId, id).catch(() => ({ ok: false }));
    if (!r?.ok) setMsg(REASON[r?.reason] ?? 'Could not save that pick.');
    setBusy(false);
    router.refresh();
  }

  return (
    <section className="dgm-room" data-draft-game-room data-your-turn={view.yourTurn ? '1' : '0'}>
      {!nightly && view.yourTurn && left != null && (
        <div className={`dgm-clock${left <= 10 ? ' dgm-clock--low' : ''}`} aria-live="polite">
          <b className="n">{left}</b>s to pick
        </div>
      )}
      {msg && <p className="dgm-err" role="alert">{msg}</p>}

      <SeatStrip seats={view.seats.map((s) => ({ key: s.seat, label: s.label, sub: `${s.picks.length}/${rounds}`, you: s.you, numeric: true }))} />

      {nightly && (
        <div className="dgm-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'players'} className={`dgm-tab${tab === 'players' ? ' dgm-tab--on' : ''}`} onClick={() => setTab('players')}>Players</button>
          <button type="button" role="tab" aria-selected={tab === 'team'} className={`dgm-tab${tab === 'team' ? ' dgm-tab--on' : ''}`} onClick={() => setTab('team')}>My team · {mine.length}/{rounds}</button>
        </div>
      )}

      {nightly && tab === 'team' ? (
        <ul className="dgm-mine" data-my-team>
          {slotRows(view.shape?.slots ?? [], mine).map(({ slot, p }, i) => (
            <li key={`${slot}-${i}`}><span className="dgm-pos">{slot}</span> {p ? <><b>{p.name}</b> <small>{p.pos} · {p.team}</small></> : <small>open</small>}</li>
          ))}
        </ul>
      ) : nightly ? (
        <ul className="nd-pool" aria-label="The pool">
          {view.pool.map((p) => (
            <NightlyPoolRow key={p.id} p={p} armed={armedRow?.id === p.id}
              disabled={!view.yourTurn || busy || (!p.takenBy && !legal.has(Number(p.id)))}
              onArm={() => setArmed(p.id)} />
          ))}
        </ul>
      ) : (
        <ul className="dgm-pool" aria-label="The pool">
          {view.pool.map((p) => (
            <PoolRow key={p.id} pos={p.pos} name={p.name}
              sub={`${p.team} · proj ${Number(p.proj).toFixed(1)}`}
              takenBy={p.takenBy}
              disabled={!view.yourTurn || busy}
              onPick={() => pick(p.id)} />
          ))}
        </ul>
      )}

      {armedRow && tab === 'players' && (
        <div className="nd-bar" data-nightly-bar role="region" aria-label="Confirm your pick">
          <span className="nd-bar-k">Armed: <b>{armedRow.name}</b></span>
          <button type="button" className="nd-bar-go" disabled={busy} onClick={() => pick(armedRow.id)}>Draft {armedRow.name}</button>
        </div>
      )}
    </section>
  );
}
