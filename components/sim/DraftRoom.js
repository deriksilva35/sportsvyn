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

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { makePick, timerAutoPick, setAutoDraft, fetchPlayerStats, fetchPlayerSummaries } from '@/app/actions/sim';
import { SCORING_LABEL } from '@/lib/fantasy/config';
import {
  viewFor, sortsFor, sortPlayers, displayPosition, teamsInPool, filterPlayers,
} from '@/lib/fantasy/statView';
import { seasonSummary, fantasyPoints, isExactlyScored } from '@/lib/fantasy/scoring';
import { buildRoster, BENCH } from '@/lib/fantasy/roster';
import { buildBoard, boardName } from '@/lib/fantasy/board';
import { sendHaptic } from '@/lib/shell/bridge';

const PAGES = ['BOARD', 'PICK', 'ROSTER']; // swipe pager order; PICK is the default landing

const POS_FILTERS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DST'];
const ERR = {
  illegal_pick: "Roster can't fit that pick", player_unavailable: 'Already drafted',
  not_your_turn: 'Not your turn', not_in_progress: 'Draft is over', no_legal_pick: 'No legal pick',
  not_found_or_not_owner: 'Not your draft', unauthenticated: 'Please sign in',
};
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const r0 = (x) => (x == null ? '?' : Math.round(Number(x)));

// The avatar chip shows the player's POSITION (volt on ink). No photos: no
// licensed NFL headshot source exists, so the position label is the identity cue.

