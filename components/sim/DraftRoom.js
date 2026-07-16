'use client';

// components/sim/DraftRoom.js - the interactive draft room (ink surface).
// State comes from the server action returns ONLY: makePick/timerAutoPick return
// the new truth (the picks made), which we append. No client draft simulation,
// no polling (single user, synchronous).
//
// CONFIRM FLOW: two-step "arm then confirm" - tapping a player's Draft button
// ARMS the row (shows Confirm/Cancel); a second tap on Confirm calls makePick.
// Prevents fat-finger picks without a modal.
//
// LAYOUT: LEFT roster (narrow) · CENTER available (widest - it carries the stat
// columns) · RIGHT pick feed (slim ticker, newest on top). The on-the-clock
// banner and the AUTO toggle share a room header spanning all three columns.
// Mobile collapses to one column with tabs in reading order: Available / Roster / Feed.
//
// AUTO: flips drafts.is_auto via setAutoDraft, then hands each of the user's
// turns to the EXISTING timerAutoPick engine path - same engine, no new pick
// logic here. OFF returns control on the next turn.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { makePick, timerAutoPick, setAutoDraft, fetchPlayerStats } from '@/app/actions/sim';
import { getPlayerSeasonStatsFixture } from '@/lib/fantasy/statsFixture';
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

// Lineup order for the starter block. Counts stay CONFIG-DRIVEN (read off the
// preset's roster_slots row); only the ORDER is canonical here, because jsonb key
// order is an artifact of how the row was written, not a product decision. Any
// slot the config carries that isn't listed still renders (config-driven-
// everything: a new preset slot must never silently vanish from the roster).
const STARTER_ORDER = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'DST', 'K'];
const BENCH = 'BN';

function orderedSlots(rosterSlots) {
  const out = [];
  const push = (key, labeller) => {
    const n = rosterSlots[key] ?? 0;
    for (let i = 0; i < n; i++) out.push({ key, label: labeller(i, n), pick: null });
  };
  // Numbered only when the config gives more than one (RB1/RB2, but a lone TE).
  const starter = (key) => (i, n) => (n > 1 ? `${key}${i + 1}` : key);
  for (const key of STARTER_ORDER) push(key, starter(key));
  for (const key of Object.keys(rosterSlots)) {
    if (!STARTER_ORDER.includes(key) && key !== BENCH) push(key, starter(key));
  }
  push(BENCH, (i) => `BN${i + 1}`); // bench always last
  return out;
}

// A drafted player fills the first eligible OPEN slot; overflow goes to bench.
// rosterSlot on the pick is server truth (the engine assigned it), so this only
// places what the engine already decided.
function buildRoster(userPicks, rosterSlots) {
  const slots = orderedSlots(rosterSlots);
  for (const pk of [...userPicks].sort((a, b) => a.overallPick - b.overallPick)) {
    const s = slots.find((x) => x.key === pk.rosterSlot && !x.pick)
      || slots.find((x) => x.key === BENCH && !x.pick);
    if (s) s.pick = pk;
  }
  return slots;
}

// ?statsfixture=1 - DEV flag routing the stat strip to invented sample data so
// the UI can be built at real density before the backfill. Read lazily from the
// live URL inside the expand handler (browser-only, so no hydration concern and
// no state to keep in sync).
function isFixtureMode() {
  try {
    return new URLSearchParams(window.location.search).get('statsfixture') === '1';
  } catch { return false; } // malformed URL - stay on the real path
}

