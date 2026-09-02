'use client';

// components/sim/SeatStrip.js — pick your team. One product: the league card,
// where a seat is a FRANCHISE (ruling 2 Sep: the board is the league's fixed
// map; choosing 12 means playing team 12 this run - its column, its keepers).
// NOT the Tracker: its seat is a transcription fact, entered with the league's
// shape, and a picker on a fact invites choosing (ruling 2 Sep, removed).
//
// A STRIP, NOT A SELECT. Twelve pills read as a draft order; a dropdown reads
// as a setting. The current default is marked so a tap away from it is a
// visible decision, and tapping it again is a visible way back. `counts`
// (index = seat - 1) puts each franchise's keeper count on its pill - "12 · 4
// kept" - so the pill says what taking that team hands you.

export default function SeatStrip({ teams, seat, defaultSeat = null, onChange, label = 'YOUR SEAT', hint = null, disabled = false, counts = null }) {
  const n = Math.max(0, Number(teams) || 0);
  return (
    <div className="seatstrip" role="radiogroup" aria-label={label}>
      <span className="seatstrip-l">{label}</span>
      <div className="seatstrip-pills">
        {Array.from({ length: n }, (_, i) => i + 1).map((s) => {
          const on = s === seat;
          const dflt = defaultSeat != null && s === defaultSeat;
          return (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={on}
              className={`seatpill${on ? ' on' : ''}${dflt ? ' dflt' : ''}`}
              onClick={() => onChange?.(s)}
              disabled={disabled}
              title={dflt ? `Seat ${s} · your team` : `Seat ${s}`}
            >
              {counts ? `${s} · ${counts[s - 1] ?? 0} kept` : s}
            </button>
          );
        })}
      </div>
      {hint ? <span className="seatstrip-h">{hint}</span> : null}
    </div>
  );
}
