'use client';

// components/mockNba/MockNbaDraft.js - the NBA mock draft, played in the browser (sun-5).
//
// 12 teams x 13 rounds, you in one seat, 11 bots (lib/mockNba/draft.js). Nothing
// is sent to the server: the pool arrives with the page and the whole draft is
// pure state here, so it plays signed out. Picks are TAP THEN CONFIRM - the
// first tap arms the row (lime, "Confirm"), the second takes the player - the
// same grammar as the weekly Draft room.

import { useMemo, useState } from 'react';
import { createMock, runBots, applyPick, legalFor, onClock, isDone, nextPick, roundOf, seatAt, TOTAL } from '@/lib/mockNba/draft';
import { ROUNDS, TEAMS } from '@/lib/mockNba/roster';
import { gradeMock } from '@/lib/mockNba/grade';
import { encodeShare } from '@/lib/mockNba/share';

const CHIPS = ['ALL', 'G', 'F', 'C'];
const surname = (n) => String(n ?? '').split(/\s+/).slice(1).join(' ') || n;
const ordinal = (n) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
const sub = (p) => (p.rookie
  ? `${p.team ?? ''} · Rookie, pick #${p.draftNumber} · SV #${p.rank}`
  : `${p.team ?? ''} · SV #${p.rank} · ${Number(p.fppg).toFixed(1)} FP/G`);

