'use client';

/**
 * components/weekly/WeeklyRoom.js - the Weekly's builder.
 *
 * THIS IS THE DAILY'S DRAFT UI WITH THE CLOCK REMOVED AND SAVE-ON-CHANGE ADDED.
 * Same PPG pool rows, same pick and clear behaviour - the scope law for this
 * build was ADAPT, DON'T CONSTRUCT, so anything below that differs from
 * components/daily/DailyRoom.js has to say why. There are exactly four
 * differences and each is annotated:
 *
 *   1. NO CLOCK, A DEADLINE. The Daily's hero instrument is a 3:00 countdown
 *      the round is built around. A deadline days out is not an instrument -
 *      it is a date. It reads as a line, not a bar, and it does not turn red.
 *      (The deadline itself now lives one level up, in app/weekly/page.js's
 *      own .hdr - relay 2a item 6 - so this component owns no clock at all.)
 *   2. SAVE ON CHANGE, NO LOCK BUTTON. The Daily has one irreversible submit;
 *      the Weekly has no submit at all. Whatever is saved when the first
 *      kickoff arrives is the entry, so a "lock it in" button would be a lie - it
 *      would imply an un-locked-in state that scores differently. It does not.
 *   3. NO AUTO-ADVANCE PAST A FULL LINEUP. Auto-advance exists to save taps in
 *      a sprint. Here it still moves to the next EMPTY slot, but a builder
 *      with all six filled stays where it is rather than cycling.
 *   4. SIX ROWS, NOT A TAB BAR (relay 2a item 6). The Daily's slot bar shows
 *      six small buttons and only ever renders the ACTIVE one's pool below;
 *      the Weekly's mock shows all six as full rows (name, or "Pick a
 *      {slot}", with a Take/Change pill) at once. Tapping a row still just
 *      calls setActive(s) - the exact same selection the pool already
 *      responds to - so pick()/clear()/queue()/flush() are byte-identical.
 *
 * NOTHING HERE IS LOAD-BEARING FOR FAIRNESS. The server re-reads locks_at on
 * every save and refuses a late one.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SLOTS } from '@/lib/weekly/rules';
import { nextOpenSlot } from '@/lib/daily/play';
import { poolRows, poolCountLabel, SLOT_EMOJI } from '@/lib/weekly/view';
import { useHandleGate } from '@/components/handle/HandleGate';
import Sheet from '@/components/ui/Sheet';
import StandaloneTime from '@/components/StandaloneTime';
import ConfirmCard from '@/components/games/ConfirmCard';
import { confirmWeeklyEntry } from '@/app/actions/confirm';
import '@/components/daily/season/seasonBoard.css';

const SLOT_LABEL = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', FLEX: 'FLEX', FLEX2: 'FLEX' };
// EMPTY-SLOT COPY IS ITS OWN MAP (relay 2a-polish-2 item c), not a
// lowercased template - QB/RB/WR/TE are read as letters and stay
// uppercase ("Pick an RB", the article by sound, not spelling), while
// "flex" is a spoken word and stays lowercase.
const EMPTY_SLOT_COPY = {
  QB: 'Pick a QB', RB: 'Pick an RB', WR: 'Pick a WR', TE: 'Pick a TE',
  FLEX: 'Pick a flex', FLEX2: 'Pick a flex',
};
const POOL_LABEL = {
  QB: 'Quarterbacks', RB: 'Running backs', WR: 'Receivers', TE: 'Tight ends',
  FLEX: 'Flex - RB / WR / TE', FLEX2: 'Flex - RB / WR / TE',
};

// Identical to the Daily's, and deliberately duplicated rather than exported:
// it is presentation of a string this component happens to receive, not a rule.
const ppgOf = (r) => (r ? String(r).split(' · ')[0].replace(/\s*PPG$/, '') : '');
const restOf = (r) => (r ? String(r).split(' · ').slice(1).join(' · ') : '');

// THE POOL IS SORTED BY PPG, in poolRows() over in view.js where a test can
// reach it. That is the one place the Daily's pool UI could not be adopted
// unchanged - see the note on poolRows for why 1,269 players breaks what works
// fine at 64.

// DEBOUNCE, NOT THROTTLE. A player filling six slots in ten seconds should
// produce one write, not six; the trailing edge is the one that matters
// because it is the only one that reflects the finished lineup.
const SAVE_DEBOUNCE_MS = 700;

export default function WeeklyRoom({
  contest, board, initialLineup = {}, signedIn = true, signinHref = '/signin',
  hasHandle = true, initialConfirmedAt = null, locksAt = null, firstKickoff = null,
}) {
  // THE HANDLE IS ASKED FOR AT THE FIRST SLOT SAVED, not on page load
  // (components/handle/HandleGate.js). It guards the WRITE, so browsing the
  // pool, opening a slot tab and searching all stay open; only the request
  // that would put a row on a leaderboard waits for a name.
  const { guard, modal: handleModal, hasHandle: claimed } = useHandleGate(hasHandle);
  // The bail() effect below has an empty dep array (it must - it registers one
  // listener for the life of the room), so it would close over the FIRST
  // value of `claimed` forever. A ref kept in sync is what lets it read the
  // live one, including a handle claimed moments ago in the modal.
  const hasHandleRef = useRef(claimed);
  useEffect(() => { hasHandleRef.current = claimed; }, [claimed]);
  const [lineup, setLineup] = useState(initialLineup ?? {});
  const [active, setActive] = useState('QB');
  const [save, setSave] = useState('clean');   // clean | saving | saved | error
  const [locked, setLocked] = useState(false);
  // ROLLING LOCK: a slot locks at its player's kickoff, so the room needs a
  // clock. Seeded once and ticked every 30 s; the server is the judge, this
  // only greys what it would refuse.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);
  const kickoffOf = useCallback((id) => board.find((b) => b.id === id)?.kickoff_at ?? null, [board]);
  const hasKicked = useCallback((id) => { const k = kickoffOf(id); return k != null && new Date(k).getTime() <= now; }, [kickoffOf, now]);
  const slotLocked = useCallback((s) => lineup[s] != null && hasKicked(lineup[s]), [lineup, hasKicked]);
  const [err, setErr] = useState(null);
  const [query, setQuery] = useState('');
  // THE SLOT SHEET (relay 3 item 2). `active` still names the slot being
  // filled - every existing path that reads it is unchanged - but it is now
  // opened deliberately by a tap rather than being a always-on tab, and the
  // pool renders inside the sheet instead of as a long list under the page.
  const [sheetOpen, setSheetOpen] = useState(false);
  // CONFIRMATION IS A RECEIPT, NOT A SUBMIT (relay 3 item 3). The entry
  // already counts at lock whether or not this is set - autosave is still
  // the whole submit model - so this records that the reader has SEEN their
  // finished six, nothing more.
  const [confirmedAt, setConfirmedAt] = useState(initialConfirmedAt);
  const [confirming, setConfirming] = useState(false);
  const router = useRouter();
  const timer = useRef(null);
  const pending = useRef(null);

  const flush = useCallback(async (payload) => {
    setSave('saving'); setErr(null);
    const res = await fetch('/api/weekly/save', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineup: payload }),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok) { setSave('saved'); return; }
    setSave('error');
    if (res.status === 409 && j.error === 'slot_locked') {
      // ROLLING LOCK: one slot was refused at its kickoff, the others in the
      // same save were stored. Put the server's copy back and name the slot.
      if (j.lineup) setLineup(j.lineup);
      setErr(`${SLOT_LABEL[j.slot] ?? j.slot} locked at its kickoff. The rest saved.`);
      return;
    }
    // A 409 means the week locked underneath us - which happens to anyone with
    // the tab open at kickoff. It is not an error to apologise for; it is the
    // deadline arriving, so the surface changes rather than showing a message.
    if (res.status === 409) { setLocked(true); return; }
    setErr(j.errors?.join(' · ') ?? j.error ?? 'Could not save.');
  }, []);

  // Debounced write on every lineup change. The ref carries the latest payload
  // so a rapid sequence of picks collapses to one request with the last state.
  const queue = useCallback((next) => {
    pending.current = next;
    setSave('saving');
    if (timer.current) clearTimeout(timer.current);
    // GUARDED AT THE FLUSH, not at the tap: the debounce means one modal for
    // a burst of picks rather than one per slot, and the thunk guard() stashes
    // carries the LATEST pending payload, so a claim mid-burst still writes
    // the finished lineup rather than the slot that happened to open the modal.
    timer.current = setTimeout(() => { guard(() => flush(pending.current)); }, SAVE_DEBOUNCE_MS);
  }, [flush, guard]);

  // A pick made and the tab closed inside the debounce window would be lost.
  // Flushing on unmount and on hide costs nothing and closes that hole.
  useEffect(() => {
    const bail = () => {
      // NO BEACON WITHOUT A HANDLE. This is the same write as flush(), just
      // on the way out; letting it through would create the very entry the
      // modal is gating, behind the reader's back.
      if (!hasHandleRef.current) return;
      if (timer.current && pending.current) {
        clearTimeout(timer.current);
        navigator.sendBeacon?.('/api/weekly/save',
          new Blob([JSON.stringify({ lineup: pending.current })], { type: 'application/json' }));
      }
    };
    document.addEventListener('visibilitychange', bail);
    return () => { document.removeEventListener('visibilitychange', bail); bail(); };
  }, []);

  const picked = useMemo(() => new Set(Object.values(lineup).filter(Boolean)), [lineup]);

  // Memoised on the active slot AND the query: re-filtering and re-sorting
  // 1,269 rows on every change of state - and there is one on every pick and
  // every keystroke - is work with a visible cost.
  const rows = useMemo(() => poolRows(board, active, query), [board, active, query]);

  function pick(id) {
    // EVERY TAKE ROUTES TO SIGN-IN, SIGNED OUT (2a-polish item 1) - a pick
    // this reader has no session to save is not a dead end, it is the door.
    if (!signedIn) { router.push(signinHref); return; }
    if (locked) return;
    if (slotLocked(active) || hasKicked(id)) return;
    const next = { ...lineup, [active]: id };
    setLineup(next);
    // Difference 3: a full lineup stays put instead of cycling back to QB.
    if (SLOTS.some((s) => next[s] == null)) setActive(nextOpenSlot(active, next));
    // THE QUERY CLEARS ON A PICK. Auto-advance moves to the next empty slot,
    // and a leftover "kelce" on the WR tab would show an empty pool - which
    // reads as a broken board, not as a filter still being applied.
    setQuery('');
    // TAKING A PLAYER CLOSES THE SHEET and returns to the six rows - the
    // sheet is for one slot, and leaving it open after a pick would invite a
    // second pick into a slot that is now filled.
    setSheetOpen(false);
    // EDITING AFTER CONFIRMING IS ALLOWED, and drops the confirmation until
    // the save lands - see confirmIfNeeded() in flush().
    setConfirmedAt(null);
    queue(next);
  }

  function openSlot(slot) {
    if (slotLocked(slot)) return;
    if (!signedIn) { router.push(signinHref); return; }
    if (locked) return;
    setActive(slot);
    setQuery('');
    setSheetOpen(true);
  }

  function clear(slot) {
    if (locked || slotLocked(slot)) return;
    const next = { ...lineup }; delete next[slot];
    setLineup(next);
    setActive(slot);
    setConfirmedAt(null);
    queue(next);
  }

  // ONE SOURCE FOR THE COUNTERS (relay 3 item 1). These read `lineup`, the
  // same client state the six rows read. They used to be computed in
  // app/weekly/page.js from entry.lineup - the SERVER's copy, frozen at page
  // load - so a pick updated the rows instantly and left the pips, the
  // "n of 6 set" caption and the needline showing the previous count until
  // something forced a re-render. Rows right, counters wrong, from two
  // different truths about the same lineup.
  const filledSlots = SLOTS.filter((s2) => lineup[s2] != null);
  const unfilled = SLOTS.filter((s2) => lineup[s2] == null);
  const allSet = unfilled.length === 0;

  // CLEAN CARRIES NO TEXT (relay 2a-polish-2 item d) - it used to repeat the
  // lock time with no label of its own, and .hdr's own clock already carries
  // that fact. min-height on .wk-save keeps the row from jumping when a real
  // status (saving/saved/error) appears.
  const saveLabel = { clean: '', saving: 'Saving…', saved: 'Saved', error: 'Not saved' }[save];

  async function lockItIn() {
    if (confirming || locked) return;
    setConfirming(true);
    // Flush any pending debounce first, or the confirmation could land
    // against a lineup the server has not been told about yet.
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (pending.current) await flush(pending.current).catch(() => {});
    const r = await confirmWeeklyEntry(contest.id).catch(() => null);
    setConfirming(false);
    if (r?.ok) setConfirmedAt(r.confirmedAt);
    else if (r?.reason === 'locked') setLocked(true);
  }

  return (
    <section className="mod mod--play">
      {handleModal}

      {/* THE COUNTERS, DRIVEN BY THE SAME `lineup` THE ROWS READ (item 1).
          These moved here from app/weekly/page.js, which computed them from
          the server's entry.lineup and could not see a client-side pick. */}
      <div className="prog">
        <div className="rrow">
          {SLOTS.map((s2) => (
            <div key={s2} className={`pip${lineup[s2] != null ? ' full' : ''}`}>
              <span className="em">{SLOT_EMOJI[s2]}</span>
              <span className="dot">{SLOT_LABEL[s2]}</span>
            </div>
          ))}
        </div>
        <div className="cap">
          <span>{filledSlots.length} of {SLOTS.length} set</span>
          <span>saves on change</span>
        </div>
      </div>
      {unfilled.length > 0 && (
        <div className="needline">
          Still need <b>{unfilled.map((s2) => SLOT_LABEL[s2]).join(' · ')}</b>
        </div>
      )}

      <div className="play-head">

        {/* THE SIX-ROW LIST (relay 2a item 6, mock's .secl + .list/.pr) -
            replaces the old horizontal .slots tab strip. Every row is
            always visible (unlike a tab bar, which only ever showed the
            active one); tapping a row still just calls setActive(s), the
            exact same selection the pool below already responds to. Pick,
            clear, save and the debounce are all untouched. */}
        <div className="secl"><b>Your six</b><span>tap a slot to change it</span></div>
        <div className="list">
          {SLOTS.map((s) => {
            const id = lineup[s];
            const p = id ? board.find((b) => b.id === id) : null;
            const isLocked = slotLocked(s);
            return (
              <button key={s} type="button"
                className={`pr${p ? '' : ' empty'}${isLocked ? ' wk-locked' : ''}`}
                disabled={isLocked}
                onClick={() => openSlot(s)}>
                <span className="pos">{SLOT_LABEL[s]}</span>
                <span className="nm">
                  <b>{p ? p.name : EMPTY_SLOT_COPY[s]}</b>
                  <small>{p ? restOf(p.resume) : ' '}</small>
                  {/* the slot's own lock time (rolling lock) */}
                  {p?.kickoff_at ? <small className="wk-ko">{isLocked ? 'Locked · ' : 'Locks '}<StandaloneTime iso={p.kickoff_at} /></small> : null}
                </span>
                <span className={`tk${p ? ' quiet' : ''}`}>{isLocked ? 'Locked' : p ? 'Change' : 'Take'}</span>
              </button>
            );
          })}
        </div>

        <div className={`wk-save wk-save--${save}`}>{saveLabel}</div>

        {err && <p className="err">{err}</p>}
        {locked && (
          <p className="wk-locked-note">
            The week has closed. Your lineup is in as it stands.
          </p>
        )}

        {/* Difference 2: no lock button. This line is the whole submit model,
            stated where the Daily's primary would be so nobody hunts for one. */}
        {!locked && (
          <p className="wk-autosave">
            Every change saves. Whatever is here at kickoff is your entry.
          </p>
        )}

      </div>

      {/* THE CONFIRM CARD (relay 3 item 3, shared 3b item 1). Appears only
          when all six are set. Pressing it writes entry.meta.confirmed_at;
          it does NOT submit anything, because autosave already did. An
          unconfirmed entry counts at lock exactly the same. */}
      {allSet && !locked && (
        <ConfirmCard
          title="Your six"
          rows={SLOTS.map((s2) => ({
            key: s2,
            label: SLOT_LABEL[s2],
            name: board.find((b) => b.id === lineup[s2])?.name ?? '-',
          }))}
          receiptLine="All six are in"
          lockIso={locksAt}
          lockPre="Locks"
          note="You can still change them until then; a change re-confirms when it saves."
          confirmedAt={confirmedAt}
          confirming={confirming}
          onLockIn={lockItIn}
        />
      )}

      {/* THE POOL, IN A SHEET (relay 3 item 2) - one position at a time,
          searchable, PPG-sorted, opened by tapping a slot. It replaced a
          1,002-row list that sat under the page permanently. Same
          poolRows(board, active, query) as before: the filtering, the
          slot-legality rule and the PPG sort are unchanged, only where
          they render moved. */}
      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={EMPTY_SLOT_COPY[active]}
        subtitle={POOL_LABEL[active]}
      >
        <div className="wk-find" style={{ padding: '10px 14px 0' }}>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`search ${poolCountLabel(rows.length)} by name`}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            aria-label={`Search ${POOL_LABEL[active]}`}
          />
          {query && (
            <button type="button" className="wk-find-x" onClick={() => setQuery('')}
              aria-label="Clear search">×</button>
          )}
        </div>
        {rows.length === 0 && (
          <p className="wk-find-none" style={{ padding: '10px 14px' }}>
            No {POOL_LABEL[active].toLowerCase()} matching &ldquo;{query}&rdquo;.
          </p>
        )}
        {rows.map((p2) => (
          <button key={p2.id} type="button"
            className={`sbd-pr${picked.has(p2.id) ? ' sbd-gone' : ''}${hasKicked(p2.id) ? ' sbd-kicked' : ''}`}
            disabled={picked.has(p2.id) || locked || hasKicked(p2.id)}
            onClick={() => pick(p2.id)}>
            <span className="sbd-pos">{p2.pos}</span>
            <span className="sbd-nm">
              <b>{p2.name}</b>
              <small>{hasKicked(p2.id) ? <>Kicked · <StandaloneTime iso={p2.kickoff_at} /></> : restOf(p2.resume)}</small>
            </span>
            <span className="sbd-tk">{ppgOf(p2.resume)}</span>
          </button>
        ))}
      </Sheet>
    </section>
  );
}