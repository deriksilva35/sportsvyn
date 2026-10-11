'use client';

// components/draft/RankedRoom.js - the weekly Draft's room in THE DRAFT LOOK (sun-3).
//
// THE SAME ROOM, A NEW FACE. Every pick, the clock, AUTO and the confirm step go
// through the very server actions components/sim/DraftRoom.js uses (makePick,
// timerAutoPick, setAutoDraft) and the same client contracts (remainingSeconds
// from the server deadline; flagsAfterResult so a rejection hands the room back;
// one timerAutoPick per expired turn). Only the ranked weekly room renders here
// (app/sim/draft/[id]/page.js isRanked); practice mocks, league runs with
// keepers, and the tracker keep DraftRoom / TrackerRoom unchanged.
//
// THE LAYOUT (the sun-3 mock): navy header - lime eyebrow "THE DRAFT · NFL WEEK N
// · BEST 6 OF 8 COUNT", title "Round R of 8 · your pick" (or "· on deck"), the
// clock right in lime; a 12-seat strip that scrolls sideways (You lime, everyone
// else with their last pick); tabs Players | My team | Board. Players keeps
// search, position chips and ADP; a tap arms the row (lime, "Confirm"), a
// second tap picks.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { makePick, timerAutoPick, setAutoDraft } from '@/app/actions/sim';
import RoomScope from '@/components/shell/RoomScope';
import { flagsAfterResult, flagsAfterArm } from '@/lib/fantasy/roomFlags';
import { remainingSeconds } from '@/lib/draft/deadline';
import { buildBoard, boardName } from '@/lib/fantasy/board';
import { sendHaptic, sendPicksChanged } from '@/lib/shell/bridge';
import {
  POSITION_CHIPS, rankedEyebrow, rankedTitle, seatStripSeats, poolSub, filterPool, myTeamView, missingLine,
} from '@/lib/draft/roomLook';
import RoomHeader from '@/components/draftRoom/RoomHeader';
import SeatStrip from '@/components/draftRoom/SeatStrip';
import PoolRow from '@/components/draftRoom/PoolRow';