// Volt initials on ink - the avatar chip. No photos: no licensed NFL headshot
// source exists, and sim_player_pool.matched_player_id is NULL on every row, so
// there is nothing to join to even if one did.
function initials(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function DraftRoom({
  draftId, config, order, userTeamIndex, initialPicks, initialAvailable, timerSeconds, initialAuto,
}) {
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
  const [auto, setAuto] = useState(initialAuto === true);
  const [expandedId, setExpandedId] = useState(null);
  const [statsById, setStatsById] = useState({}); // id -> 'loading' | null | SeasonStats

  const currentOverall = picks.length + 1;
  const complete = currentOverall > order.length;
  const onClockTeam = complete ? null : order[currentOverall - 1];
  const isMyTurn = !complete && !revealing && onClockTeam === userTeamIndex;
  const canPick = isMyTurn && !auto; // AUTO owns the seat while it is on
  const round = complete ? null : Math.ceil(currentOverall / config.teams_count);
  const userPicks = useMemo(() => picks.filter((p) => p.isUser), [picks]);
  const roster = useMemo(() => buildRoster(userPicks, config.roster_slots), [userPicks, config.roster_slots]);

  // --- apply an action result (staggered reveal) ---
  const applyResult = useCallback(async (res) => {
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
  }, [router, timerSeconds]);

  async function confirm(player) {
    sendHaptic('heavy'); // confirm pick - the committing action (no-op off-shell)
    setRevealing(true);
    const res = await makePick(draftId, player.ffcPlayerId);
    await applyResult(res);
  }

  // --- AUTO toggle ---
  // ON: persist, then the effect below drives the user's turns through the
  // existing engine path (including the current pick if the clock is running).
  // OFF: the effect stops firing, so control returns on the next turn.
  async function toggleAuto() {
    const next = !auto;
    setAuto(next);
    if (next) sendHaptic('notify'); // a state change the user should feel in-app
    const res = await setAutoDraft(draftId, next);
    if (!res.ok) { setAuto(!next); setErr({ reason: res.reason }); } // revert on refusal
  }

  // AUTO drive: fires once per user turn. Reuses timerAutoPick - the SAME
  // server-authoritative engine path the pick timer already uses (engine.autoPick
  // for the user's seat, then advance AI). No new draft logic lives here.
  useEffect(() => {
    if (!auto || !isMyTurn || revealing || complete) return undefined;
    let cancelled = false;
    (async () => {
      const res = await timerAutoPick(draftId);
      if (!cancelled) await applyResult(res);
    })();
    return () => { cancelled = true; };
  }, [auto, isMyTurn, revealing, complete, currentOverall, draftId, applyResult]);

  // on-the-clock: your turn arrives (false -> true) -> notify haptic. Silent
  // under AUTO - the seat is on autopilot, so there is nothing to act on.
  const wasMyTurn = useRef(false);
  useEffect(() => {
    if (canPick && !wasMyTurn.current) sendHaptic('notify');
    wasMyTurn.current = canPick;
  }, [canPick]);

  // timer urgency: each second in the final 10 (matches the .low visual) -> tick.
  useEffect(() => {
    if (canPick && clock != null && clock > 0 && clock <= 10) sendHaptic('tick');
  }, [clock, canPick]);

  // --- advisory timer: counts down on the user's turn; auto-picks on expiry ---
  // clock resets to timerSeconds after each turn (in applyResult) and at mount
  // (initial state), so the interval effect only needs to tick - no reset here.
  // Both effects are gated on canPick: under AUTO the drive effect above owns
  // the turn, and a second timerAutoPick would race it.
  const firedRef = useRef(-1);
  useEffect(() => {
    if (timerSeconds == null || !canPick) return undefined;
    const t = setInterval(() => setClock((c) => (c == null ? c : c - 1)), 1000);
    return () => clearInterval(t);
  }, [canPick, currentOverall, timerSeconds]);
  useEffect(() => {
    if (timerSeconds == null || !canPick || clock == null || clock > 0) return;
    if (firedRef.current === currentOverall) return; // fire once per turn
    firedRef.current = currentOverall;
    (async () => { await applyResult(await timerAutoPick(draftId)); })();
  }, [clock, canPick, currentOverall, timerSeconds, draftId, applyResult]);

  // --- stat strip: expand a row -> load that player's season ---
  async function toggleExpand(p) {
    const id = p.ffcPlayerId;
    const next = expandedId === id ? null : id;
    setExpandedId(next);
    if (next == null || statsById[id] !== undefined) return;
    if (isFixtureMode()) { // DEV path only - invented numbers, badged as such
      setStatsById((m) => ({ ...m, [id]: getPlayerSeasonStatsFixture(id, p.position, p.bye) }));
      return;
    }
    setStatsById((m) => ({ ...m, [id]: 'loading' }));
    const res = await fetchPlayerStats(id);
    setStatsById((m) => ({ ...m, [id]: res.ok ? res.stats : null }));
  }

  const shown = useMemo(() => available
    .filter((p) => filter === 'ALL' || (SLOT_OF[p.position] ?? p.position) === filter)
    .filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.adp - b.adp), [available, filter, search]);

  return (
    <div className={`room tab-${tab}`}>
      {/* room header: on-the-clock + AUTO, spanning all three columns */}
      <div className="room-head">
        <div className={`on-clock${canPick ? '' : ' waiting'}`}>
          <span className="dot" />
          <span className="txt">{complete ? 'Draft complete' : auto
            ? <>Auto-drafting your seat · <b>Pick {currentOverall}</b> · Round {round}</>
            : isMyTurn
              ? <>You&apos;re on the clock · <b>Pick {currentOverall}</b> · Round {round}</>
              : <>Team {onClockTeam + 1} on the clock · Pick {currentOverall}</>}</span>
          {timerSeconds != null && canPick && <span className={`timer${clock <= 10 ? ' low' : ''}`}>{Math.max(0, clock ?? 0)}</span>}
        </div>
        {!complete && (
          <button
            type="button"
            className={`auto-toggle${auto ? ' on' : ''}`}
            onClick={toggleAuto}
            aria-pressed={auto}
            title={auto ? 'Auto-draft is making your picks' : 'Let the draft engine make your picks'}
          >
            <span className="sw" />Auto
          </button>
        )}
      </div>

      <div className="room-tabs">
        {['avail', 'roster', 'feed'].map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'avail' ? 'Available' : t}
          </button>
        ))}
      </div>

      {/* LEFT: roster in lineup order */}
      <div className="zone roster">
        <div className="zone-h">Your Roster · Seat {userTeamIndex + 1}</div>
        <div className="zone-body">
          {roster.map((s, i) => (
            <div key={i} className={`rslot${s.pick ? '' : ' open'}`}>
              <span className="lbl">{s.label}</span>
              {s.pick
                ? <><span className="nm">{s.pick.synthetic ? `Replacement ${s.pick.slotPos}` : s.pick.playerName}</span> {s.pick.team && <span className="tm">{s.pick.team}</span>}</>
                : <span className="nm">{s.key === BENCH ? 'bench' : s.label}</span>}
            </div>
          ))}
        </div>
      </div>

      {/* CENTER: available players + stat strips */}
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
          {shown.slice(0, 120).map((p) => {
            const val = Math.round(currentOverall - Number(p.adp)); // positive-good: he fell to you
            const open = expandedId === p.ffcPlayerId;
            const stats = statsById[p.ffcPlayerId];
            return (
              <div key={p.ffcPlayerId} className={`p-item${open ? ' open' : ''}`}>
                <div className={`p-row${armedId === p.ffcPlayerId ? ' armed' : ''}`}>
                  <button type="button" className="p-main" onClick={() => toggleExpand(p)} aria-expanded={open}>
                    <span className="ava">{initials(p.name)}</span>
                    <span className="p-id">
                      <span className="nm">{p.name}</span>
                      <span className="rng">{SLOT_OF[p.position] ?? p.position}{p.team ? `·${p.team}` : ''} · {r0(p.adpHigh)}-{r0(p.adpLow)}</span>
                    </span>
                    <span className="p-num">
                      <span className="adp">{r0(p.adp)}</span>
                      <span className="lbl">ADP</span>
                    </span>
                    <span className="p-num">
                      <span className={`val ${val >= 0 ? 'pos' : 'neg'}`}>{val >= 0 ? `+${val}` : val}</span>
                      <span className="lbl">VAL</span>
                    </span>
                  </button>
                  {canPick && (armedId === p.ffcPlayerId
                    ? <span className="p-act"><button className="confirm" onClick={() => confirm(p)}>Confirm</button><button className="cancel" onClick={() => { setArmedId(null); setErr(null); }}>✕</button></span>
                    : <button className="draft" onClick={() => { setArmedId(p.ffcPlayerId); setErr(null); sendHaptic('light'); }}>Draft</button>)}
                </div>
                {armedId === p.ffcPlayerId && err && <div className="p-err">{ERR[err.reason] ?? err.reason}</div>}
                {open && <StatStrip stats={stats} />}
              </div>
            );
          })}
          {!isMyTurn && !complete && <div className="p-err" style={{ color: 'var(--muted-dim)' }}>Waiting for AI…</div>}
        </div>
      </div>

      {/* RIGHT: pick feed ticker, newest on top */}
      <div className="zone feed">
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
    </div>
  );
}

// Season totals + game log for an expanded player. `stats` is undefined (not
// asked yet), 'loading', null (unknown - the honest state until the gridiron
// backfill lands), or a SeasonStats object.
function StatStrip({ stats }) {
  if (stats === undefined || stats === 'loading') return <div className="p-stats loading">Loading season…</div>;
  if (stats === null) {
    return (
      <div className="p-stats empty">
        Season stats land with the data backfill.
      </div>
    );
  }
  return (
    <div className="p-stats">
      <div className="s-totals">
        <span className="s-season">{stats.season}{stats.source === 'fixture' && <b className="s-fix">Fixture</b>}</span>
        {stats.totals.map((t) => (
          <span key={t.label} className="s-tot"><b>{t.value}</b><i>{t.label}</i></span>
        ))}
      </div>
      <div className="s-scroll">
        <table className="s-log">
          <thead>
            <tr><th>WK</th>{stats.columns.map((c) => <th key={c}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {stats.games.map((g) => (
              <tr key={g.week}>
                <td className="wk">{g.week}</td>
                {g.values.map((v, i) => <td key={i}>{v}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
