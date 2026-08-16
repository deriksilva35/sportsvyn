'use client';

/**
 * components/daily/DailyRoom.js — the play surface.
 *
 * THE COUNTDOWN HERE IS A PROGRESS BAR, NOT A RULE. It exists so the player can
 * see where they are. The server decides whether a lock is in time, from a
 * timestamp it issued and stored, and it will refuse a late lineup however good
 * it is. Nothing in this file is load-bearing for fairness - which is why the
 * timer running slow, being paused by a backgrounded tab, or being edited in a
 * console changes nothing.
 *
 * Three states, and it is only ever in one: rules (no entry) -> playing (board
 * issued) -> entered (locked, then optionally guessed).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SLOTS, CLOCK_MS, slotAccepts, nextOpenSlot } from '@/lib/daily/play';

// play.js is pure and importable here on purpose: the slot list, the clock
// length and the eligibility rule are ONE definition shared with the server
// that enforces them. They were duplicated in this file and a drift between
// the two copies would be a fairness bug that only shows up in production.
const SLOT_LABEL = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', FLEX: 'FLEX', FLEX2: 'FLEX' };

// WARN AT TWENTY SECONDS. The clock and its bar both turn live-red; nothing
// else on the screen changes, because a player at 0:20 needs one signal.
const WARN_MS = 20_000;

const POOL_LABEL = { QB: 'Quarterbacks', RB: 'Running backs', WR: 'Receivers', TE: 'Tight ends', FLEX: 'Flex - RB / WR / TE', FLEX2: 'Flex - RB / WR / TE' };

// THE RESUME IS SLICED HERE, NOT ON THE WIRE. It always arrives as
// "18.5 PPG · 126 g · Michigan · R6 #199"; the leading figure is the column a
// player scans, so it is pulled out and right-aligned while the name truncates.
// Presentational only - no field was added to publicBoard to make this work.
const ppgOf = (resume) => (resume ? String(resume).split(' · ')[0].replace(/\s*PPG$/, '') : '');
const restOf = (resume) => (resume ? String(resume).split(' · ').slice(1).join(' · ') : '');

const mmss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export default function DailyRoom({ puzzleDate, initialEntry }) {
  const [entry, setEntry] = useState(initialEntry ?? null);
  const [board, setBoard] = useState(null);
  const [startedAt, setStartedAt] = useState(null);
  const [lineup, setLineup] = useState({});
  const [active, setActive] = useState('QB');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [left, setLeft] = useState(CLOCK_MS);
  const [guessOpen, setGuessOpen] = useState(false);
  const submitted = useRef(false);

  // ---- the countdown -------------------------------------------------------
  useEffect(() => {
    if (!startedAt) return undefined;
    const t0 = new Date(startedAt).getTime();
    const tick = () => setLeft(CLOCK_MS - (Date.now() - t0));
    tick();
    const iv = setInterval(tick, 250);
    return () => clearInterval(iv);
  }, [startedAt]);

  const lock = useCallback(async (payload) => {
    if (submitted.current) return;
    submitted.current = true;
    setBusy(true); setErr(null);
    const res = await fetch('/api/daily/lock', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineup: payload }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      submitted.current = false;
      setErr(j.errors?.join(' · ') ?? (j.error === 'clock' ? 'Out of time.' : j.error ?? 'Something went wrong.'));
      if (j.error === 'clock') { setBoard(null); await refresh(); }
      return;
    }
    setBoard(null);
    setGuessOpen(true);
    await refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // AUTO-LOCK AT ZERO. Not a rule - the server would refuse a late submit
  // anyway - but leaving a filled board sitting past the buzzer with no way to
  // score it would be the interface losing the round for the player.
  useEffect(() => {
    if (!board || left > 0 || submitted.current) return;
    const filled = SLOTS.every((s) => lineup[s] != null);
    if (filled) lock(lineup);
  }, [left, board, lineup, lock]);

  async function refresh() {
    const res = await fetch(`/api/daily/view?date=${puzzleDate}`, { cache: 'no-store' });
    if (res.ok) { const j = await res.json(); setEntry(j.entry ?? null); }
  }

  async function start() {
    setBusy(true); setErr(null);
    const res = await fetch('/api/daily/start', { method: 'POST' });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setErr(j.error ?? 'Could not start.'); return; }
    setBoard(j.board); setStartedAt(j.startedAt); setLineup({}); setActive('QB');
  }

  async function sendGuess(season, week) {
    setBusy(true);
    const res = await fetch('/api/daily/guess', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ season, week }),
    });
    setBusy(false);
    if (res.ok) { setGuessOpen(false); await refresh(); }
  }

  const picked = useMemo(() => new Set(Object.values(lineup).filter(Boolean)), [lineup]);
  const filledCount = SLOTS.filter((s) => lineup[s] != null).length;

  // AUTO-ADVANCE. Computed from the NEXT lineup, not the current one, so the
  // slot just filled is never a candidate. Both writes happen outside the
  // setState updater - a setActive() inside one would fire twice under
  // StrictMode's double-invoke and could skip a slot.
  function pick(id) {
    const next = { ...lineup, [active]: id };
    setLineup(next);
    setActive(nextOpenSlot(active, next));
  }

  // Clearing a slot moves focus INTO it: emptying a slot is how a player says
  // "this is the one I want to redo", and making them tap it again afterwards
  // is the same wasted tap auto-advance exists to remove.
  function clear(slot) {
    setLineup((l) => { const n = { ...l }; delete n[slot]; return n; });
    setActive(slot);
  }

  // ---- ENTERED -------------------------------------------------------------
  // THE RECEIPT, and it rhymes with the homepage module on purpose: the same
  // big score, the same band pill beside it, the same quiet rows underneath.
  // Two surfaces reporting the same fact should not look like two facts.
  if (entry && !board) {
    return (
      <>
        <section className="mod mod--entered">
          <h2 className="eyebrow">Today&rsquo;s board <span className="ctx">&mdash; your entry</span></h2>
          <div className="score-row">
            <div className="score-big">{entry.score}</div>
            <div className="score-meta">
              {entry.band && <span className="tierbadge tier--pb">{entry.band}</span>}
              <span className="muted">
                {entry.entrants} {entry.entrants === 1 ? 'entry' : 'entries'} today
              </span>
            </div>
          </div>
          <div>
            {entry.guessed && entry.guessSeason != null && (
              <div className="row"><span>Your guess</span><span className="r">{entry.guessSeason} · Wk {entry.guessWeek}</span></div>
            )}
            {entry.bonusPct > 0 && (
              <div className="row"><span>Base score</span><span className="r">{entry.baseScore} <span className="r--mut">+{Math.round(entry.bonusPct * 100)}%</span></span></div>
            )}
            <div className="row"><span>Answer unlocks</span><span className="r r--mut">Midnight ET</span></div>
          </div>
          {guessOpen && !entry.guessed && <GuessForm onSubmit={sendGuess} busy={busy} />}
          {!guessOpen && !entry.guessed && (
            <button className="btn" onClick={() => setGuessOpen(true)}>Guess the week for a bonus →</button>
          )}
        </section>
      </>
    );
  }

  // ---- RULES ---------------------------------------------------------------
  // One tight module, eyebrow HOW IT WORKS, rows rather than a wall of bold
  // sentences. The PLAY primary is the screen's single primary (v1.2 s4).
  if (!board) {
    return (
      <>
        <section className="mod">
          <h2 className="eyebrow">How it works</h2>
          <div>
            <div className="row"><span>The board</span><span className="r">64 players</span></div>
            <div className="row"><span>Your lineup</span><span className="r">QB · RB · WR · TE · 2 FLEX</span></div>
            <div className="row"><span>The clock</span><span className="r">3:00, server-side</span></div>
            <div className="row"><span>Scoring</span><span className="r">PPR, worst pick dropped</span></div>
            <div className="row"><span>Bonus</span><span className="r">Name the season and week</span></div>
          </div>
          {err && <p className="err">{err}</p>}
          <button className="btn--volt" onClick={start} disabled={busy}>
            {busy ? 'Starting…' : 'Start the clock'}
          </button>
        </section>
      </>
    );
  }

  // ---- PLAYING -------------------------------------------------------------
  const late = left <= 0;
  return (
    <section className="mod mod--play">
      {/* PINNED HEAD: clock, slots, lock. Everything a player needs to see the
          state of the round stays on screen; only the pool moves. */}
      <div className="play-head">
      {/* THE CLOCK IS THIS SCREEN'S HERO and the bar belongs to it - one
          container, so they read as a single instrument. Warn at 20s: the
          number and its bar both go live-red together. */}
      <div className={`clock-inst${left <= WARN_MS ? ' clock-inst--low' : ''}`}>
        <div className="clock-row">
          <div className="clock">{mmss(left)}</div>
          <div className="clock-note">{filledCount} of 6 filled<br />PPR · drop worst</div>
        </div>
        <div className="clock-bar"><i style={{ width: `${Math.max(0, Math.min(100, (left / CLOCK_MS) * 100))}%` }} /></div>
      </div>

      <div className="slots">
        {SLOTS.map((s) => {
          const id = lineup[s];
          const p = id ? board.find((b) => b.id === id) : null;
          return (
            <button key={s} className={`slot${active === s ? ' slot--active' : ''}${p ? ' slot--filled' : ''}`}
              onClick={() => setActive(s)}>
              <span className="slot-tag">{SLOT_LABEL[s]}</span>
              <span className="slot-name">{p ? p.name : 'empty'}</span>
              {p && <span className="slot-x" onClick={(e) => { e.stopPropagation(); clear(s); }}>×</span>}
            </button>
          );
        })}
      </div>

      {err && <p className="err">{err}</p>}

      <button className="btn btn--volt btn--lock" disabled={busy || filledCount < 6 || late}
        onClick={() => lock(lineup)}>
        {busy ? 'Locking…' : late ? 'Out of time' : filledCount < 6 ? `${6 - filledCount} to fill` : 'Lock it in'}
      </button>

      {/* Names the column the eye is actually scanning. Pinned with the head,
          so it does not scroll away with the rows. */}
      <div className="pool-head">
        <span>{POOL_LABEL[active]}</span>
        <span>PPG</span>
      </div>
      </div>

      <div className="pool pool--scroll">
        {board.filter((p) => slotAccepts(active, p.pos)).map((p) => (
          <button key={p.id} className={`plyr${picked.has(p.id) ? ' plyr--used' : ''}`}
            disabled={picked.has(p.id) || late}
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

function GuessForm({ onSubmit, busy }) {
  const [season, setSeason] = useState('');
  const [week, setWeek] = useState('');
  const seasons = Array.from({ length: 10 }, (_, i) => 2015 + i);
  const weeks = Array.from({ length: 18 }, (_, i) => i + 1);
  return (
    <div className="guess">
      <p className="guess-lede">Which week was this? Both right is the full bonus.</p>
      <div className="guess-row">
        <select value={season} onChange={(e) => setSeason(e.target.value)} aria-label="Season">
          <option value="">Season</option>
          {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={week} onChange={(e) => setWeek(e.target.value)} aria-label="Week">
          <option value="">Week</option>
          {weeks.map((w) => <option key={w} value={w}>Week {w}</option>)}
        </select>
        <button className="btn btn--volt" disabled={busy || !season || !week}
          onClick={() => onSubmit(Number(season), Number(week))}>Submit</button>
      </div>
    </div>
  );
}
