'use client';

// components/sim/SeatStrip.js — pick your seat, this run only. One control,
// two products: the league card (default = the seat the commissioner gave you)
// and the Tracker (default = 1, there is no imported seat to inherit).
//
// A STRIP, NOT A SELECT. Twelve pills read as a draft order; a dropdown reads
// as a setting. The current default is marked so a tap away from it is a
// visible decision, and tapping it again is a visible way back.

export default function SeatStrip({ teams, seat, defaultSeat = null, onChange, label = 'YOUR SEAT', hint = null, disabled = false }) {
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
              title={dflt ? `Seat ${s} · your league seat` : `Seat ${s}`}
            >
              {s}
            </button>
          );
        })}
      </div>
      {hint ? <span className="seatstrip-h">{hint}</span> : null}
    </div>
  );
}