export default function DraftRoom({
  draftId, config, order, userTeamIndex, initialPicks, initialAvailable, timerSeconds, initialAuto, poolMapping,
}) {
  const router = useRouter();
  const [picks, setPicks] = useState(initialPicks);
  const [available, setAvailable] = useState(initialAvailable);
  const [armedId, setArmedId] = useState(null);
  const [revealing, setRevealing] = useState(false);
  const [err, setErr] = useState(null);          // { id?, reason }
  const [filter, setFilter] = useState('ALL');
  const [team, setTeam] = useState('ALL');
  const [sort, setSort] = useState('adp');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1); // swipe pager index: 0 BOARD / 1 PICK / 2 ROSTER
  const pagerRef = useRef(null);
  const [clock, setClock] = useState(timerSeconds ?? null);
  const [auto, setAuto] = useState(initialAuto === true);
  const [expandedId, setExpandedId] = useState(null);
  const [statsById, setStatsById] = useState({}); // id -> 'loading' | null | SeasonStats
  const [summaries, setSummaries] = useState({}); // id -> season summary, for quick stats

  const currentOverall = picks.length + 1;
  const complete = currentOverall > order.length;
  const onClockTeam = complete ? null : order[currentOverall - 1];
  const isMyTurn = !complete && !revealing && onClockTeam === userTeamIndex;
  const canPick = isMyTurn && !auto; // AUTO owns the seat while it is on
  const round = complete ? null : Math.ceil(currentOverall / config.teams_count);
  const userPicks = useMemo(() => picks.filter((p) => p.isUser), [picks]);
  const roster = useMemo(() => buildRoster(userPicks, config.roster_slots), [userPicks, config.roster_slots]);

  // BOARD page: the whole snake grid, derived from live picks + config.
  const board = useMemo(
    () => buildBoard(config, picks, { userTeamIndex, currentOverall: complete ? null : currentOverall }),
    [config, picks, userTeamIndex, complete, currentOverall],
  );
  // LAST pick strip: slot (round.pickInRound), team, name, position — updates every pick.
  const last = picks[picks.length - 1] ?? null;
  const lastLine = last ? {
    slot: `${last.round}.${String(((last.overallPick - 1) % config.teams_count) + 1).padStart(2, '0')}`,
    team: order[last.overallPick - 1] + 1,
    name: last.synthetic ? `Replacement ${last.slotPos}` : last.playerName,
    pos: last.slotPos, teamAbbr: last.team,
  } : null;

  // Swipe pager: dots sync with scroll; taps jump. Default lands on PICK. The
  // pick dot pulses when it is the user's turn but they are on another page — a
  // nudge, never a yank (the banner already signals the turn).
  // Tap-to-jump uses an INSTANT scroll, not smooth: scroll-snap-type: mandatory
  // cancels a programmatic smooth scroll (the snap yanks it back to the current
  // page mid-animation), so smooth would leave the pager stuck. 'auto' lands on
  // the target snap point reliably. Swipes stay smooth (they are user-driven).
  const jump = useCallback((i) => {
    const el = pagerRef.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: 'auto' });
    setPage(i);
  }, []);
  const onPagerScroll = useCallback(() => {
    const el = pagerRef.current;
    if (!el) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    setPage((prev) => (prev === i ? prev : i));
  }, []);
  // Land on PICK once mounted: set the pager scroll directly (no setState in the
  // effect body). `page` already defaults to 1, and onPagerScroll keeps it synced.
  useEffect(() => {
    const el = pagerRef.current;
    if (el) el.scrollLeft = el.clientWidth;
  }, []);

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

  // --- quick stats: ONE batched load for the whole pool, never one per row ---
  // Runs once. Summaries are keyed by player id and stay valid as the available
  // list shrinks, so there is nothing to refetch as picks come off the board.
  // Both paths set state from an async callback, so the first client render
  // still matches the server's (empty) one and hydration stays clean.
  const summariesLoaded = useRef(false);
  useEffect(() => {
    if (summariesLoaded.current) return undefined;
    summariesLoaded.current = true;
    let cancelled = false;
    (async () => {
      const res = await fetchPlayerSummaries(available.map((p) => p.ffcPlayerId), config.scoring_format);
      if (!cancelled && res.ok) setSummaries(res.summaries);
    })();
    return () => { cancelled = true; };
  }, [available, config.scoring_format]);

  // --- stat strip: expand a row -> load that player's season ---
  async function toggleExpand(p) {
    const id = p.ffcPlayerId;
    const next = expandedId === id ? null : id;
    setExpandedId(next);
    if (next == null || statsById[id] !== undefined) return;
    setStatsById((m) => ({ ...m, [id]: 'loading' }));
    const res = await fetchPlayerStats(id);
    setStatsById((m) => ({ ...m, [id]: res.ok ? res.stats : null }));
  }

  // Sort keys follow the position filter: stat sorts are only offered once the
  // board is narrowed to a position, because ranking a mixed list by receptions
  // would bury every QB under every WR. ADP/PPG/PTS compare across positions and
  // are always offered. Stat sorts need loaded summaries, so they stay disabled
  // (not hidden) until stats exist - discoverable, and honest about why.
  const sortOpts = useMemo(() => sortsFor(filter), [filter]);
  const statsReady = useMemo(() => Object.keys(summaries).length > 0, [summaries]);
  // Derived, not stored: switching filters can strip the active key out from
  // under the sort, and silently falling back beats a setState-in-effect.
  const activeSort = sortOpts.some((o) => o.key === sort) && (sort === 'adp' || statsReady) ? sort : 'adp';

  // Team options come from the FULL initial pool, not the shrinking `available`
  // set, so the dropdown is a stable 32-team list and a team does not vanish when
  // its last player is drafted.
  const teamOptions = useMemo(() => teamsInPool(initialAvailable), [initialAvailable]);

  const shown = useMemo(() => {
    const list = filterPlayers(available, { position: filter, team, search });
    return sortPlayers(list, sortOpts.find((o) => o.key === activeSort), summaries);
  }, [available, filter, team, search, sortOpts, activeSort, summaries]);

  const rounds = board.rounds;
  return (
    <div className="room">
      {/* PERSISTENT HEADER (all pages): clock banner + AUTO, then last-pick strip */}
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
      {lastLine && (
        <div className="lastline">
          <span className="lp">LAST</span>{lastLine.slot} · TEAM {lastLine.team} · <b>{lastLine.name}</b> <span className="pos">{lastLine.pos}</span>{lastLine.teamAbbr ? ` ${lastLine.teamAbbr}` : ''}
        </div>
      )}

      {/* mobile page tabs: full-width segmented thirds, sync with swipe + jump on
          tap. The PICK segment nudges (never yanks) when it is the user's turn but
          they are looking at another page. */}
      <div className="room-seg">
        {PAGES.map((label, i) => (
          <button
            key={label}
            type="button"
            className={`rseg${page === i ? ' on' : ''}${i === 1 && canPick && page !== 1 ? ' nudge' : ''}`}
            onClick={() => jump(i)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="pager" ref={pagerRef} onScroll={onPagerScroll}>
        {/* BOARD page: full snake grid, all columns fit the viewport width */}
        <section className="page zone pg-board">
          <div className="plabel">The Board · whole draft</div>
          {poolMapping && !poolMapping.exact && (
            <div className="board-note">
              ADP from the {poolMapping.poolTeams}-team {SCORING_LABEL[poolMapping.poolScoring] ?? String(poolMapping.poolScoring).toUpperCase()} market pool
            </div>
          )}
          <BoardGrid board={board} />
        </section>

        {/* PICK page: the available pane, moved wholesale (search / chips / sort / rows) */}
        <section className="page zone pg-pick">
          <div className="plabel">Available · {shown.length}</div>
          <div className="avail-tools">
          <input className="avail-search" placeholder="Search players" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="avail-chips">
            {POS_FILTERS.map((f) => <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f}</button>)}
          </div>
          <div className="avail-team">
            <span className="s-lbl">Team</span>
            <select className="team-select" value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value="ALL">All teams</option>
              {teamOptions.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="avail-sort">
            <span className="s-lbl">Sort</span>
            {sortOpts.map((o) => {
              const locked = o.key !== 'adp' && !statsReady;
              return (
                <button
                  key={o.key}
                  className={activeSort === o.key ? 'on' : ''}
                  disabled={locked}
                  title={locked ? 'Needs season stats, which land with the data backfill' : undefined}
                  onClick={() => setSort(o.key)}
                >
                  {o.label}
                </button>
              );
            })}
            {filter === 'ALL' && <span className="s-hint">Pick a position for stat sorts</span>}
          </div>
        </div>
        <div className="zone-body">
          {err && !err.id && <div className="p-err">{ERR[err.reason] ?? err.reason}</div>}
          {shown.slice(0, 120).map((p) => {
            const val = Math.round(currentOverall - Number(p.adp)); // positive-good: he fell to you
            const open = expandedId === p.ffcPlayerId;
            const stats = statsById[p.ffcPlayerId];
            const slot = displayPosition(p.position);
            const sum = summaries[p.ffcPlayerId];
            // Quick stats sit with the name; the full log is a tap away. K/DST
            // points are partial (no distance tiers / points allowed), so their
            // PPG is marked ~ rather than passed off as league-exact.
            const quick = sum ? viewFor(p.position).quick(sum.totals) : null;
            const approx = sum && !isExactlyScored(slot);
            return (
              <div key={p.ffcPlayerId} className={`p-item${open ? ' open' : ''}`}>
                <div className={`p-row${armedId === p.ffcPlayerId ? ' armed' : ''}`}>
                  <button type="button" className="p-main" onClick={() => toggleExpand(p)} aria-expanded={open}>
                    <span className="ava" data-pos={slot}>{slot}</span>
                    <span className="p-id">
                      <span className="nm">{p.name}</span>
                      <span className="rng">
                        {slot}{p.team ? `·${p.team}` : ''} · {r0(p.adpHigh)}-{r0(p.adpLow)}
                        {quick && <span className="q"> · {quick.join(' · ')}</span>}
                      </span>
                    </span>
                    <span className="p-num">
                      <span className="ppg" title={approx ? 'Partial: kicker distance tiers and defensive points allowed are not in the data' : undefined}>
                        {sum ? `${approx ? '~' : ''}${sum.ppg}` : '-'}
                      </span>
                      <span className="lbl">PPG</span>
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
                {open && <StatStrip stats={stats} scoringFormat={config.scoring_format} />}
              </div>
            );
          })}
          {!isMyTurn && !complete && <div className="p-err" style={{ color: 'var(--muted-dim)' }}>Waiting for AI…</div>}
          </div>
        </section>

        {/* ROSTER page: current lineup-order roster, full page */}
        <section className="page zone pg-roster">
          <div className="plabel">My roster · Seat {userTeamIndex + 1} · {userPicks.length}/{rounds}</div>
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
        </section>
      </div>

      {/* DESKTOP-only right column: pick feed ticker, newest on top (hidden on mobile) */}
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

// Tint class for a board cell — only the four skill positions tint (per the
// mock); K/DST/others stay neutral ink.
const TINTED = new Set(['QB', 'RB', 'WR', 'TE']);
function posClass(pos) { return TINTED.has(pos) ? pos : ''; }

// The BOARD page: the whole snake draft as a teams x rounds grid. All columns fit
// the viewport width (no horizontal scroll) — column count comes from config, so
// a 14/16-team board narrows its cells rather than scrolling. Vertical scroll runs
// through every round. Cells are populated from live pick state.
function BoardGrid({ board }) {
  const { teams, columns, rows } = board;
  return (
    <div className="bg2" style={{ gridTemplateColumns: `22px repeat(${teams}, minmax(0, 1fr))` }}>
      <div className="bh corner" />
      {columns.map((c) => (
        <div key={c.teamIndex} className={`bh${c.isYou ? ' you' : ''}`}>{c.label}</div>
      ))}
      {rows.map((row) => (
        <Fragment key={row.round}>
          <div className="br">{row.round}</div>
          {row.cells.map((cell) => <BoardCell key={cell.overall} cell={cell} />)}
        </Fragment>
      ))}
    </div>
  );
}

function BoardCell({ cell }) {
  if (cell.onClock) {
    return <div className={`bc otc2${cell.mine ? ' mine' : ''}`}><span className="n">CLOCK</span></div>;
  }
  if (!cell.pick) {
    return <div className={`bc empty${cell.mine ? ' mine' : ''}`}><span className="n">·</span></div>;
  }
  const pos = cell.pick.slotPos || cell.pick.position;
  return (
    <div className={`bc ${posClass(pos)}${cell.mine ? ' mine' : ''}`.trim()}>
      <span className="p">{pos}</span>
      <span className="n">{cell.pick.synthetic ? pos : boardName(cell.pick.playerName)}</span>
    </div>
  );
}

// Season totals + game log for an expanded player. `stats` is undefined (not
// asked yet), 'loading', null (unknown - the honest state until the gridiron
// backfill lands), or a SeasonStats object.
function StatStrip({ stats, scoringFormat }) {
  if (stats === undefined || stats === 'loading') return <div className="p-stats loading">Loading season…</div>;
  if (stats === null) {
    return (
      <div className="p-stats empty">
        Season stats land with the data backfill.
      </div>
    );
  }
  // Columns and points both derive from the same structured stat line, so the
  // table and the total cannot disagree about what the player did.
  const view = viewFor(stats.position);
  const summary = seasonSummary(stats.games, scoringFormat);
  const slot = displayPosition(stats.position);
  const exact = isExactlyScored(slot);
  return (
    <div className="p-stats">
      <div className="s-totals">
        <span className="s-season">{stats.season}</span>
        <span className="s-tot s-fpts">
          <b>{summary.points}</b><i>{exact ? 'Fantasy pts' : 'Fantasy pts (partial)'}</i>
        </span>
        <span className="s-tot"><b>{exact ? summary.ppg : `~${summary.ppg}`}</b><i>Per game</i></span>
        {view.totals(stats.totals).map((t) => (
          <span key={t.label} className="s-tot"><b>{t.value}</b><i>{t.label}</i></span>
        ))}
      </div>
      {!exact && (
        <div className="s-note">
          Partial: kicker field goals score a flat 3 (no distance tiers) and defensive
          points allowed are not in the data.
        </div>
      )}
      <div className="s-scroll">
        <table className="s-log">
          <thead>
            <tr><th>WK</th>{view.columns.map((c) => <th key={c}>{c}</th>)}<th>FPTS</th></tr>
          </thead>
          <tbody>
            {stats.games.map((g) => (
              <tr key={g.week}>
                <td className="wk">{g.week}</td>
                <td>{g.opp}</td>
                {view.row(g.stats).map((v, i) => <td key={i}>{v}</td>)}
                <td className="fpts">{fantasyPoints(g.stats, scoringFormat)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