export default function MockNbaDraft({ pool, builtAt }) {
  const [st, setSt] = useState(null);
  const [seatChoice, setSeatChoice] = useState('random');
  const [armed, setArmed] = useState(null);
  const [tab, setTab] = useState('players');
  const [pos, setPos] = useState('ALL');
  const [q, setQ] = useState('');
  const [shared, setShared] = useState(null);

  function start() {
    const seat = seatChoice === 'random' ? Math.floor(Math.random() * TEAMS) : Number(seatChoice) - 1;
    const seed = Math.floor(Math.random() * 2 ** 32);
    setSt(runBots(createMock(pool, { userSeat: seat, seed })));
    setArmed(null); setTab('players'); setShared(null);
  }

  function tap(p) {
    if (armed !== p.id) { setArmed(p.id); return; }
    setSt((s) => runBots(applyPick(s, p.id, 'user')));
    setArmed(null);
  }

  const legal = useMemo(() => (st && !isDone(st) ? new Set(legalFor(st, st.userSeat).map((p) => p.id)) : new Set()), [st]);
  const rows = useMemo(() => {
    if (!st) return [];
    const needle = q.trim().toLowerCase();
    return pool.filter((p) => !st.taken.has(p.id)
      && (pos === 'ALL' || String(p.pos).split('-').includes(pos))
      && (!needle || p.name.toLowerCase().includes(needle) || String(p.team ?? '').toLowerCase() === needle)).slice(0, 120);
  }, [st, pool, pos, q]);

  if (!st) {
    return (
      <section className="mnb-setup" data-mock-nba-setup>
        <div className="dgm-hd">
          <div className="dgm-eyebrow">NBA MOCK DRAFT · 12 TEAMS · 13 ROUNDS</div>
          <h1 className="dgm-hd-title">NBA Mock Draft 2026</h1>
          <div className="dgm-hd-sub">Points league. PG SG SF PF C G F UTIL UTIL + 4 bench. You against 11 bots.</div>
        </div>
        <p className="dgm-sub">Pick your seat, then draft. Players are ranked by SV rank: last season&apos;s fantasy points per game times games played; rookies by draft slot.</p>
        <div className="mnb-seats">
          {['random', ...Array.from({ length: TEAMS }, (_, i) => String(i + 1))].map((s) => (
            <button key={s} type="button" className={`mnb-chip${seatChoice === s ? ' mnb-chip--on' : ''}`} onClick={() => setSeatChoice(s)}>
              {s === 'random' ? 'Random' : `Pick ${s}`}
            </button>
          ))}
        </div>
        <button type="button" className="dgm-pill dgm-pill--lime mnb-start" onClick={start} data-mock-nba-start>Start the draft</button>
        <p className="dgm-foot">Pool: {pool.length} players on current NBA rosters{builtAt ? `, updated ${builtAt.slice(0, 10)}` : ''}. Positions are BDL&apos;s G / F / C.</p>
      </section>
    );
  }

  if (isDone(st)) {
    const g = gradeMock(st);
    const mine = st.rosters[st.userSeat];
    const ids = st.picks.filter((p) => p.seat === st.userSeat).map((p) => p.id);
    const cardUrl = `/mock/nba/card?d=${encodeShare({ grade: g.grade, seat: st.userSeat + 1, ids })}`;
    const text = `My NBA mock draft: ${g.grade} (${ordinal(g.place)} of ${TEAMS}) from pick ${st.userSeat + 1} on Sportsvyn. sportsvyn.com/mock/nba`;
    async function share() {
      try {
        if (navigator.share) { await navigator.share({ title: 'My NBA mock draft', text }); return; }
        await navigator.clipboard.writeText(text); setShared('Copied');
      } catch { /* closed */ }
    }
    return (
      <section className="mnb-result" data-mock-nba-result>
        <div className="dgm-hd dgm-hd--result">
          <div className="dgm-eyebrow">NBA MOCK DRAFT · PICK {st.userSeat + 1} · TEAM GRADE</div>
          <div className="dgm-big n" data-mock-nba-grade>{g.grade}</div>
          <div className="dgm-hd-sub">Team value {g.value.toLocaleString('en-US')} · {ordinal(g.place)} of {TEAMS}</div>
          {g.steal && <div className="dgm-top">Steal: {g.steal.name}, SV #{g.steal.rank}, taken {ordinal(g.steal.n)}</div>}
        </div>
        <ul className="dgm-scored" aria-label="Your team">
          {mine.map((r, i) => (
            <li key={i} className={`dgm-srow${r.slot === 'BN' ? ' dgm-srow--out' : ''}`}>
              <span className="dgm-pos">{r.slot}</span>
              <span className="dgm-who"><b>{r.player?.name ?? 'Empty'}</b><small>{r.player ? sub(r.player) : ''}</small></span>
              <span className="dgm-pts n">{r.player?.sv ?? ''}</span>
            </li>
          ))}
        </ul>
        <div className="dgm-actions">
          <button type="button" className="dgm-pill dgm-pill--lime" onClick={share}>{shared ?? 'Share'}</button>
          <a className="dgm-pill dgm-pill--outline" href={cardUrl} target="_blank" rel="noreferrer" data-mock-nba-card>Get the card</a>
          <button type="button" className="dgm-pill dgm-pill--outline" onClick={() => setSt(null)}>Draft again</button>
        </div>
      </section>
    );
  }

  const n = nextPick(st);
  const yourTurn = onClock(st) === st.userSeat;
  const lastBySeat = new Map(st.picks.map((p) => [p.seat, p]));
  const mustStart = legal.size > 0 && rows.some((p) => !legal.has(p.id));
  const myNext = (() => { for (let k = n; k <= TOTAL; k += 1) if (seatAt(k) === st.userSeat) return k; return null; })();

  return (
    <section className="mnb-room" data-mock-nba-room>
      <div className="dgm-hd">
        <div className="dgm-eyebrow">NBA MOCK DRAFT · 12 TEAMS · 13 ROUNDS</div>
        <h1 className="dgm-hd-title" data-room-header>Round {roundOf(n)} of {ROUNDS} · {yourTurn ? 'your pick' : 'on deck'}</h1>
        <div className="dgm-hd-sub">Pick {n} of {TOTAL}</div>
      </div>
      <div className="mnb-strip" data-seat-strip="scroll">
        {Array.from({ length: TEAMS }, (_, i) => {
          const p = lastBySeat.get(i);
          const pl = p ? pool.find((x) => x.id === p.id) : null;
          return (
            <div key={i} className={`dgm-tile${i === st.userSeat ? ' dgm-tile--you' : ''}`}>
              <b>{i === st.userSeat ? 'You' : `Team ${i + 1}`}</b>
              <span className="mnb-tile-sub">{pl ? surname(pl.name) : '-'}</span>
            </div>
          );
        })}
      </div>

      <div className="mnb-tabs" role="tablist">
        {[['players', 'Players'], ['team', 'My team'], ['board', 'Board']].map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`mnb-tab${tab === k ? ' mnb-tab--on' : ''}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {tab === 'players' && (
        <>
          <input className="mnb-search" type="search" placeholder="Search players" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search players" />
          <div className="mnb-chips">
            {CHIPS.map((c) => (
              <button key={c} type="button" className={`mnb-chip${pos === c ? ' mnb-chip--on' : ''}`} onClick={() => setPos(c)}>{c === 'ALL' ? 'All' : c}</button>
            ))}
          </div>
          {mustStart && <p className="dgm-note">Your remaining picks must fill your empty starting slots.</p>}
          <ul className="dgm-pool" aria-label="Available players">
            {rows.map((p) => {
              const ok = legal.has(p.id);
              const isArmed = armed === p.id;
              return (
                <li key={p.id} className={`dgm-prow${isArmed ? ' mnb-prow--armed' : ''}`} data-armed={isArmed ? '1' : undefined}>
                  <span className="dgm-pos">{p.pos}</span>
                  <span className="dgm-who"><b>{p.name}</b><small>{sub(p)}</small></span>
                  <button type="button" className={`dgm-pill dgm-pill--sm${isArmed ? ' dgm-pill--lime' : ''}`} disabled={!yourTurn || !ok} onClick={() => tap(p)}>
                    {isArmed ? 'Confirm' : 'Draft'}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {tab === 'team' && (
        <>
          <ul className="dgm-scored" aria-label="Your team">
            {st.rosters[st.userSeat].map((r, i) => (
              <li key={i} className="dgm-srow">
                <span className="dgm-pos">{r.slot}</span>
                <span className="dgm-who"><b>{r.player?.name ?? 'Empty'}</b><small>{r.player ? sub(r.player) : ''}</small></span>
                <span className="dgm-pts n">{r.player?.sv ?? ''}</span>
              </li>
            ))}
          </ul>
          {myNext != null && <p className="dgm-note">Your next pick: {myNext}</p>}
        </>
      )}

      {tab === 'board' && (
        <div className="mnb-board">
          <table>
            <thead><tr><th>Rd</th>{Array.from({ length: TEAMS }, (_, i) => <th key={i} className={i === st.userSeat ? 'mnb-you' : ''}>{i === st.userSeat ? 'YOU' : i + 1}</th>)}</tr></thead>
            <tbody>
              {Array.from({ length: ROUNDS }, (_, r) => (
                <tr key={r}>
                  <th>{r + 1}</th>
                  {Array.from({ length: TEAMS }, (_, seat) => {
                    const pk = st.picks.find((p) => p.seat === seat && roundOf(p.n) === r + 1);
                    const pl = pk ? pool.find((x) => x.id === pk.id) : null;
                    return <td key={seat} className={seat === st.userSeat ? 'mnb-you' : ''}>{pl ? surname(pl.name) : ''}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