export const AUTO_CONFIRM = 'Let the room make your picks? Auto Draft fills every remaining round for you.';
const ERR = {
  illegal_pick: "Roster can't fit that pick", player_unavailable: 'Already drafted',
  not_your_turn: 'Not your turn', turn_expired: 'Time ran out - auto-picked', not_in_progress: 'Draft is over',
  no_legal_pick: 'No legal pick', not_found_or_not_owner: 'Not your draft', unauthenticated: 'Please sign in',
  week_locked: 'The week has locked', network: 'Connection lost - try again',
};
const ROW_CAP = 120;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export default function RankedRoom({
  draftId, config, order, userTeamIndex, initialPicks, initialAvailable, timerSeconds, turnDeadlineAt = null,
  renderedAt = null, initialAuto = false, withheld = [], matchups = null, week = null,
}) {
  const router = useRouter();
  const teams = config.teams_count ?? config.teamsCount;
  const rosterSlots = config.roster_slots ?? config.rosterSlots;
  const rounds = Object.values(rosterSlots).reduce((a, b) => a + b, 0);

  const [picks, setPicks] = useState(initialPicks);
  const [available, setAvailable] = useState(initialAvailable);
  const [armedId, setArmedId] = useState(null);
  const [revealing, setRevealing] = useState(false);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState('players');
  const [pos, setPos] = useState('ALL');
  const [q, setQ] = useState('');
  const [auto, setAuto] = useState(initialAuto === true);
  // Projections: every player this room will ever show is in its first picks
  // (the server's picks carry ppg) or its first available list, so one map made
  // at mount covers every pick made after it.
  const projById = useMemo(() => new Map([...initialAvailable, ...initialPicks].map((p) => [p.ffcPlayerId, p.ppg ?? null])), [initialAvailable, initialPicks]);
  const [clock, setClock] = useState(() => (
    turnDeadlineAt != null
      ? remainingSeconds(turnDeadlineAt, timerSeconds, renderedAt ? new Date(renderedAt) : new Date())
      : (timerSeconds ?? null)
  ));
  useEffect(() => {
    if (turnDeadlineAt == null) return undefined;
    const id = setTimeout(() => setClock(remainingSeconds(turnDeadlineAt, timerSeconds, new Date())), 0);
    return () => clearTimeout(id);
  }, [turnDeadlineAt, timerSeconds]);

  const currentOverall = picks.length + 1;
  const complete = currentOverall > order.length;
  const onClockTeam = complete ? null : order[currentOverall - 1];
  const isMyTurn = !complete && !revealing && onClockTeam === userTeamIndex;
  const canPick = isMyTurn && !auto;
  const withheldIds = useMemo(() => new Set((withheld ?? []).map((p) => p.ffcPlayerId ?? p)), [withheld]);

  const applyResult = useCallback(async (res) => {
    if (!res.ok) {
      const f = flagsAfterResult(res);
      setErr(f.err); setArmedId(f.armedId); setRevealing(f.revealing);
      return;
    }
    setArmedId(null); setErr(null); setRevealing(true);
    const newIds = new Set(res.picksMade.map((p) => p.ffcPlayerId));
    setAvailable((av) => av.filter((p) => !newIds.has(p.ffcPlayerId)));
    for (const pk of res.picksMade) {
      setPicks((ps) => [...ps, pk]);
      await delay(pk.isUser ? 0 : 220);
    }
    setRevealing(false);
    setClock(res.turnDeadlineAt != null
      ? remainingSeconds(res.turnDeadlineAt, timerSeconds, new Date())
      : (timerSeconds ?? null));
    if (res.turnExpired) setErr({ reason: 'turn_expired' });
    if (res.status === 'completed') { sendPicksChanged('draft'); router.refresh(); }
  }, [router, timerSeconds]);

  // TAP THEN CONFIRM: the first tap arms the row (lime, "Confirm"); the second picks.
  async function tap(player) {
    if (!canPick) return;
    if (armedId !== player.ffcPlayerId) {
      const f = flagsAfterArm(player.ffcPlayerId);
      setArmedId(f.armedId); setErr(f.err);
      return;
    }
    sendHaptic('heavy');
    setRevealing(true);
    try {
      await applyResult(await makePick(draftId, player.ffcPlayerId));
    } catch {
      const f = flagsAfterResult({ ok: false, reason: 'network' });
      setErr(f.err); setArmedId(f.armedId);
    } finally {
      setRevealing(false);
    }
  }

  async function toggleAuto() {
    const next = !auto;
    if (next && !window.confirm(AUTO_CONFIRM)) return;
    setAuto(next);
    const res = await setAutoDraft(draftId, next);
    if (!res.ok) { setAuto(!next); setErr({ reason: res.reason }); }
  }

  // AUTO drives each of the user's turns through the server's own engine path.
  useEffect(() => {
    if (!auto || !isMyTurn || revealing || complete) return undefined;
    let cancelled = false;
    (async () => {
      const res = await timerAutoPick(draftId);
      if (!cancelled) await applyResult(res);
    })();
    return () => { cancelled = true; };
  }, [auto, isMyTurn, revealing, complete, currentOverall, draftId, applyResult]);

  const wasMyTurn = useRef(false);
  useEffect(() => {
    if (canPick && !wasMyTurn.current) sendHaptic('notify');
    wasMyTurn.current = canPick;
  }, [canPick]);

  // The clock: the server deadline counted down; at 0, ONE timerAutoPick per turn.
  const firedRef = useRef(-1);
  useEffect(() => {
    if (timerSeconds == null || !canPick) return undefined;
    const t = setInterval(() => setClock((c) => (c == null ? c : c - 1)), 1000);
    return () => clearInterval(t);
  }, [canPick, currentOverall, timerSeconds]);
  useEffect(() => {
    if (timerSeconds == null || !canPick || clock == null || clock > 0) return;
    if (firedRef.current === currentOverall) return;
    firedRef.current = currentOverall;
    (async () => { await applyResult(await timerAutoPick(draftId)); })();
  }, [clock, canPick, currentOverall, timerSeconds, draftId, applyResult]);

  // Keep the seat on the clock in view on the sideways strip.
  useEffect(() => {
    const el = typeof document !== 'undefined' ? document.querySelector('[data-seat-strip="scroll"] [data-on-clock="1"]') : null;
    el?.scrollIntoView?.({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [currentOverall]);

  const seats = seatStripSeats({ teams, order, picks, userTeamIndex, currentOverall: complete ? null : currentOverall });
  const rows = filterPool(available.filter((p) => !withheldIds.has(p.ffcPlayerId)), { pos, q });
  const userPicks = picks.filter((p) => p.isUser);
  const team = myTeamView({
    userPicks, rosterSlots, order, userTeamIndex, teams,
    currentOverall: complete ? null : currentOverall,
    projOf: (p) => projById.get(p.ffcPlayerId),
  });
  const board = tab === 'board' ? buildBoard({ teamsCount: teams, rosterSlots }, picks, { userTeamIndex, currentOverall }) : null;
  const clockShown = canPick && clock != null ? Math.max(0, clock) : null;

  return (
    <div className="dgm drm-room" data-ranked-room data-your-turn={isMyTurn ? '1' : '0'}>
      <RoomScope tab="practice" timed={timerSeconds != null} />
      <RoomHeader
        eyebrow={rankedEyebrow(week, { rounds })}
        title={rankedTitle({ currentOverall, teams, rounds, yourTurn: isMyTurn, complete })}
        titleProps={{ 'data-room-header': '' }}
        right={clockShown != null ? <span data-room-clock>{clockShown}<small>SEC</small></span> : null}
      />
      <SeatStrip seats={seats} scroll />
      {err && (
        <p className="dgm-err" role="alert">
          {ERR[err.reason] ?? 'Something went wrong'}
          {' '}<button type="button" className="drm-chip" onClick={() => setErr(null)}>OK</button>
        </p>
      )}

      <div className="drm-tabs" role="tablist">
        {[['players', 'Players'], ['team', 'My team'], ['board', 'Board']].map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k}
            className={`drm-tab${tab === k ? ' drm-tab--on' : ''}`} onClick={() => setTab(k)}>{label}</button>
        ))}
        <button type="button" className={`drm-tab drm-auto${auto ? ' drm-tab--on' : ''}`} onClick={toggleAuto} aria-pressed={auto}>
          {auto ? 'Auto on' : 'Auto'}
        </button>
      </div>

      {tab === 'players' && (
        <section data-room-players>
          <input className="drm-search" type="search" placeholder="Search players" value={q}
            onChange={(e) => setQ(e.target.value)} aria-label="Search players" />
          <div className="drm-chips">
            {POSITION_CHIPS.map((c) => (
              <button key={c} type="button" className={`drm-chip${pos === c ? ' drm-chip--on' : ''}`} onClick={() => setPos(c)}>
                {c === 'ALL' ? 'All' : c}
              </button>
            ))}
          </div>
          <ul className="dgm-pool" aria-label="Available players">
            {rows.slice(0, ROW_CAP).map((p) => (
              <PoolRow key={p.ffcPlayerId} pos={p.position} name={p.name} sub={poolSub(p, matchups)}
                armed={armedId === p.ffcPlayerId} disabled={!canPick || revealing} onPick={() => tap(p)} />
            ))}
            {!rows.length && <li className="dgm-note">No player matches.</li>}
          </ul>
        </section>
      )}

      {tab === 'team' && (
        <section data-room-team>
          <div className="drm-team-hd">
            <b>YOUR TEAM · {team.count} OF {team.of}</b>
            <span className="n">proj {team.projTotal.toFixed(1)}</span>
          </div>
          <ul className="drm-slots">
            {team.slots.map((s, i) => (
              <li key={`${s.key}-${i}`} className={`drm-slot ${s.pick ? 'drm-slot--filled' : 'drm-slot--empty'}`}>
                <span className="drm-slot-key">{s.label}</span>
                <span>{s.pick ? <><b>{s.pick.playerName}</b> <small>{s.pick.team ?? ''}</small></>
                  : <>Empty{s.emptyRound != null ? ` / Round ${s.emptyRound}` : ''}</>}</span>
              </li>
            ))}
          </ul>
          <p className="drm-need">{missingLine(team.missing)}</p>
          {team.nextPick != null && <p className="drm-next">Your next pick: {team.nextPick}</p>}
        </section>
      )}

      {tab === 'board' && board && (
        <section className="drm-board" data-room-board>
          <table>
            <thead>
              <tr><th>Rd</th>{board.columns.map((c) => <th key={c.teamIndex} className={c.isYou ? 'drm-you' : ''}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {board.rows.map((r) => (
                <tr key={r.round}>
                  <th>{r.round}</th>
                  {r.cells.map((c) => (
                    <td key={c.overall} className={`${c.mine ? 'drm-you' : ''}${c.onClock ? ' drm-clock' : ''}`}>
                      {c.pick ? `${c.pick.slotPos ?? c.pick.position} ${boardName(c.pick.playerName)}` : ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
