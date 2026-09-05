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
import { poolRows } from '@/lib/weekly/view';

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
  contest, board, initialLineup = {}, locksAtLabel = null, signedIn = true, signinHref = '/signin',
}) {
  const [lineup, setLineup] = useState(initialLineup ?? {});
  const [active, setActive] = useState('QB');
  const [save, setSave] = useState('clean');   // clean | saving | saved | error
  const [locked, setLocked] = useState(false);
  const [err, setErr] = useState(null);
  const [query, setQuery] = useState('');
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
    timer.current = setTimeout(() => { flush(pending.current); }, SAVE_DEBOUNCE_MS);
  }, [flush]);

  // A pick made and the tab closed inside the debounce window would be lost.
  // Flushing on unmount and on hide costs nothing and closes that hole.
  useEffect(() => {
    const bail = () => {
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
    const next = { ...lineup, [active]: id };
    setLineup(next);
    // Difference 3: a full lineup stays put instead of cycling back to QB.
    if (SLOTS.some((s) => next[s] == null)) setActive(nextOpenSlot(active, next));
    // THE QUERY CLEARS ON A PICK. Auto-advance moves to the next empty slot,
    // and a leftover "kelce" on the WR tab would show an empty pool - which
    // reads as a broken board, not as a filter still being applied.
    setQuery('');
    queue(next);
  }

  function clear(slot) {
    if (locked) return;
    const next = { ...lineup }; delete next[slot];
    setLineup(next);
    setActive(slot);
    queue(next);
  }

  const saveLabel = { clean: locksAtLabel ?? ' ', saving: 'Saving…', saved: 'Saved', error: 'Not saved' }[save];

  return (
    <section className="mod mod--play">
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
            return (
              <button key={s} type="button"
                className={`pr${p ? '' : ' empty'}`}
                onClick={() => (signedIn ? setActive(s) : router.push(signinHref))}>
                <span className="pos">{SLOT_LABEL[s]}</span>
                <span className="nm">
                  <b>{p ? p.name : EMPTY_SLOT_COPY[s]}</b>
                  <small>{p ? restOf(p.resume) : ' '}</small>
                </span>
                <span className={`tk${p ? ' quiet' : ''}`}>{p ? 'Change' : 'Take'}</span>
              </button>
            );
          })}
        </div>

        <div className={`wk-save wk-save--${save}`}>{saveLabel}</div>

        {err && <p className="err">{err}</p>}
        {locked && (
          <p className="wk-locked-note">
            The week has locked. Your lineup is in as it stands.
          </p>
        )}

        {/* Difference 2: no lock button. This line is the whole submit model,
            stated where the Daily's primary would be so nobody hunts for one. */}
        {!locked && (
          <p className="wk-autosave">
            Every change saves. Whatever is here at kickoff is your entry.
          </p>
        )}

        {/* THE SEARCH FIELD, and it is here rather than on the Daily on
            purpose. The Daily's board is 64 players and the scan under a
            three-minute clock IS that game; a filter would be a cheat code for
            it. The Weekly's board is 1,269 players with four days to think, so
            hunting for a name is friction with nothing to protect.
            BELOW the six-row list (relay 2a item 6's mock), not above it. */}
        <div className="search">
          <input
            className="wk-find-in"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`search ${board.length.toLocaleString('en-US')} players by name`}
            aria-label={`Search ${POOL_LABEL[active]}`}
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck="false"
          />
          {query && (
            <button type="button" className="wk-find-x" onClick={() => setQuery('')}
              aria-label="Clear search">×</button>
          )}
        </div>

        <div className="pool-head">
          <span>
            {POOL_LABEL[active]}
            {/* The count is the feedback that the filter did something. Without
                it a query matching nothing is indistinguishable from a board
                that failed to load. */}
            {query && <span className="wk-find-n"> · {rows.length} {rows.length === 1 ? 'match' : 'matches'}</span>}
          </span>
          <span>PPG</span>
        </div>
      </div>

      <div className="pool pool--scroll">
        {query && rows.length === 0 && (
          <p className="wk-find-none">
            No {POOL_LABEL[active].toLowerCase()} matching &ldquo;{query}&rdquo;.
            {' '}The filter only searches the tab you are on.
          </p>
        )}
        {rows.map((p) => (
          <button key={p.id} type="button"
            className={`plyr${picked.has(p.id) ? ' plyr--used' : ''}`}
            disabled={picked.has(p.id) || locked}
            onClick={() => pick(p.id)}>
            <span className="plyr-pos">{p.pos}</span>
            <span className="plyr-name">{p.name}</span>
            <span className="plyr-rest">{restOf(p.resume)}</span>
            <span className="plyr-ppg">{ppgOf(p.resume)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
