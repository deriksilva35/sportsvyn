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

const SLOTS = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'FLEX2'];
const SLOT_LABEL = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', FLEX: 'FLEX', FLEX2: 'FLEX' };
const FLEX_OK = new Set(['RB', 'WR', 'TE']);
const accepts = (slot, pos) => (slot.startsWith('FLEX') ? FLEX_OK.has(pos) : slot === pos);
const CLOCK_MS = 120_000;

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

  // ---- ENTERED -------------------------------------------------------------
  if (entry && !board) {
    return (
      <section className="mod mod--entered">
        <h1 className="mod-title">You&rsquo;re in</h1>
        <div className="score-row">
          <div className="score-big">{entry.score}</div>
          <div className="score-meta">
            <span className="band">{entry.band}</span>
            <span className="muted">{entry.entrants} {entry.entrants === 1 ? 'entry' : 'entries'} today</span>
          </div>
        </div>
        {entry.bonusPct > 0 && (
          <p className="muted">Base {entry.baseScore} · guess bonus +{Math.round(entry.bonusPct * 100)}%</p>
        )}
        {guessOpen && !entry.guessed && <GuessForm onSubmit={sendGuess} busy={busy} />}
        {!guessOpen && !entry.guessed && (
          <button className="btn" onClick={() => setGuessOpen(true)}>Guess the week for a bonus</button>
        )}
        <p className="mod-foot">
          The board, the answer and the perfect lineup unlock at midnight ET.
        </p>
      </section>
    );
  }

  // ---- RULES ---------------------------------------------------------------
  if (!board) {
    return (
      <section className="mod mod--rules">
        <h1 className="mod-title">Today&rsquo;s board</h1>
        <ul className="mod-list">
          <li><b>Sixty-four players</b> from one real week of NFL history.</li>
          <li><b>Six slots:</b> QB, RB, WR, TE and two FLEX (RB/WR/TE).</li>
          <li><b>Two minutes</b> from the moment you start. The clock is server-side.</li>
          <li><b>Your worst pick is dropped</b> — five of six count.</li>
          <li>Name the season and week afterwards for a bonus.</li>
        </ul>
        {err && <p className="err">{err}</p>}
        <button className="btn btn--volt" onClick={start} disabled={busy}>
          {busy ? 'Starting…' : 'Start the clock'}
        </button>
      </section>
    );
  }

  // ---- PLAYING -------------------------------------------------------------
  const late = left <= 0;
  return (
    <section className="mod mod--play">
      <div className="clock-row">
        <div className={`clock${left < 30_000 ? ' clock--low' : ''}`}>{mmss(left)}</div>
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
              {p && <span className="slot-x" onClick={(e) => { e.stopPropagation(); setLineup((l) => { const n = { ...l }; delete n[s]; return n; }); }}>×</span>}
            </button>
          );
        })}
      </div>

      {err && <p className="err">{err}</p>}

      <button className="btn btn--volt btn--lock" disabled={busy || filledCount < 6 || late}
        onClick={() => lock(lineup)}>
        {busy ? 'Locking…' : late ? 'Out of time' : filledCount < 6 ? `${6 - filledCount} to fill` : 'Lock it in'}
      </button>

      <div className="pool">
        {board.filter((p) => accepts(active, p.pos)).map((p) => (
          <button key={p.id} className={`plyr${picked.has(p.id) ? ' plyr--used' : ''}`}
            disabled={picked.has(p.id) || late}
            onClick={() => setLineup((l) => ({ ...l, [active]: p.id }))}>
            <span className="plyr-pos">{p.pos}</span>
            <span className="plyr-name">{p.name}</span>
            {p.resume && <span className="plyr-resume">{p.resume}</span>}
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
