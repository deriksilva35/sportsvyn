'use client';

/**
 * components/weekly/WeeklyRoom.js - the Weekly's builder, v2.
 *
 * WHAT CHANGED IN v2, AND WHAT DID NOT. Every rule is where it was: the server
 * re-reads locks_at on each save and refuses a late one (lib/weekly/entries.js
 * saveLineup), a slot locks at ITS player's kickoff (mergeSlotWrites), an
 * incomplete lineup at settle is a DNF (lib/weekly/settle.js), and confirming
 * is a RECEIPT that changes no outcome (app/actions/confirm.js). This file
 * scores nothing and decides nothing - it reads slotState for what a slot
 * says and liveEntryRows' numbers for what it is worth.
 *
 * WHAT IS NEW IS WHAT A READER SEES (docs/design/mocks/weekly-v2.html):
 *
 *   1. THE HEADER CARRIES THE WEEK'S NUMBERS. The live total and "Nth of M ·
 *      live" were a small strip under the pips; they are the hero now. Both
 *      are ABSENT, not zero, until something has kicked off - the whole
 *      .wkv-rec block renders only with a live layer, because "0.0" beside a
 *      lineup on Friday is a wrong number rather than a low one, and that is
 *      the same rule the slot rows have always followed.
 *   2. SIX SLOTS IN A 2x3 GRID, not six full-width rows, so the lineup reads
 *      as a lineup. Each slot says what its player's GAME is doing: the
 *      opponent and the kickoff before it starts, the period and the clock
 *      while it is on, the final score after (lib/gridiron/todayV2.js
 *      weekTeamGames now carries opp/home/score, and slotState orients none
 *      of it itself).
 *   3. THE POOL IS AN INLINE PANEL, not a sheet. Same poolRows(), same PPG
 *      sort, same search - it just no longer covers the lineup it is being
 *      picked into. A FLEX slot gets RB/WR/TE tabs, which is a filter over
 *      the SAME legality rule (slotAccepts), never a widening of it.
 *   4. THE FOOTER IS THE CONFIRM CONTROL, the way the Pick'em v2 board's is.
 *      ConfirmCard is retired from this page; the button writes
 *      meta.confirmed_at and nothing else, and editing after it un-confirms.
 *   5. THE × CLEARS AN OPEN SLOT. clear() has existed here since the first
 *      build and nothing ever called it, so a slot could be REPLACED but
 *      never emptied. mergeSlotWrites already deletes the key on a null, so
 *      this needed no writer change.
 *
 * ONE SCROLL (thu-2, 1 Oct). At 390 x 844 the first player row sat ~80% down
 * the screen - and only after a tap - inside a 262 px box that scrolled within
 * a page that also scrolled. Now: ONE header line (.wkv-top: the way back,
 * the week, the format, all from data), a six-segment progress bar with one
 * line under it, "How it works" folded into a <details> that is open only on
 * a first visit, the lineup as a 3 x 2 grid of 56 px slots (position and
 * SURNAME) that sticks under the header, the list's own header sticking under
 * that, and the rows as the PAGE's scroll. The first empty slot arrives
 * selected so the list is on screen without a tap. Items 1 and 2 above still
 * hold, except that an open slot no longer repeats its matchup - the list row
 * carries it; a live, final or bye slot keeps its line.
 *
 * THE COPY DOES NOT SAY "SCORES 0". The mock's footer does, and it is wrong:
 * a lineup short of six at settle is a DNF, not a five-man score. "Six filled
 * or the week does not count" is the ruled line.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { SLOTS } from '@/lib/weekly/rules';
import { slotState } from '@/lib/weekly/slotState';
import { nextOpenSlot } from '@/lib/daily/play';
import { poolRows, poolCountLabel, headerParts, surnameOf, WEEKLY_SEEN_COOKIE } from '@/lib/weekly/view';
import { ordinal } from '@/lib/standings/view';
import { useHandleGate, HELD } from '@/components/handle/HandleGate';
import StandaloneTime from '@/components/StandaloneTime';
import { confirmWeeklyEntry } from '@/app/actions/confirm';

const SLOT_LABEL = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', FLEX: 'FLEX', FLEX2: 'FLEX' };
const POOL_LABEL = {
  QB: 'Quarterbacks', RB: 'Running backs', WR: 'Receivers', TE: 'Tight ends',
  FLEX: 'Flex - RB / WR / TE', FLEX2: 'Flex - RB / WR / TE',
};
// The tabs a FLEX slot offers. A single-position slot has no tabs at all -
// one tab is a label pretending to be a control.
const FLEX_TABS = ['RB', 'WR', 'TE'];
// THE POSITION CLASS, for the slot's own colour. FLEX2 shares FLEX's.
const POS_CLASS = { QB: 'qb', RB: 'rb', WR: 'wr', TE: 'te', FLEX: 'flex', FLEX2: 'flex' };

// DEBOUNCE, NOT THROTTLE. A player filling six slots in ten seconds should
// produce one write, not six; the trailing edge is the one that matters
// because it is the only one that reflects the finished lineup.
const SAVE_DEBOUNCE_MS = 700;

/** "SF vs MIA" / "DET at BUF" - the game beside a name, in the player's own orientation. */
function matchupOf(team, st) {
  if (!team) return null;
  if (!st?.opp) return team;
  return `${team} ${st.home ? 'vs' : 'at'} ${st.opp}`;
}

