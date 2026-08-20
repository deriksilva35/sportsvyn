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

// THE APP TAB BAR HIDES HERE ONLY WHEN THERE IS A CLOCK TO PROTECT.
// timerSeconds is null for an untimed mock, and an untimed mock has nothing to
// protect - so it keeps the bar like any other screen. The ranked room's 30s
// clock, and any timed practice mock, raise the flag. See lib/shell/appTabs.js
// for why this moved off the route: the tracker room shares this URL and has no
// clock at all.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { makePick, timerAutoPick, setAutoDraft, fetchPlayerStats, fetchPlayerSummaries } from '@/app/actions/sim';
import { SCORING_LABEL } from '@/lib/fantasy/config';
import RoomScope from '@/components/shell/RoomScope';
import {
  viewFor, sortsFor, sortPlayers, displayPosition, teamsInPool, filterPlayers, rookieIdSet,
  POS_FILTERS, CLASS_FILTERS, fmt1, signed1,
} from '@/lib/fantasy/statView';
import { computeSeatValuation } from '@/lib/fantasy/seatValuation';
import { valueGap } from '@/lib/fantasy/needs';
import { flagsAfterResult, flagsAfterArm } from '@/lib/fantasy/roomFlags';
import { nextUserOverall } from '@/lib/fantasy/tracker';
import { seasonSummary, fantasyPoints, isExactlyScored } from '@/lib/fantasy/scoring';
import { buildRoster, BENCH } from '@/lib/fantasy/roster';
import { buildBoard, boardName } from '@/lib/fantasy/board';
import { sendHaptic } from '@/lib/shell/bridge';
import RookieChip from '@/components/fantasy/RookieChip';

const PAGES = ['BOARD', 'PICK', 'ROSTER']; // swipe pager order; PICK is the default landing

// One sentence, stated as the consequence rather than the mechanism. "Enable
// auto-draft?" describes a setting; this describes what happens to the draft
// the person is currently in. Hyphens only.
export const AUTO_CONFIRM = 'Let the room make your picks? Auto Draft fills every remaining round for you.';

