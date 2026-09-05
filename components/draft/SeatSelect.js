'use client';

/**
 * components/draft/SeatSelect.js - the ranked front door.
 *
 * ONE DECISION ON THE SCREEN. The sim's StartForm is a console: scoring, teams,
 * eight roster steppers, a clock. None of that is offered here, because a
 * ranked week is one fixed config - everybody drafts the same shape or the
 * scores are not comparable. What is left is the only pre-draft lever a ranked
 * player gets, so it is the whole screen rather than a row inside a form.
 *
 * THE START IS IRREVERSIBLE AND SAYS SO. Opening the room consumes the week's
 * entry, the same way the Daily's board consumes the day's attempt, so the
 * button says what it costs before it is pressed rather than after.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SeatSelect({ seats, teamsCount, rounds, clockSeconds }) {
  const [seat, setSeat] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const router = useRouter();

  async function start() {
    if (seat == null || busy) return;
    setBusy(true); setErr(null);
    const res = await fetch('/api/draft/start', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seat }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      // A 409 with a draftId is a claim that already exists - send them to it
      // rather than reporting an error they cannot act on.
      if (j.draftId) { router.push(`/sim/draft/${j.draftId}`); return; }
      setErr(j.error === 'locked' ? 'This week has locked.' : j.error ?? 'Could not start.');
      return;
    }
    router.push(`/sim/draft/${j.draftId}`);
  }

  return (
    <>
      <section className="mod">
        <h2 className="eyebrow">Pick your seat</h2>
        <p className="mod-lede">
          {teamsCount} teams &middot; {rounds} rounds &middot; {clockSeconds}s per pick.
          Snake order, so your seat decides every pick you get.
        </p>
        <div className="seats">
          {seats.map((s) => (
            <button
              key={s.seat}
              type="button"
              className={`seat${seat === s.seat ? ' seat--on' : ''}`}
              onClick={() => setSeat(s.seat)}
              aria-pressed={seat === s.seat}
            >
              <span className="seat-n">{s.seat}</span>
              {s.note && <span className="seat-note">{s.note}</span>}
            </button>
          ))}
        </div>
      </section>

      <section className="mod">
        {err && <p className="err">{err}</p>}
        <button className="btn btn--volt" disabled={seat == null || busy} onClick={start}>
          {busy ? 'Opening the room…' : seat == null ? 'Choose a seat' : `Draft from pick ${seat}`}
        </button>
        <p className="wk-autosave">
          One ranked draft a week. Opening the room uses it - there is no restart.
        </p>
      </section>
    </>
  );
}