export default function WeeklyRoom({
  contest, board, initialLineup = {}, signedIn = true, signinHref = '/signin',
  hasHandle = true, initialConfirmedAt = null, locksAt = null, firstKickoff = null,
  // THE WEEK'S GAMES, ALWAYS - teamAbbr -> {status, metadata, kickoffAt, opp,
  // home, score, oppScore} from weekTeamGames. Separate from `live` on
  // purpose: the opponent and the kickoff are public facts about the slate
  // that a slot needs on Wednesday, while `live` is null until a game starts.
  games = null,
  // THE LIVE LAYER. Plain objects, not Maps - this is a client component and
  // a Map does not cross that boundary. null before any game in the week has
  // kicked off, which is also the shape a signed-out reader gets, so every
  // consumer below is guarded on it.
  //   byId   playerId -> { points, played }
  //   total, startedCount, slots, rank, of
  live = null,
  // FIRST VISIT (thu-2): the page decides it - no entry and no sv_wk_seen
  // cookie (lib/weekly/view.js howOpenByDefault) - and "How it works" is
  // server-rendered open only then. The room sets the cookie on mount.
  firstVisit = false,
}) {
  // THE HANDLE IS ASKED FOR AT THE FIRST SLOT SAVED, not on page load
  // (components/handle/HandleGate.js). It guards the WRITE, so browsing the
  // pool, opening a slot and searching all stay open; only the request that
  // would put a row on a leaderboard waits for a name.
  const { guard, modal: handleModal, pending: heldSlots, reopen: reopenHandle } = useHandleGate(hasHandle);
  const [lineup, setLineup] = useState(initialLineup ?? {});
  // NOTHING SELECTED IS A REAL STATE NOW. The pool is inline, so the panel
  // has an empty state of its own and the reader can close it again; v1's
  // `active` was always one of the six because the pool lived in a sheet.
  //
  // ONE SLOT IS OPEN ON ARRIVAL (thu-2): the first empty slot, for a signed-in
  // reader, so the first player row is on screen without a tap. A full lineup
  // arrives with nothing selected; a signed-out reader's tap is still the door.
  const [active, setActive] = useState(() => (
    signedIn ? (SLOTS.find((s) => (initialLineup ?? {})[s] == null) ?? null) : null
  ));
  const [flexTab, setFlexTab] = useState('RB');
  const [save, setSave] = useState('clean');   // clean | saving | saved | error | held
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
  // CONFIRMATION IS A RECEIPT, NOT A SUBMIT (relay 3 item 3). The entry
  // already counts at lock whether or not this is set - autosave is still
  // the whole submit model - so this records that the reader has SEEN their
  // finished six, nothing more.
  const [confirmedAt, setConfirmedAt] = useState(initialConfirmedAt);
  const [confirming, setConfirming] = useState(false);
  const router = useRouter();
  const timer = useRef(null);
  const pending = useRef(null);
  const listRef = useRef(null);
  const headRef = useRef(null);
  const rootRef = useRef(null);

  // THE STICKY LAYERS START UNDER THE SITE'S OWN STICKY BAR. On the web the
  // global header (.gi-head) is sticky at top 0 and 63-69 px tall depending
  // on the width; in the app it is not sticky at all. Measured, not typed:
  // --wkv-stick is that bar's height, or unset (0) when there is none.
  useEffect(() => {
    const el = rootRef.current;
    const bar = document.querySelector('.gi-head');
    if (!el || !bar || getComputedStyle(bar).position !== 'sticky') return undefined;
    const set = () => el.style.setProperty('--wkv-stick', `${Math.round(bar.getBoundingClientRect().height)}px`);
    set();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(set) : null;
    ro?.observe(bar);
    return () => ro?.disconnect();
  }, []);

  // SEEN, FOR NEXT TIME. A year-long first-party cookie, no database row: the
  // next render of /weekly reads it and serves "How it works" closed.
  useEffect(() => {
    try { document.cookie = `${WEEKLY_SEEN_COOKIE}=1; path=/; max-age=31536000; samesite=lax`; } catch { /* blocked */ }
  }, []);

  // ONE SCROLL (thu-2): the list is the page's own scroll, so a pick made
  // forty rows down would leave the NEXT slot's list scrolled forty rows in.
  // When the slot or tab changes, bring the list's first row back up to just
  // under the stuck header - and only if it has gone above it.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const list = listRef.current; const head = headRef.current;
    if (!list || !head || typeof window.scrollBy !== 'function') return;
    const gap = list.getBoundingClientRect().top - head.getBoundingClientRect().bottom;
    if (gap < 0) window.scrollBy(0, gap);
  }, [active, flexTab]);

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
  const queue = useCallback((next, slot) => {
    pending.current = next;
    setSave('saving');
    if (timer.current) clearTimeout(timer.current);
    // GUARDED AT THE FLUSH, not at the tap: the debounce means one modal for
    // a burst of picks rather than one per slot, and the thunk guard() stashes
    // carries the LATEST pending payload, so a claim mid-burst still writes
    // the finished lineup rather than the slot that happened to open the modal.
    // THE SLOT THAT CHANGED RIDES WITH THE WRITE (D3): a held write paints
    // that slot "Needs a handle" until the claim replays it.
    timer.current = setTimeout(() => {
      if (guard(() => flush(pending.current), slot) === HELD) setSave('held');
    }, SAVE_DEBOUNCE_MS);
  }, [flush, guard]);

  // A pick made and the tab closed inside the debounce window would be lost.
  // Flushing on unmount and on hide costs nothing and closes that hole.
  useEffect(() => {
    const bail = () => {
      // THE BEACON FIRES WITH OR WITHOUT A HANDLE (D3). It used to bail when
      // no handle was claimed, so a reader who tapped Not now and left lost
      // the lineup. The server creates the entry either way - saveLineup has
      // no handle rule - and the handle attaches whenever it is claimed.
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

  // THE TAB IS A FILTER OVER THE SAME LEGALITY RULE. A FLEX slot draws from
  // RB/WR/TE; the tab narrows that to one of them by asking poolRows for that
  // position instead of the slot, which is the same slotAccepts() call with a
  // narrower argument - never a widening of what a slot will take.
  const poolSlot = active == null ? null : ((active === 'FLEX' || active === 'FLEX2') ? flexTab : active);
  // Memoised on the active slot AND the query: re-filtering and re-sorting
  // 873 rows on every change of state - and there is one on every pick and
  // every keystroke - is work with a visible cost.
  const rows = useMemo(() => (poolSlot ? poolRows(board, poolSlot, query) : []), [board, poolSlot, query]);

  function pick(id) {
    // EVERY TAKE ROUTES TO SIGN-IN, SIGNED OUT (2a-polish item 1) - a pick
    // this reader has no session to save is not a dead end, it is the door.
    if (!signedIn) { router.push(signinHref); return; }
    if (locked || active == null) return;
    if (slotLocked(active) || hasKicked(id)) return;
    const next = { ...lineup, [active]: id };
    setLineup(next);
    // A FULL LINEUP CLOSES THE PANEL rather than cycling back to QB; an
    // unfilled one advances to the next slot still empty.
    const stillEmpty = SLOTS.some((s) => next[s] == null);
    setActive(stillEmpty ? nextOpenSlot(active, next) : null);
    // THE QUERY CLEARS ON A PICK. Auto-advance moves to the next empty slot,
    // and a leftover "kelce" on the WR tab would show an empty pool - which
    // reads as a broken board, not as a filter still being applied.
    setQuery('');
    // EDITING AFTER CONFIRMING IS ALLOWED, and drops the confirmation.
    setConfirmedAt(null);
    queue(next, active);
  }

  function openSlot(slot) {
    if (slotLocked(slot)) return;
    if (!signedIn) { router.push(signinHref); return; }
    if (locked) return;
    // TAPPING THE SELECTED SLOT AGAIN CLOSES THE PANEL, as the mock does -
    // the panel is inline, so "nothing selected" has to be reachable without
    // picking somebody to get out of it.
    setActive((cur) => (cur === slot ? null : slot));
    setQuery('');
  }

  function clear(slot) {
    if (locked || slotLocked(slot)) return;
    const next = { ...lineup }; delete next[slot];
    setLineup(next);
    setActive(slot);
    setConfirmedAt(null);
    queue(next, slot);
  }

  // ONE SOURCE FOR THE COUNTERS (relay 3 item 1). These read `lineup`, the
  // same client state the slots read. They used to be computed in
  // app/weekly/page.js from entry.lineup - the SERVER's copy, frozen at page
  // load - so a pick updated the rows instantly and left the pips, the
  // caption and the needline showing the previous count.
  const filledSlots = SLOTS.filter((s2) => lineup[s2] != null);
  const unfilled = SLOTS.filter((s2) => lineup[s2] == null);
  const allSet = unfilled.length === 0;
  // TWO COUNTS, TWO NAMES. "filled" is how many slots hold a player; "open"
  // is how many can still be changed - an empty slot is open, a slot whose
  // player has kicked is not. The header used to imply they were one number.
  const openSlots = SLOTS.filter((s2) => !slotLocked(s2));

  // THE NEXT LOCK is the earliest kickoff among slots that are FILLED and
  // still OPEN - the next moment this lineup actually changes state. An empty
  // slot has no kickoff of its own (it locks whenever the player put into it
  // does), so it cannot contribute one.
  const nextLockIso = filledSlots
    .filter((s2) => !slotLocked(s2))
    .map((s2) => kickoffOf(lineup[s2]))
    .filter((k) => k != null)
    .map((k) => new Date(k).toISOString())
    .sort()[0] ?? null;

  // CLEAN CARRIES NO TEXT (relay 2a-polish-2 item d) - min-height on the row
  // keeps it from jumping when a real status appears.
  const saveLabel = { clean: '', saving: 'Saving…', saved: 'Saved', error: 'Not saved', held: 'Needs a handle' }[save];

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

  /** One slot's player, his game's state, and whether a number belongs on it. */
  function stateFor(slot) {
    const id = lineup[slot];
    const p = id ? board.find((b) => b.id === id) : null;
    if (!p) return { p: null, st: null, showPoints: false };
    const game = p.team ? games?.[p.team] ?? null : null;
    const st = slotState({
      row: {
        id: p.id, team: p.team ?? null,
        points: live?.byId?.[p.id]?.points ?? 0,
        played: Boolean(live?.byId?.[p.id]?.played),
      },
      game,
    });
    // A NUMBER ONLY WHERE THERE IS A LIVE LAYER TO HAVE PRODUCED ONE. With no
    // live read (signed out, or the read threw) a final game would otherwise
    // print the 0 this function handed slotState as though it were a score.
    return { p, st, showPoints: live != null && st.started };
  }

  const hd = headerParts(contest);

  return (
    <section className="wkv" ref={rootRef}>
      {handleModal}

      {/* ---- THE HEADER, ONE LINE (thu-2) ---------------------------------
          "← THE WEEKLY · WEEK 4 · PPR, drop worst". It replaces the page's
          eyebrow, its giant "Week N" title and this card's own duplicate
          header - three statements of where you are, now one. The week is
          the contest row's; the format words are WEEKLY_FORMAT's. Sticky,
          so the way out and the week stay on screen over the list. */}
      <header className="wkv-top">
        <Link className="wkv-back" href="/games" aria-label="Back to Games">&larr;</Link>
        <h1 className="wkv-title"><b>{hd.title}</b> &middot; {hd.format}</h1>
      </header>

      {/* ---- THE WEEK'S NUMBERS - only with a live layer -------------------
          Before the first kickoff there is no total and no rank, and stating
          them as zeros would be the one reading that is certainly wrong. */}
      {live && live.startedCount > 0 ? (
        <div className="wkv-rec">
          <div>
            <span className="wkv-eb wkv-quiet">Your lineup</span>
            <div className="wkv-big n">
              {live.total}
              <small className="n"> &middot; {live.startedCount} of {live.slots} started</small>
            </div>
          </div>
          {/* RANK ONLY WHEN THERE IS A LIVE BOARD TO BE RANKED ON. liveBoard
              is an aggregate over entries and carries no lineups - the leak
              law's shape for this window (lib/weekly/live.js). */}
          {live.rank != null ? (
            <div className="wkv-rt">
              <b className="n">{ordinal(live.rank) ?? live.rank}</b>
              <span>{live.of ? `of ${live.of} · live` : 'live'}</span>
              {/* THE RANK OPENS THE BOARD IT IS A RANK ON (lib/boards/live.js). */}
              <Link className="wkv-board" href="/weekly/board">Board &#8250;</Link>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ---- THE DEADLINE LINE ---------------------------------------------
          THE ONE DEADLINE ON THIS SCREEN and the only zone suffix: the next
          lock among filled open slots, or the rule. The COUNT and the six
          segments moved to the lock bar at the bottom (thu-6), so the count
          appears once. */}
      <div className="wkv-prog">
        <div className="wkv-sub">
          <span className="wkv-when">
            {nextLockIso
              ? <>next lock <StandaloneTime iso={nextLockIso} weekday /></>
              : openSlots.length > 0 ? 'each slot locks at its kickoff' : 'all locked'}
          </span>
          <span className={`wkv-save wkv-save--${save}`}>{saveLabel}</span>
        </div>
        {err && <p className="wkv-err">{err}</p>}
      </div>

      {/* ---- HOW IT WORKS, one row (thu-2) ----------------------------------
          A <details>, open by default only on a reader's first visit (the
          page decides; see lib/weekly/view.js howOpenByDefault). Everything
          the old step strip and its paragraph said lives in here now. */}
      <details className="wkv-how" open={firstVisit || undefined}>
        <summary>How it works</summary>
        <div className="wkv-how-b">
          <div className="row"><span>Your lineup</span><span className="r">QB &middot; RB &middot; WR &middot; TE &middot; 2 FLEX</span></div>
          <div className="row"><span>Each slot</span><span className="r">locks at its player&rsquo;s kickoff</span></div>
          <div className="row"><span>Scoring</span><span className="r">{hd.format}</span></div>
          <div className="row"><span>Results</span><span className="r">Tuesday morning</span></div>
          <p className="wkv-note">
            Every change saves - <b>six filled or the week does not count</b>, and a
            player already kicked cannot be added.
          </p>
          {/* THE CEILING, NAMED WITH THE RULES - the grade is your six as a
              share of the best six this pool allowed. */}
          <p className="wkv-perf">
            best six this pool allows &middot; {poolCountLabel(board.length)} players
          </p>
        </div>
      </details>

      {/* ---- THE LINEUP, 3 x 2, STICKY (thu-2) -----------------------------
          Six compact slots, 56 px at most: the position, then the SURNAME
          (or "Tap to fill"). A kicked slot adds its game's line - the score
          is what a reader needs on a Sunday. It sticks under the header so
          the list below can be the page's own scroll. */}
      <div className="wkv-dock">
        <div className="wkv-lineup">
          {SLOTS.map((s) => {
            const { p, st, showPoints } = stateFor(s);
            const isLocked = slotLocked(s);
            const held = heldSlots.has(s);
            const sel = active === s;
            const kindCls = st && isLocked ? ` kicked ${st.kind}` : '';
            return (
              <div
                key={s}
                className={`wkv-slot ${POS_CLASS[s]}${p ? ' filled' : ''}${sel ? ' sel' : ''}${kindCls}${held ? ' wkv-pending' : ''}`}
                data-game={st ? st.kind : undefined}
              >
                <button
                  type="button"
                  className="wkv-slot-tap"
                  disabled={isLocked}
                  aria-label={p ? `${SLOT_LABEL[s]}: ${p.name}` : `${SLOT_LABEL[s]}: empty`}
                  onClick={() => (held ? reopenHandle() : openSlot(s))}
                >
                  <span className="wkv-pos">
                    {SLOT_LABEL[s]}
                    {(s === 'FLEX' || s === 'FLEX2') && p ? ` · ${p.pos}` : ''}
                  </span>
                  {p ? (
                    <>
                      <span className="wkv-nm">{surnameOf(p.name)}</span>
                      {/* THE GAME'S LINE, ONLY WHEN IT CHANGES THE READING:
                            live   TM vs OPP · Q3 7:28
                            final  TM · Final 31-24
                            bye    TM · bye   (he will not play this week)
                          An open slot with a game to come carries no line -
                          its matchup and kickoff are on his row in the list. */}
                      {held ? <span className="wkv-st">Needs a handle</span>
                        : st?.kind === 'final'
                          ? <span className="wkv-st">{`${p.team}${st.score != null ? ` · Final ${st.score}-${st.oppScore}` : ' · final'}`}</span>
                          : st?.kind === 'live'
                            ? <span className="wkv-st l">{`${matchupOf(p.team, st)} · ${st.period ?? 'Live'}${st.clock ? ` ${st.clock}` : ''}`}</span>
                            : st?.kind === 'bye'
                              ? <span className="wkv-st">{`${p.team} · bye`}</span>
                              : null}
                    </>
                  ) : (
                    <span className="wkv-empty">{sel ? 'Pick below' : 'Tap to fill'}</span>
                  )}
                  {showPoints ? <span className="wkv-pts n">{st.points}</span> : null}
                  {isLocked ? <span className="wkv-lk">{st?.kind === 'live' ? 'LIVE' : 'FINAL'}</span> : null}
                </button>
                {/* THE ×, ON AN OPEN FILLED SLOT ONLY. A kicked slot has no ×
                    at all rather than one that refuses - the server rejects
                    that write ('held', lib/weekly/rules.js:80). Its own button
                    beside the tap target, because a button in a button is not
                    a button. */}
                {p && !isLocked && !locked && !held ? (
                  <button
                    type="button"
                    className="wkv-x"
                    onClick={() => clear(s)}
                    aria-label={`Clear ${SLOT_LABEL[s]}`}
                  >×</button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* ---- THE LIST --------------------------------------------------------
          One position at a time, searchable, PPG-sorted. Its header (QB ·
          search · 2026) sticks under the lineup; the rows are the PAGE's
          scroll - there is no inner scroll box (thu-2). */}
      <div className="wkv-panel">
        <div className="wkv-pan-h" ref={headRef}>
          <b>{active == null ? 'Tap an open slot' : `${SLOT_LABEL[active]} · ${POOL_LABEL[poolSlot] ?? POOL_LABEL[active]}`}</b>
          {active != null ? (
            <>
              <span className="wkv-find">
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={`search ${poolCountLabel(rows.length)}`}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="search"
                  aria-label={`Search ${POOL_LABEL[poolSlot] ?? POOL_LABEL[active]}`}
                />
              </span>
              {(active === 'FLEX' || active === 'FLEX2') ? (
                <span className="wkv-tabs">
                  {FLEX_TABS.map((t) => (
                    <button key={t} type="button"
                      className={`wkv-tab${t === flexTab ? ' on' : ''}`}
                      onClick={() => { setFlexTab(t); setQuery(''); }}>{t}</button>
                  ))}
                </span>
              ) : null}
              {/* THE SORT IS NAMED BY ITS SEASON, from the contest row -
                  never a typed year. */}
              <span className="wkv-srt">{contest.season_year ?? 'season'}</span>
            </>
          ) : null}
        </div>
        <div className="wkv-list" ref={listRef}>
          {active == null ? (
            <p className="wkv-empty-p">
              A KICKED SLOT IS LOCKED<br />THE OPEN ONES ARE YOURS UNTIL KICKOFF
            </p>
          ) : rows.length === 0 ? (
            <p className="wkv-find-none">
              No {(POOL_LABEL[poolSlot] ?? POOL_LABEL[active]).toLowerCase()} matching &ldquo;{query}&rdquo;.
            </p>
          ) : rows.map((p2) => {
            const kicked = hasKicked(p2.id);
            const mine = lineup[active] === p2.id;
            const used = picked.has(p2.id) && !mine;
            const gone = kicked || used;
            const game = p2.team ? games?.[p2.team] ?? null : null;
            const st = slotState({ row: { id: p2.id, team: p2.team ?? null, points: 0, played: false }, game });
            return (
              <button key={p2.id} type="button"
                className={`wkv-prow${mine ? ' sel' : ''}${gone ? ' gone' : ''}`}
                disabled={gone || locked}
                onClick={() => pick(p2.id)}>
                <span className={`wkv-pb ${POS_CLASS[p2.pos] ?? 'flex'}`}>{p2.pos}</span>
                <span className="wkv-who">
                  <b>{p2.name}</b>
                  {/* LINE ONE IS THE GAME. Who he plays, home or away, and
                      when - off the same slate value the slots read. */}
                  <small className={st?.kind === 'live' ? 'wkv-l' : undefined}>
                    {used ? 'in your lineup'
                      : kicked ? <>Kicked &middot; <StandaloneTime iso={p2.kickoff_at} weekday zone={false} /></>
                        : st?.kind === 'live'
                          ? `${matchupOf(p2.team, st)} · ${st.period ?? 'Live'}${st.clock ? ` ${st.clock}` : ''}`
                          : st?.kind === 'bye'
                            ? `${p2.team} · bye`
                            : <>{matchupOf(p2.team, st)}{p2.kickoff_at ? <> &middot; <StandaloneTime iso={p2.kickoff_at} weekday zone={false} /></> : null}</>}
                  </small>
                  {/* LINE TWO IS THIS SEASON, or nothing at all (ruled). */}
                  {p2.season?.line ? <small>{p2.season.line}</small> : null}
                </span>
                <span className="wkv-val">
                  {/* BLANK, NOT A ZERO, FOR A PLAYER WITH NO FINAL GAME YET. */}
                  <b className="n">{p2.season ? p2.season.ppg.toFixed(1) : ''}</b>
                  <small>{p2.season ? `ppg · ${p2.season.gp} g` : ''}</small>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ---- THE FOOTER: what the week means, in words ---------------------
          The confirm control is no longer here (thu-6): it is the lock bar
          below, which stays on screen over the list. */}
      <div className="wkv-ft">
        <p className="wkv-pace">
          {locked ? (
            <><b>The week has closed.</b> Your lineup is in as it stands.</>
          ) : openSlots.length === 0 ? (
            <><b>All six locked.</b> Worst pick drops at settle<br />Results Tuesday morning</>
          ) : confirmedAt ? (
            <><b>Locked in <StandaloneTime iso={confirmedAt} weekday zone={false} /></b> &middot; edit any open slot until its kickoff</>
          ) : (
            <>Every change saves<br /><b>Six filled or the week does not count</b></>
          )}
        </p>
      </div>

      {/* ---- THE LOCK BAR (thu-6) -------------------------------------------
          Sticky at the bottom - above the app's tab bar in the shell, at the
          viewport's bottom on the web - for as long as the room is open: some
          slot can still change and the week has not closed. Below six it is
          the count and the six segments; at six of six it IS the button, the
          same lockItIn the footer button used to call. Confirming is a
          RECEIPT (meta.confirmed_at) - an unconfirmed six counts the same. */}
      {!locked && openSlots.length > 0 ? (
        <div className="wkv-bar" data-full={allSet ? 'yes' : 'no'}>
          {allSet ? (
            <button type="button" className="wkv-lock"
              disabled={confirmedAt != null || confirming}
              onClick={lockItIn}>
              {confirmedAt ? 'Locked in' : confirming ? 'Locking…' : 'Lock it in'}
            </button>
          ) : (
            <>
              <span className="wkv-count">{filledSlots.length} of {SLOTS.length}</span>
              <div className="wkv-pips" aria-hidden="true">
                {SLOTS.map((s2) => {
                  const { st } = stateFor(s2);
                  const kind = st?.kind ?? null;
                  const cls = kind === 'final' ? ' done' : kind === 'live' ? ' live' : lineup[s2] != null ? ' on' : '';
                  return <span key={s2} className={`wkv-pip${cls}`} data-slot-state={kind ?? 'empty'} />;
                })}
              </div>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