// Class filter. Composes with position and team rather than replacing them.
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
  const [cls, setCls] = useState('ALL');
  const [team, setTeam] = useState('ALL');
  const [sort, setSort] = useState('adp');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1); // swipe pager index: 0 BOARD / 1 PICK / 2 ROSTER
  const [view, setView] = useState('list'); // desktop (>900) only: 'list' 3-col | 'board' full-width snake grid
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
  // ROOKIE IDS, resolved once from what the server sent.
  //
  // The pick records that come back mid-draft do NOT carry the flag: they are
  // built by the draft engine, which is deliberately never told which players
  // are rookies. So the ledger and the feed look the player up here instead.
  // Seeding from initialAvailable UNION initialPicks covers both cases - a
  // player drafted during this session was in `available` when the page loaded,
  // and one drafted before it arrives on `initialPicks` already flagged by the
  // server. Built from the INITIAL props, not from `available`, because that
  // list shrinks as players come off the board.
  const rookieIds = useMemo(
    () => rookieIdSet(initialAvailable, initialPicks),
    [initialAvailable, initialPicks],
  );
  const isRookiePick = useCallback((pk) => !pk.synthetic && rookieIds.has(pk.ffcPlayerId), [rookieIds]);

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
    // A REJECTION MUST HAND THE ROOM BACK. `revealing` feeds isMyTurn, so
    // returning early without lowering it told the room it was somebody else's
    // turn: the banner switched to third person about the user's own seat, every
    // Draft button vanished, and the error banner became undismissable because
    // dismissing it required arming a row whose button had just gone. Only a
    // force-quit cleared it. flagsAfterResult owns the contract now.
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
      await delay(pk.isUser ? 0 : 220); // user pick instant; AI picks reveal one by one
    }
    setRevealing(false);
    setClock(timerSeconds ?? null);
    if (res.status === 'completed') router.refresh(); // server re-renders as results
  }, [router, timerSeconds]);

  async function confirm(player) {
    sendHaptic('heavy'); // confirm pick - the committing action (no-op off-shell)
    setRevealing(true);
    try {
      await applyResult(await makePick(draftId, player.ffcPlayerId));
    } catch {
      // A THROWN action wedges exactly like a rejection used to: revealing was
      // raised before the await, so a dropped connection would strand the room
      // in the same not-your-turn state. The finally is what makes that
      // impossible rather than unlikely.
      const f = flagsAfterResult({ ok: false, reason: 'network' });
      setErr(f.err); setArmedId(f.armedId);
    } finally {
      setRevealing(false);
    }
  }

  // --- AUTO DRAFT toggle ---
  // ON: persist, then the effect below drives the user's turns through the
  // existing engine path (including the current pick if the clock is running).
  // OFF: the effect stops firing, so control returns on the next turn.
  //
  // TURNING IT ON ASKS FIRST; TURNING IT OFF DOES NOT. There was no
  // confirmation at all, and the control has just been made louder - volt fill,
  // the full words AUTO DRAFT - so a curious tap now hands the whole seat to
  // the engine in one press. That is not a small action: the room drafts every
  // remaining round for you, and what comes out is a completed draft nobody
  // made a choice in. Turning it back OFF is the opposite - it returns control,
  // costs nothing, and must stay a single tap.
  async function toggleAuto() {
    const next = !auto;
    if (next && !window.confirm(AUTO_CONFIRM)) return;
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
  // MY TEAM valuation. Recomputed whenever picks or the board change, which is
  // once per pick - both inputs move together. ~200 available x one needWeight
  // each, and needWeight is O(1) plus a slice of the last RUN_WINDOW picks, so
  // this is a sub-millisecond pass; measured, see the commit.
  //
  // myNextOverall is derived here rather than threaded from the server because
  // it changes on every pick, and the server value would be a snapshot from page
  // load. Null once the seat has no picks left - the sort then has nothing to
  // say and every value is null, which sorts as ADP.
  const myNextOverall = useMemo(
    () => nextUserOverall(order, userTeamIndex, picks.length),
    [order, userTeamIndex, picks.length],
  );
  const seatValuation = useMemo(() => computeSeatValuation({
    rosterSlots: config.roster_slots,
    rounds: board.rounds,
    allPicks: picks,
    seatPicks: userPicks,
    available,
    myNextOverall,
    // Round context for the deferral rule: a position's open slot waits until
    // the market says its turn has come. See seatValuation.js.
    currentOverall,
    teamsCount: config.teams_count,
  }), [config.roster_slots, board.rounds, picks, userPicks, available, myNextOverall,
    currentOverall, config.teams_count]);

  const activeSort = (() => {
    const opt = sortOpts.find((o) => o.key === sort);
    if (!opt) return 'adp';
    if (opt.seat) return myNextOverall == null ? 'adp' : sort;
    return sort === 'adp' || statsReady ? sort : 'adp';
  })();

  // Team options come from the FULL initial pool, not the shrinking `available`
  // set, so the dropdown is a stable 32-team list and a team does not vanish when
  // its last player is drafted.
  const teamOptions = useMemo(() => teamsInPool(initialAvailable), [initialAvailable]);

  // Whether the two seat facts are on screen. They ride with the sort that used
  // them: showing a roster read while the board is ordered by ADP would imply a
  // relationship the order does not have.
  const seatSort = activeSort === 'myteam';

  const shown = useMemo(() => {
    const list = filterPlayers(available, { position: filter, team, search, cls });
    return sortPlayers(list, sortOpts.find((o) => o.key === activeSort), summaries, seatValuation);
  }, [available, filter, team, search, cls, sortOpts, activeSort, summaries, seatValuation]);

  const rounds = board.rounds;
  return (
    <div className={`room${view === 'board' ? ' room--board' : ''}`}>
      {/* THIS IS THE PRACTICE SECTION, and it owns the screen only when a clock
          is running. An untimed mock keeps the tab bar - there is nothing to
          protect - and the tracker room, which shares this route, declares
          itself differently. */}
      <RoomScope tab="practice" timed={timerSeconds != null} />
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
        {/* desktop-only LIST/BOARD view toggle (mobile uses the swipe pager instead) */}
        <div className="room-view" role="group" aria-label="Room view">
          <button type="button" className={`rseg${view === 'list' ? ' on' : ''}`} onClick={() => setView('list')} aria-pressed={view === 'list'}>List</button>
          <button type="button" className={`rseg${view === 'board' ? ' on' : ''}`} onClick={() => setView('board')} aria-pressed={view === 'board'}>Board</button>
        </div>
        {!complete && (
          <button
            type="button"
            className={`auto-toggle${auto ? ' on' : ''}`}
            onClick={toggleAuto}
            aria-pressed={auto}
            title={auto ? 'Auto-draft is making your picks' : 'Let the draft engine make your picks'}
          >
            <span className="sw" />Auto Draft
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
          <div className="avail-chips avail-class">
            {CLASS_FILTERS.map(([k, label]) => (
              <button key={k} className={cls === k ? 'on' : ''} onClick={() => setCls(k)}>{label}</button>
            ))}
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
              // My Team needs a next pick, not season stats. Gating it on
              // statsReady would disable it for the whole of a live draft.
              const locked = o.seat ? myNextOverall == null : (o.key !== 'adp' && !statsReady);
              return (
                <button
                  key={o.key}
                  className={activeSort === o.key ? 'on' : ''}
                  disabled={locked}
                  title={locked
                    ? (o.seat ? 'Opens once you have another pick coming' : 'Needs season stats, which land with the data backfill')
                    : undefined}
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
            const val = valueGap(currentOverall, p.adp); // positive-good: he fell to you - canonical form, inline arithmetic forbidden by test
            const open = expandedId === p.ffcPlayerId;
            const stats = statsById[p.ffcPlayerId];
            const slot = displayPosition(p.position);
            const sum = summaries[p.ffcPlayerId];
            // Quick stats sit with the name; the full log is a tap away. K/DST
            // points are partial (no distance tiers / points allowed), so their
            // PPG is marked ~ rather than passed off as league-exact.
            const quick = sum ? viewFor(p.position).quick(sum.totals) : null;
            const seatRead = seatValuation.get(p.ffcPlayerId) ?? null;
            const approx = sum && !isExactlyScored(slot);
            return (
              <div key={p.ffcPlayerId} className={`p-item${open ? ' open' : ''}`}>
                <div className={`p-row${armedId === p.ffcPlayerId ? ' armed' : ''}`}>
                  <button type="button" className="p-main" onClick={() => toggleExpand(p)} aria-expanded={open}>
                    <span className="ava" data-pos={slot}>{slot}</span>
                    <span className="p-id">
                      <span className="nm">{p.name}<RookieChip rookie={p.rookie} /></span>
                      <span className="rng">
                        {slot}{p.team ? `·${p.team}` : ''} · {r0(p.adpHigh)}-{r0(p.adpLow)}
                        {quick && <span className="q"> · {quick.join(' · ')}</span>}
                        {/* MY TEAM sort shows the TWO FACTS behind the order and
                            never the composite that produced it: the market gap
                            at your next pick, and how your roster can absorb the
                            position right now. The score stays in the
                            comparator - printing it would be handing back a
                            number we invented on the reader's behalf. */}
                        {seatSort && seatRead && (
                          <>
                            {seatRead.gap != null && (
                              <span className={`p-seatgap ${seatRead.gap > 0 ? 'val' : 'rch'}`}>
                                {' · '}{seatRead.gap > 0 ? '+' : ''}{seatRead.gap} at {myNextOverall}
                              </span>
                            )}
                            {/* A deferred row keeps its 'open' tag - the slot IS
                                open - but renders muted, so a defense sitting
                                below a flex-eligible WR reads as intended rather
                                than as a bug. */}
                            <span className={`p-seatslot ${seatRead.slot}${seatRead.deferred || seatRead.streamer ? ' deferred' : ''}`}>
                              {' · '}{slot} · {seatRead.slot}
                            </span>
                          </>
                        )}
                      </span>
                    </span>
                    {/* The shared column grid (numcols.css): fixed ch widths,
                        one decimal, ADP an integer by design - it is a rank. */}
                    <span className="ncols">
                      <span className="ncol">
                        <span className={`v${sum ? '' : ' empty'}`} title={approx ? 'Partial: kicker distance tiers and defensive points allowed are not in the data' : undefined}>
                          {sum ? `${approx ? '~' : ''}${fmt1(sum.ppg)}` : '-'}
                        </span>
                        <span className="lbl">PPG</span>
                      </span>
                      <span className="ncol">
                        <span className="v dim">{r0(p.adp)}</span>
                        <span className="lbl">ADP</span>
                      </span>
                      <span className="ncol">
                        <span className={`v ${val >= 0 ? 'pos' : 'neg'}`}>{signed1(val)}</span>
                        <span className="lbl">VAL</span>
                      </span>
                    </span>
                  </button>
                  {canPick && (armedId === p.ffcPlayerId
                    ? <span className="p-act"><button className="confirm" onClick={() => confirm(p)}>Confirm</button><button className="cancel" onClick={() => { setArmedId(null); setErr(null); }}>✕</button></span>
                    : <button className="draft" onClick={() => {
                      const f = flagsAfterArm(p.ffcPlayerId);
                      setArmedId(f.armedId); setErr(f.err); sendHaptic('light');
                    }}>Draft</button>)}
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
                  ? <><span className="nm">{s.pick.synthetic ? `Replacement ${s.pick.slotPos}` : s.pick.playerName}<RookieChip rookie={isRookiePick(s.pick)} /></span> {s.pick.team && <span className="tm">{s.pick.team}</span>}</>
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
              <span><span className="nm">{pk.synthetic ? `Replacement ${pk.slotPos}` : pk.playerName}<RookieChip rookie={isRookiePick(pk)} /></span> <span className="pt">{pk.slotPos}{pk.team ? `·${pk.team}` : ''}</span></span>
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

// One cell, two sizes. The `.pk` overall-pick number and the fuller last name
// are always in the DOM; CSS reveals + enlarges them only in the desktop BOARD
// view (.room--board), and keeps the mobile pager cells compact. boardName's
// generous cap lets desktop show the full last name while the mobile cell's
// nowrap+ellipsis trims it to fit: one renderer, size handled in CSS.
function BoardCell({ cell }) {
  if (cell.onClock) {
    return <div className={`bc otc2${cell.mine ? ' mine' : ''}`}><span className="pk">{cell.overall}</span><span className="n">CLOCK</span></div>;
  }
  if (!cell.pick) {
    return <div className={`bc empty${cell.mine ? ' mine' : ''}`}><span className="pk">{cell.overall}</span><span className="n">·</span></div>;
  }
  const pos = cell.pick.slotPos || cell.pick.position;
  return (
    <div className={`bc ${posClass(pos)}${cell.mine ? ' mine' : ''}`.trim()}>
      <span className="pk">{cell.overall}</span>
      <span className="p">{pos}</span>
      <span className="n">{cell.pick.synthetic ? pos : boardName(cell.pick.playerName, 14)}</span>
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
