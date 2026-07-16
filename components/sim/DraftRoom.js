'use client';

// components/sim/DraftRoom.js — the interactive draft room (ink surface).
// State comes from the server action returns ONLY: makePick/timerAutoPick return
// the new truth (the picks made), which we append. No client draft simulation,
// no polling (single user, synchronous).
//
// CONFIRM FLOW: two-step "arm then confirm" — tapping a player's Draft button
// ARMS the row (shows Confirm/Cancel); a second tap on Confirm calls makePick.
// Prevents fat-finger picks without a modal.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { makePick, timerAutoPick } from '@/app/actions/sim';
import { sendHaptic } from '@/lib/shell/bridge';

const SLOT_OF = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', PK: 'K', DEF: 'DST' };
const POS_FILTERS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DST'];
const ERR = {
  illegal_pick: "Roster can't fit that pick", player_unavailable: 'Already drafted',
  not_your_turn: 'Not your turn', not_in_progress: 'Draft is over', no_legal_pick: 'No legal pick',
  not_found_or_not_owner: 'Not your draft', unauthenticated: 'Please sign in',
};
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const r0 = (x) => (x == null ? '?' : Math.round(Number(x)));

function expandSlots(rosterSlots) {
  const out = [];
  for (const [k, n] of Object.entries(rosterSlots)) for (let i = 0; i < n; i++) out.push(k);
  return out;
}
function buildRoster(userPicks, rosterSlots) {
  const slots = expandSlots(rosterSlots).map((label) => ({ label, pick: null }));
  for (const pk of [...userPicks].sort((a, b) => a.overallPick - b.overallPick)) {
    const s = slots.find((x) => x.label === pk.rosterSlot && !x.pick)
      || slots.find((x) => x.label === 'BN' && !x.pick);
    if (s) s.pick = pk;
  }
  return slots;
}

