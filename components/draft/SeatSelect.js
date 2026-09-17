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
import { ordinal } from '@/lib/standings/view';
import { useHandleGate } from '@/components/handle/HandleGate';

/**
 * EVERY REFUSAL /api/draft/start CAN RETURN, AS A SENTENCE.
 *
 * WHAT THIS REPLACED: `j.error ?? 'Could not start.'` - which printed the
 * machine reason straight onto the seat grid. On 17 Sep, with FFC's ADP feed
 * thinned below a 96-pick room, a reader picking a seat was shown the literal
 * string "pool_too_small". The token is for the log; the reader gets a
 * sentence, and one that says whether waiting helps.
 *
 * KEYED ON EVERY REASON THE ROUTE ACTUALLY EMITS - its own six
 * (app/api/draft/start/route.js), plus what startCustomDraftFor and
 * claimEntry hand it. A reason with no line here falls to `default` rather
 * than leaking; a test asserts the map covers the route's own strings.
 * Same shape TrackerStart.js already uses for the sim console.
 */
const START_ERRORS = {
  // the route's own gates
  unauthorized: 'Sign in to take a seat.',
  'bad seat': 'That seat is not on this board.',
  'no board': 'There is no room open this week yet.',
  settled: 'This week is already graded.',
  locked: 'This week has locked.',
  // startCustomDraftFor
  pool_too_small: 'The draft pool is short this week - check back later.',
  no_pool: 'The draft pool is not loaded yet - check back later.',
  bad_position: 'That seat is not on this board.',
  bad_seat: 'That seat is not on this board.',
  invalid_config: 'This room is misconfigured. We are on it.',
  // claimEntry, when it has no draft to send us to
  'already entered': 'You already have a room for this week.',
  'could not start': 'Could not start. Try again in a moment.',
  default: 'Could not start. Try again in a moment.',
};

export default function SeatSelect({
  seats, teamsCount, rounds, clockSeconds, signedIn = true, signinHref = '/signin',
  hasHandle = true,
}) {
  // Taking a seat CONSUMES the week's entry - it is the most irreversible
  // write in the game, and the one most worth having a name attached to.
  const { guard, modal: handleModal } = useHandleGate(hasHandle);
  const [seat, setSeat] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const router = useRouter();

  async function start() {
    // TAKE SEAT ROUTES TO SIGN-IN, SIGNED OUT (2a-polish item 1) - opening a
    // room is the one irreversible action here, and a reader with no session
    // cannot spend the week's one draft, so the tap is the door, not a dead
    // end.
    if (!signedIn) { router.push(signinHref); return; }
    if (seat == null || busy) return;
    // GUARDED BEFORE THE REQUEST. /api/draft/start is what claims the entry
    // (START IS CONSUMED - lib/draft/entry.js), so the modal has to stand in
    // front of it: cancelling must leave no draft, no entry and the seat
    // grid exactly as it was.
    guard(() => startRoom());
  }

  async function startRoom() {
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
      setErr(START_ERRORS[j.error] ?? START_ERRORS.default);
      return;
    }
    router.push(`/sim/draft/${j.draftId}`);
  }

  // The current seat's own round1Pick/round2Pick, for the mathline below the
  // grid (relay 2a item 7's exact seat copy) - real snake math, per seat.
  const picked = seat == null ? null : seats.find((s) => s.seat === seat);

  return (
    <>
      {handleModal}
      <div className="secl"><b>Your seat</b><span>your room, same seed for everyone</span></div>
      <section className="mod">
        <div className="opts">
          {seats.map((s) => (
            <button
              key={s.seat}
              type="button"
              className={`opt${seat === s.seat ? ' on' : ''}`}
              onClick={() => setSeat(s.seat)}
              aria-pressed={seat === s.seat}
            >
              {s.seat}
            </button>
          ))}
        </div>
        <div className="mathline" style={{ marginTop: '10px' }}>
          {picked
            ? <>Seat {picked.seat} picks {ordinal(picked.round1Pick)} and {ordinal(picked.round2Pick)}. Any seat is
              open - it is your room against {teamsCount - 1} bots. Everyone who takes seat {picked.seat} faces
              the same room.</>
            : <>{teamsCount} teams &middot; {rounds} rounds &middot; {clockSeconds}s per pick. Any seat is open -
              it is your room against {teamsCount - 1} bots.</>}
        </div>
      </section>

      <section className="mod">
        {err && <p className="err">{err}</p>}
        {/* ONE BUTTON, ONE READING (relay 2a-polish-2 item e) - always "Take
            {a} seat {n}", never a second verb ("Choose a seat") for the
            unselected state. Disabled + .btn--volt's own :disabled opacity
            is the mute, not different wording. */}
        <button className="btn btn--volt" disabled={seat == null || busy} onClick={start}>
          {busy ? 'Opening the room…' : seat == null ? 'Take a seat' : `Take seat ${seat}`}
        </button>
        <p className="wk-autosave">
          One ranked draft a week. Opening the room uses it - there is no restart.
        </p>
      </section>
    </>
  );
}