export default function DraftRoom({ draftId, config, order, userTeamIndex, initialPicks, initialAvailable, timerSeconds }) {
  const router = useRouter();
  const [picks, setPicks] = useState(initialPicks);
  const [available, setAvailable] = useState(initialAvailable);
  const [armedId, setArmedId] = useState(null);
  const [revealing, setRevealing] = useState(false);
  const [err, setErr] = useState(null);          // { id?, reason }
  const [filter, setFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('avail');
  const [clock, setClock] = useState(timerSeconds ?? null);

  const currentOverall = picks.length + 1;
  const complete = currentOverall > order.length;
  const onClockTeam = complete ? null : order[currentOverall - 1];
  const isMyTurn = !complete && !revealing && onClockTeam === userTeamIndex;
  const round = complete ? null : Math.ceil(currentOverall / config.teams_count);
  const userPicks = useMemo(() => picks.filter((p) => p.isUser), [picks]);
  const roster = useMemo(() => buildRoster(userPicks, config.roster_slots), [userPicks, config.roster_slots]);

  // --- apply an action result (staggered reveal) ---
  async function applyResult(res) {
    if (!res.ok) { setErr({ reason: res.reason }); setArmedId(null); return; }
    setArmedId(null); setErr(null); setRevealing(true);
    const newIds = new Set(res.picksMade.map((p) => p.ffcPlayerId));
    setAvailable((av) => av.filter((p) => !newIds.has(p.ffcPlayerId)));
    for (const pk of res.picksMade) {
      setPicks((ps) => [...ps, pk]);
      await delay(pk.isUser ? 0 : 220); // user pick instant; AI picks reveal one by one
    }
    setRevealing(false);
    setClock(timerSeconds ?? null);
    if (res.status === 'completed') router.refresh(); // server re-renders as results
  }

  async function confirm(player) {
    sendHaptic('heavy'); // confirm pick — the committing action (no-op off-shell)
    setRevealing(true);
    const res = await makePick(draftId, player.ffcPlayerId);
    await applyResult(res);
  }

  // on-the-clock: your turn arrives (false -> true) -> notify haptic.
  const wasMyTurn = useRef(false);
  useEffect(() => {
    if (isMyTurn && !wasMyTurn.current) sendHaptic('notify');
    wasMyTurn.current = isMyTurn;
  }, [isMyTurn]);

  // timer urgency: each second in the final 10 (matches the .low visual) -> tick.
  useEffect(() => {
    if (isMyTurn && clock != null && clock > 0 && clock <= 10) sendHaptic('tick');
  }, [clock, isMyTurn]);

  // --- advisory timer: counts down on the user's turn; auto-picks on expiry ---
  // clock resets to timerSeconds after each turn (in applyResult) and at mount
  // (initial state), so the interval effect only needs to tick — no reset here.
  const firedRef = useRef(-1);
  useEffect(() => {
    if (timerSeconds == null || !isMyTurn) return undefined;
    const t = setInterval(() => setClock((c) => (c == null ? c : c - 1)), 1000);
    return () => clearInterval(t);
  }, [isMyTurn, currentOverall, timerSeconds]);
  useEffect(() => {
    if (timerSeconds == null || !isMyTurn || clock == null || clock > 0) return;
    if (firedRef.current === currentOverall) return; // fire once per turn
    firedRef.current = currentOverall;
    (async () => { await applyResult(await timerAutoPick(draftId)); })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock, isMyTurn, currentOverall, timerSeconds]);

  const shown = useMemo(() => available
    .filter((p) => filter === 'ALL' || (SLOT_OF[p.position] ?? p.position) === filter)
    .filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.adp - b.adp), [available, filter, search]);

  const label = (pk) => `${pk.playerName}${pk.team ? ` ${SLOT_OF[pk.position] ?? pk.position}·${pk.team}` : ` ${SLOT_OF[pk.position] ?? pk.position}`}`;

  return (
    <div className={`room tab-${tab}`}>
      <div className="room-tabs">
        {['roster', 'feed', 'avail'].map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {/* on-the-clock banner spans full width above zones on mobile; here inside center */}
      {/* LEFT: roster */}
      <div className="zone roster">
        <div className="zone-h">Your Roster · Seat {userTeamIndex + 1}</div>
        <div className="zone-body">
          {roster.map((s, i) => (
            <div key={i} className={`rslot${s.pick ? '' : ' open'}`}>
              <span className="lbl">{s.label}</span>
              {s.pick
                ? <><span className="nm">{s.pick.synthetic ? `Replacement ${s.pick.slotPos}` : s.pick.playerName}</span> {s.pick.team && <span className="tm">{s.pick.team}</span>}</>
                : <span className="nm">empty</span>}
            </div>
          ))}
        </div>
      </div>

      {/* CENTER: on-clock + feed */}
      <div className="zone feed">
        <div style={{ padding: 10 }}>
          <div className={`on-clock${isMyTurn ? '' : ' waiting'}`}>
            <span className="dot" />
            <span className="txt">{complete ? 'Draft complete' : isMyTurn
              ? <>You&apos;re on the clock · <b>Pick {currentOverall}</b> · Round {round}</>
              : <>Team {onClockTeam + 1} on the clock · Pick {currentOverall}</>}</span>
            {timerSeconds != null && isMyTurn && <span className={`timer${clock <= 10 ? ' low' : ''}`}>{Math.max(0, clock ?? 0)}</span>}
          </div>
        </div>
        <div className="zone-h">Pick Feed</div>
        <div className="zone-body">
          {[...picks].reverse().map((pk, idx) => (
            <div key={pk.overallPick} className={`feed-row ${pk.isUser ? 'user' : 'ai'}${idx === 0 ? ' feed-reveal' : ''}`}>
              <span className="ov">{pk.overallPick}</span>
              <span><span className="nm">{pk.synthetic ? `Replacement ${pk.slotPos}` : pk.playerName}</span> <span className="pt">{pk.slotPos}{pk.team ? `·${pk.team}` : ''}</span></span>
              <span className="slot">{pk.rosterSlot}</span>
            </div>
          ))}
        </div>
      </div>

      {/* RIGHT: available */}
      <div className="zone avail">
        <div className="zone-h">Available</div>
        <div className="avail-tools">
          <input className="avail-search" placeholder="Search players" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="avail-chips">
            {POS_FILTERS.map((f) => <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f}</button>)}
          </div>
        </div>
        <div className="zone-body">
          {err && !err.id && <div className="p-err">{ERR[err.reason] ?? err.reason}</div>}
          {shown.slice(0, 120).map((p) => (
            <div key={p.ffcPlayerId}>
              <div className={`p-row${armedId === p.ffcPlayerId ? ' armed' : ''}`}>
                <span className="adp">{r0(p.adp)}</span>
                <span><span className="nm">{p.name}</span> <span className="rng">{SLOT_OF[p.position] ?? p.position}{p.team ? `·${p.team}` : ''} · {r0(p.adpHigh)}-{r0(p.adpLow)}</span></span>
                {isMyTurn && (armedId === p.ffcPlayerId
                  ? <span style={{ display: 'flex', gap: 4 }}><button className="confirm" onClick={() => confirm(p)}>Confirm</button><button className="cancel" onClick={() => { setArmedId(null); setErr(null); }}>✕</button></span>
                  : <button className="draft" onClick={() => { setArmedId(p.ffcPlayerId); setErr(null); sendHaptic('light'); }}>Draft</button>)}
              </div>
              {armedId === p.ffcPlayerId && err && <div className="p-err">{ERR[err.reason] ?? err.reason}</div>}
            </div>
          ))}
          {!isMyTurn && !complete && <div className="p-err" style={{ color: 'var(--muted-dim)' }}>Waiting for AI…</div>}
        </div>
      </div>
    </div>
  );
}
