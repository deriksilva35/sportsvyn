'use client';

// components/sim/TrackerRoom.js — the tracker room, built against the LOCKED mock
// docs/design/draftvyn-tracker-mock-v1.html (three frames: pick entry, board,
// my team + needs).
//
// A SEPARATE COMPONENT, NOT A BRANCH IN DraftRoom. That was the pre-authorised
// fallback and it is the right call here, for reasons that are structural rather
// than stylistic:
//   · Navigation differs. DraftRoom is a scroll-snap swipe pager with dot sync and
//     an instant-scroll workaround; the mock is three bottom tabs.
//   · The board differs. DraftRoom renders buildBoard's teams x rounds snake GRID;
//     the mock is a linear pick list in overall order with seat labels and value
//     chips. buildBoard is simply not the primitive this screen wants.
//   · Four DraftRoom subsystems have no tracker counterpart at all: the advisory
//     timer, the AUTO drive effect, the arm-then-confirm flow, and the expandable
//     per-player stat strip. Two of those (timer, AUTO) are interlocking effects
//     that both gate on `canPick` and are documented as racing each other if that
//     gate is wrong.
// Threading a second mode through that would put the shipping paid sim product at
// risk to save a file. What IS shared is shared as pure modules: filterPlayers,
// buildRoster, the needs math, the seat labels.
//
// STATE: server-returned only, exactly like DraftRoom. logPick/undoLastPick return
// the new truth and we apply it. No client draft simulation, no polling.
//
// ONE-TAP COMMIT: there is no confirm step. UNDO is always on screen and is
// repeatable, which is a better trade at a live table than doubling every tap.

import RoomScope from '@/components/shell/RoomScope';
import HideInShell from '@/components/shell/HideInShell';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { logPick, undoLastPick, fetchPlayerSummaries } from '@/app/actions/sim';
import Wordmark from '@/components/gridiron/Wordmark';
import {
  filterPlayers, displayPosition, rookieIdSet, sortsFor, sortPlayers,
  viewFor, teamsInPool, POS_FILTERS, CLASS_FILTERS, fmt1, signed1,
} from '@/lib/fantasy/statView';
import { isExactlyScored } from '@/lib/fantasy/scoring';
import { computeSeatValuation } from '@/lib/fantasy/seatValuation';
import RookieChip from '@/components/fantasy/RookieChip';
import { buildRoster, BENCH } from '@/lib/fantasy/roster';
import { buildBoard, boardName } from '@/lib/fantasy/board';
import { seatLabel, seatLabelShort, nextUserOverall, picksUntilUserTurn } from '@/lib/fantasy/tracker';
import {
  valueGap, openStarterSlotsByPos, needsObservation, bestAvailableAtMyPick, slotLabel, cappedPositions,
} from '@/lib/fantasy/needs';
import { FFC_ATTRIBUTION } from '@/lib/fantasy/attribution';
import { sendHaptic } from '@/lib/shell/bridge';

const TABS = ['AVAILABLE', 'BOARD', 'MY TEAM'];
// Class filter. Composes with position, same as the sim room.
// The tracker had no sort control at all - the board was always ADP order. Only
// the two cross-position sorts are offered here: stat sorts need loaded season
// summaries, which this room does not fetch.
const ERR = {
  illegal_pick: "That roster can't fit the pick", player_unavailable: 'Already drafted',
  not_in_progress: 'Draft is over', not_tracker: 'Not a tracker draft',
  not_found_or_not_owner: 'Not your draft', unauthenticated: 'Please sign in',
  no_picks: 'Nothing to undo',
};
// Value chip: positive = the player fell past his ADP to this pick.
const shortName = (full) => {
  const parts = String(full ?? '').trim().split(/\s+/);
  return parts.length < 2 ? (parts[0] ?? '') : `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
};

// BOARD view preference. SESSION scope on purpose (sessionStorage, not local):
// a view chosen at one draft table should not silently follow you into the next
// one. LIST is the default and the server snapshot - at a table you are reading
// the last few picks in order, not studying a grid.
//
// A tiny external store rather than component state because sessionStorage has no
// same-tab change event: writes here notify subscribers directly, which is what
// useSyncExternalStore needs to re-render.
const BOARD_VIEW_KEY = 'trk-board-view';
const boardViewStore = {
  listeners: new Set(),
  subscribe(cb) {
    boardViewStore.listeners.add(cb);
    return () => boardViewStore.listeners.delete(cb);
  },
  get() {
    try {
      return window.sessionStorage.getItem(BOARD_VIEW_KEY) === 'grid' ? 'grid' : 'list';
    } catch { return 'list'; } // private mode / storage disabled
  },
  getServer() { return 'list'; },
  set(v) {
    try { window.sessionStorage.setItem(BOARD_VIEW_KEY, v); } catch { /* non-fatal */ }
    boardViewStore.listeners.forEach((l) => l());
  },
};

export default function TrackerRoom({
  draftId, config, order, userTeamIndex, teamLabels,
  initialPicks, initialAvailable, rounds,
}) {
  const router = useRouter();
  const [picks, setPicks] = useState(initialPicks);
  const [available, setAvailable] = useState(initialAvailable);
  const [tab, setTab] = useState(0);
  const [filter, setFilter] = useState('ALL');
  const [cls, setCls] = useState('ALL');
  const [sort, setSort] = useState('adp'); // default stays ADP; My Team is opt-in
  const [team, setTeam] = useState('ALL');
  // Season summaries, the Mock's pattern verbatim: one shot, shared action,
  // stat sorts stay disabled until they land.
  const [summaries, setSummaries] = useState({});
  const summariesLoaded = useRef(false);
  useEffect(() => {
    if (summariesLoaded.current) return undefined;
    summariesLoaded.current = true;
    let cancelled = false;
    (async () => {
      const res = await fetchPlayerSummaries(initialAvailable.map((p) => p.ffcPlayerId), config.scoring_format);
      if (!cancelled && res.ok) setSummaries(res.summaries);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const searchRef = useRef(null);
  // BOARD tab view, read through useSyncExternalStore rather than an effect.
  // sessionStorage IS an external store, and this is the API React provides for
  // one: the server snapshot is always 'list', so SSR and the first client render
  // agree (no hydration mismatch), and no setState happens in an effect body
  // (which the react-hooks/set-state-in-effect rule rightly rejects).
  const boardView = useSyncExternalStore(
    boardViewStore.subscribe, boardViewStore.get, boardViewStore.getServer,
  );
  const chooseBoardView = useCallback((v) => boardViewStore.set(v), []);

  const teams = config.teams_count;
  const total = order.length;
  const currentOverall = picks.length + 1;
  const complete = currentOverall > total;
  const onClockTeamIndex = complete ? null : order[currentOverall - 1];
  const isMySeat = onClockTeamIndex === userTeamIndex;
  const round = complete ? null : Math.ceil(currentOverall / teams);

  // ROOKIE IDS. Same reasoning as the sim room: pick records come back through
  // the engine, which is never told who is a rookie, so the ledger looks players
  // up here. Seeded from the INITIAL props so it survives both directions of
  // movement between the two lists.
  //
  // This is also what keeps UNDO honest. undoLastPick rebuilds the restored row
  // from the removed pick's own columns, which carry no rookie flag - so a
  // rookie put back on the board would silently lose his chip if the list read
  // the flag off the row. It reads it from this set instead, which still holds
  // the id. Pinned by a test.
  const rookieIds = useMemo(
    () => rookieIdSet(initialAvailable, initialPicks),
    [initialAvailable, initialPicks],
  );
  const isRookieId = useCallback((id) => rookieIds.has(id), [rookieIds]);

  const userPicks = useMemo(() => picks.filter((p) => p.isUser), [picks]);
  const roster = useMemo(() => buildRoster(userPicks, config.roster_slots), [userPicks, config.roster_slots]);

  // Filtered board — reuses the sim's own filter so search/position behave
  // identically in both products.

  const last = picks[picks.length - 1] ?? null;

  // ---- needs (MY TEAM frame) ----
  const myNext = complete ? null : nextUserOverall(order, userTeamIndex, currentOverall - 1);

  // MY TEAM valuation - the same computeSeatValuation the sim room uses, so the
  // two products cannot disagree about what a player is worth to a roster.
  const seatValuation = useMemo(() => computeSeatValuation({
    rosterSlots: config.roster_slots,
    rounds,
    allPicks: picks,
    seatPicks: userPicks,
    available,
    myNextOverall: myNext,
    // Round context for the deferral rule - see seatValuation.js.
    currentOverall,
    teamsCount: config.teams_count,
  }), [config.roster_slots, rounds, picks, userPicks, available, myNext,
    currentOverall, config.teams_count]);

  // FULL MOCK PARITY: position-scoped stat sorts ride the position filter,
  // exactly sortsFor's contract - the old two-sort allowlist is retired.
  const sortOpts = useMemo(() => sortsFor(filter), [filter]);
  const statsReady = useMemo(() => Object.keys(summaries).length > 0, [summaries]);
  const teamOptions = useMemo(() => teamsInPool(initialAvailable), [initialAvailable]);
  const activeSort = useMemo(() => {
    const opt = sortOpts.find((o) => o.key === sort);
    if (!opt) return 'adp';
    if (opt.seat) return myNext == null ? 'adp' : sort;
    if (sort !== 'adp' && !statsReady) return 'adp';
    return sort;
  }, [sort, sortOpts, myNext, statsReady]);
  const seatSort = activeSort === 'myteam';

  const shown = useMemo(() => {
    const list = filterPlayers(available, { position: filter, team, search, cls });
    return sortPlayers(list, sortOpts.find((o) => o.key === activeSort), summaries, seatValuation);
  }, [available, filter, search, cls, sortOpts, activeSort, seatValuation, summaries, team]);
  const away = complete ? null : picksUntilUserTurn(order, userTeamIndex, currentOverall);
  const openSlots = useMemo(() => openStarterSlotsByPos(roster), [roster]);
  const observation = useMemo(
    () => needsObservation({ openSlots, recentPicks: picks }),
    [openSlots, picks],
  );
  const bestAtMine = useMemo(
    () => bestAvailableAtMyPick(available, myNext, 2, { capped: cappedPositions(config.roster_slots, userPicks) }),
    [available, myNext],
  );

  // ---- commit ----
  const commit = useCallback(async (player) => {
    if (busy || complete) return;
    setBusy(true); setErr(null);
    sendHaptic('heavy'); // the committing action
    // try/finally, not a bare await: `busy` disables every DRAFT button, so a
    // THROWN action would strand this room exactly the way a rejection stranded
    // the sim room - buttons gone, nothing to tap to recover. Rejections already
    // cleared it; this closes the other half.
    try {
      const res = await logPick(draftId, player.ffcPlayerId);
      if (!res.ok) { setErr(res.reason); return; }
      setAvailable((av) => av.filter((p) => p.ffcPlayerId !== res.pick.ffcPlayerId));
      setPicks((ps) => [...ps, { ...res.pick, isUser: res.isOwnSeat }]);
      setSearch(''); // clear for the next entry; the field keeps focus
      if (res.status === 'completed') router.refresh(); // server re-renders as results
    } catch {
      setErr('network');
    } finally {
      setBusy(false);
    }
  }, [busy, complete, draftId, router]);

  const undo = useCallback(async () => {
    if (busy || picks.length === 0) return;
    setBusy(true); setErr(null);
    sendHaptic('notify');
    try {
      const res = await undoLastPick(draftId);
      if (!res.ok) { setErr(res.reason); return; }
      // Put the player back on the board. The row is rebuilt from the removed
      // pick rather than refetched: the pool is immutable for the life of a
      // draft, so the fields the list renders are all carried on the pick.
      const back = {
        ffcPlayerId: res.undone.ffcPlayerId, name: res.undone.playerName,
        position: res.undone.position, team: undoneTeamOf(picks, res.undone.ffcPlayerId),
        adp: undoneAdpOf(picks, res.undone.ffcPlayerId),
      };
      setPicks((ps) => ps.filter((p) => p.overallPick !== res.undone.overallPick));
      setAvailable((av) => [...av, back].sort((a, b) => Number(a.adp) - Number(b.adp)));
    } catch {
      setErr('network');
    } finally {
      setBusy(false);
    }
  }, [busy, picks, draftId]);

  // Enter commits the TOP row — the one the list highlights in volt. Guarded on
  // the list being non-empty so an Enter on a no-match query does nothing rather
  // than committing whatever was previously top.
  const onSearchKeyDown = useCallback((e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (shown.length > 0) commit(shown[0]);
  }, [shown, commit]);

  const seat = (i) => seatLabel(teamLabels, i, userTeamIndex);

  return (
    <div className="trk">
      {/* A ROOM ENTERED FROM THE TRACKER TAB BELONGS TO THE TRACKER TAB. The
          route is shared with the practice sim, so the path cannot say so - and
          without this, starting a tracker room lit PRACTICE. No `timed`: a
          tracker draft has no clock and must keep its way out. */}
      <RoomScope tab="tracker" />
      <div className="trk-in">
        <header className="trk-hd">
          {/* THE LAST SPORTSVYN MARK IN THE CONTAINER. The tracker room draws
              its own header per the locked mock, and it was showing the
              publication's wordmark inside an app called Draftvyn. The app
              header above supplies the mark in the shell; on the web this room
              keeps its own, because there is no app header there. */}
          <HideInShell><Wordmark href="/sim" /></HideInShell>
          {/* THE WAY BACK OUT, and the reason the tab is allowed to bring you
              straight in. The rules, the setup and the history live on the
              tracker home; without this the room would be the trapdoor the
              resume card was trying to avoid. END TRACKING is still the only
              exit that FORGETS the room - this one just leaves it running. */}
          <a className="appcrumb trk-crumb" href="/sim/tracker?home=1">&larr; Tracker home</a>
          <span className="mode">TRACKER</span>
          <span className="meta">
            {complete ? `COMPLETE · ${total} PICKS` : `RD ${round} · PICK ${currentOverall}/${total}`}
          </span>
        </header>

        {/* ---- on the clock (all three frames carry it except BOARD's variant) ---- */}
        {tab !== 1 && (
          <section className="trk-otc">
            <div className="trk-otc-row">
              <div>
                <div className="trk-k">{complete ? 'DRAFT COMPLETE' : 'ON THE CLOCK'}</div>
                <div className={`trk-who${isMySeat ? ' me' : ''}`}>
                  {complete ? 'ALL PICKS IN' : seat(onClockTeamIndex)}
                  {!complete && (
                    <span className="pick">{slotLabel(currentOverall, teams)} · PICK {currentOverall}</span>
                  )}
                </div>
              </div>
              <button className="trk-undo" onClick={undo} disabled={busy || picks.length === 0}>
                <b>↩</b> {picks.length ? `UNDO ${picks.length}` : 'UNDO'}
              </button>
            </div>
            {last && (
              <div className="trk-lastpick">
                {last.overallPick} · {seatLabelShort(teamLabels, order[last.overallPick - 1], userTeamIndex).toUpperCase()} took{' '}
                <b>{shortName(last.playerName)}</b> {last.slotPos}
                {last.adpAtPick != null && ` · ADP ${Number(last.adpAtPick).toFixed(1)}`}
              </div>
            )}
          </section>
        )}

        {err && <div className="trk-err">{ERR[err] ?? err}</div>}

        {/* ================= FRAME 1 · AVAILABLE ================= */}
        {tab === 0 && (
          <>
            <div className="trk-search">
              <span className="q" aria-hidden="true">⌕</span>
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={onSearchKeyDown}
                placeholder="Type a name…"
                enterKeyHint="done"
                autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false"
                aria-label="Search available players"
              />
              <span className="trk-hint">↵ TOP</span>
            </div>
            <div className="trk-pos">
              {POS_FILTERS.map((p) => (
                <button key={p} className={p === filter ? 'on' : ''} onClick={() => setFilter(p)}>{p}</button>
              ))}
            </div>
            <div className="trk-pos trk-class">
              {CLASS_FILTERS.map(([k, label]) => (
                <button key={k} className={k === cls ? 'on' : ''} onClick={() => setCls(k)}>{label}</button>
              ))}
            </div>
            {/* Team filter - the Mock's filter stack, completed. */}
            <div className="trk-pos trk-team">
              <span className="trk-sortlbl">Team</span>
              <select className="trk-teamsel" value={team} onChange={(e) => setTeam(e.target.value)}>
                <option value="ALL">All teams</option>
                {teamOptions.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            {/* Sort. New control in this room - the tracker board was always ADP
                order. My Team is disabled rather than hidden once the seat has
                no pick left: the reason it cannot run is worth saying. */}
            <div className="trk-pos trk-sort">
              <span className="trk-sortlbl">Sort</span>
              {sortOpts.map((o) => {
                const locked = o.seat ? myNext == null : (o.key !== 'adp' && !statsReady);
                return (
                  <button
                    key={o.key}
                    className={activeSort === o.key ? 'on' : ''}
                    disabled={locked}
                    title={locked
                      ? (o.seat ? 'Opens once you have another pick coming' : 'Needs season stats, which land with the data backfill')
                      : undefined}
                    onClick={() => setSort(o.key)}
                  >{o.label}</button>
                );
              })}
              {filter === 'ALL' && <span className="s-hint">Pick a position for stat sorts</span>}
            </div>
            <div className="trk-avail">
              {shown.length === 0 && <div className="trk-empty">No player matches that.</div>}
              {shown.slice(0, 60).map((p, i) => {
                const pos = displayPosition(p.position);
                const seatRead = seatValuation.get(p.ffcPlayerId) ?? null;
                const sum = summaries[p.ffcPlayerId];
                // The Mock's quick line + columns, through the SAME shared
                // formatter (viewFor().quick) and the same ~ rule for K/DST.
                const quick = sum ? viewFor(p.position).quick(sum.totals) : null;
                const approx = sum && !isExactlyScored(pos);
                const valNum = valueGap(currentOverall, p.adp); // canonical form - inline arithmetic forbidden by test
                return (
                  <div key={p.ffcPlayerId} className={`trk-p${i === 0 ? ' top' : ''}`}>
                    <span className="nrail">{Number(p.adp).toFixed(1)}</span>
                    <div className="ncell">
                      <div className="nm">{p.name}<RookieChip rookie={isRookieId(p.ffcPlayerId)} /></div>
                      {/* Tag line: position/team + stat line ONLY. The VAL
                          column owns the gap number - one number, one home. */}
                      <div className="tag">
                        {pos}{p.team ? ` ${p.team}` : ''}
                        {quick && <span className="trk-quick"> · {quick.join(' · ')}</span>}
                        {/* Two facts, never the composite - see seatValuation.js. */}
                        {seatSort && seatRead && (
                          <>
                            {seatRead.gap != null && (
                              <span className={`trk-gap ${seatRead.gap > 0 ? 'val' : 'rch'}`}>
                                {' '}{seatRead.gap > 0 ? '+' : ''}{seatRead.gap} AT {myNext}
                              </span>
                            )}
                            {/* Deferred keeps the tag, loses the emphasis. */}
                            <span className={`trk-slotstate ${seatRead.slot}${seatRead.deferred || seatRead.streamer ? ' deferred' : ''}`}>
                              {' '}{pos} · {seatRead.slot}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    {/* The shared column grid (numcols.css): fixed ch widths,
                        one decimal, ADP an integer by design - it is a rank. */}
                    <span className="ncols">
                      <span className="ncol"><span className={`v${sum ? '' : ' empty'}`}>{sum ? `${approx ? '~' : ''}${fmt1(sum.ppg)}` : '-'}</span><span className="lbl">PPG</span></span>
                      <span className="ncol"><span className="v dim">{Math.round(Number(p.adp))}</span><span className="lbl">ADP</span></span>
                      <span className="ncol"><span className={`v ${valNum >= 0 ? 'pos' : 'neg'}`}>{signed1(valNum)}</span><span className="lbl">VAL</span></span>
                    </span>
                    <button className="go" onClick={() => commit(p)} disabled={busy || complete}>DRAFT</button>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ================= FRAME 2 · BOARD ================= */}
        {tab === 1 && (
          <>
            <section className="trk-otc trk-otc--board">
              {/* Snake direction: odd rounds run left to right, even rounds right
                  to left. Stated explicitly because at a live table the direction
                  is the thing people lose track of. */}
              <div className="trk-k">
                {complete ? `COMPLETE · ${total} PICKS` : `ROUND ${round} · SNAKE ${round % 2 === 1 ? '→' : '←'}`}
              </div>
              <div className="trk-viewtog" role="group" aria-label="Board view">
                {['list', 'grid'].map((v) => (
                  <button
                    key={v}
                    className={boardView === v ? 'on' : ''}
                    onClick={() => chooseBoardView(v)}
                    aria-pressed={boardView === v}
                  >{v.toUpperCase()}</button>
                ))}
              </div>
            </section>
            {boardView === 'list' ? (
              <BoardList
                picks={picks} order={order} teams={teams} rounds={rounds}
                teamLabels={teamLabels} userTeamIndex={userTeamIndex}
                currentOverall={complete ? null : currentOverall}
                rookieIds={rookieIds}
              />
            ) : (
              <BoardGrid
                config={config} picks={picks} teamLabels={teamLabels}
                userTeamIndex={userTeamIndex}
                currentOverall={complete ? null : currentOverall}
              />
            )}
          </>
        )}

        {/* ================= FRAME 3 · MY TEAM + NEEDS ================= */}
        {tab === 2 && (
          <>
            <section className="trk-need">
              <div className="trk-k">
                {myNext == null
                  ? 'NO PICKS LEFT'
                  : `YOUR NEXT PICK · ${slotLabel(myNext, teams)} (PICK ${myNext}) · ${away === 0 ? 'NOW' : `${away} AWAY`}`}
              </div>
              <div className="line">
                {observation.squeeze
                  ? <>{observation.text.split(observation.squeeze)[0]}<b>{observation.squeeze}</b>{observation.text.split(observation.squeeze).slice(1).join(observation.squeeze)}</>
                  : observation.text}
              </div>
              {bestAtMine.length > 0 && (
                <>
                  <div className="trk-k" style={{ marginTop: 12 }}>BEST AVAILABLE AT YOUR TURN</div>
                  {bestAtMine.map((b) => (
                    <div className="trk-ba" key={b.ffcPlayerId}>
                      <span className="nm">{b.name}<RookieChip rookie={isRookieId(b.ffcPlayerId)} /></span>
                      <span className="tag">{displayPosition(b.position)}{b.team ? ` ${b.team}` : ''} · ADP {b.adp.toFixed(1)}</span>
                      <span className={`gap${b.likelyGone ? ' gone' : ''}`}>
                        {b.gap > 0 ? '+' : ''}{b.gap} AT {myNext}
                      </span>
                    </div>
                  ))}
                </>
              )}
            </section>

            <div className="trk-sec">
              ROSTER · {config.name ?? 'CUSTOM'}
              <span className="r">{userPicks.length} OF {rounds}</span>
            </div>
            {roster.map((s, i) => (
              <div key={`${s.label}-${i}`} className={`trk-slot${s.pick ? '' : ' open'}`}>
                <span className="pos-t">{s.key === BENCH ? s.label : s.key}</span>
                <span className="nm">{s.pick ? s.pick.playerName : 'open'}{s.pick && <RookieChip rookie={isRookieId(s.pick.ffcPlayerId)} />}</span>
                {s.pick && <span className="rdd">RD {s.pick.round}</span>}
              </div>
            ))}

            <div className="trk-fine">
              Value shown is pick number vs live ADP - an observation, not a verdict.{' '}
              {FFC_ATTRIBUTION.text} <a href={FFC_ATTRIBUTION.url} target="_blank" rel="noopener noreferrer">{FFC_ATTRIBUTION.host}</a>.
            </div>
          </>
        )}
      </div>

      <nav className="trk-tabs">
        {TABS.map((t, i) => (
          <button key={t} className={i === tab ? 'on' : ''} onClick={() => setTab(i)}>{t}</button>
        ))}
      </nav>
    </div>
  );
}

// The board: a linear pick list newest-round-first, per the mock. Only rounds that
// have started (plus the one in progress) are rendered — an unstarted round is a
// list of dashes and tells a live drafter nothing.
// BOARD LIST. Every value it renders arrives as a PROP - including rookieIds.
//
// It is declared at module scope, so it can see nothing inside TrackerRoom. An
// earlier version called isRookieId() here, a useCallback declared inside the
// component: that is a ReferenceError the moment any real pick renders, and it
// took the whole board down in production. `no-undef` is now enabled repo-wide
// (eslint.config.mjs) so the same reach cannot be committed again.
//
// The Set is defaulted rather than required: a board that renders with no chips
// is correct-looking and harmless, whereas an undefined lookup is another crash.
const NO_ROOKIES = new Set();

function BoardList({
  picks, order, teams, rounds, teamLabels, userTeamIndex, currentOverall,
  rookieIds = NO_ROOKIES,
}) {
  const byOverall = new Map(picks.map((p) => [p.overallPick, p]));
  const lastRound = currentOverall == null ? rounds : Math.ceil(currentOverall / teams);
  const out = [];
  for (let r = lastRound; r >= 1; r--) {
    const start = (r - 1) * teams + 1;
    const rows = [];
    for (let o = start; o < start + teams; o++) {
      if (o > order.length) break;
      // ONE BAD ROW MUST NOT TAKE THE BOARD DOWN.
      //
      // This is absence over inference applied to rendering: a row we cannot
      // draw shows a dash, the same marker a missing value gets everywhere else,
      // and the other eleven picks in the round still draw. Before this, a single
      // unrenderable row threw out of the whole component and the reader got a
      // 500 for the entire board - which is exactly what happened in production.
      //
      // Scope, honestly: try/catch here catches throws while BUILDING the row -
      // a bad field access, a helper that rejects a shape. It does NOT catch a
      // throw inside a child component's own render, which only an error
      // boundary can. It covers the class that actually bit us.
      try {
        rows.push(buildBoardRow({
          o, byOverall, currentOverall, order, userTeamIndex, teamLabels, rookieIds,
        }));
      } catch {
        rows.push(<UnrenderableRow key={o} overall={o} />);
      }
    }
    out.push(
      <div key={`r${r}`}>
        <div className="trk-rd">ROUND {r}{r < lastRound ? ` · ${teams} PICKS` : ''}</div>
        {rows}
      </div>,
    );
  }
  return <>{out}</>;
}

// A row that could not be drawn. It states that plainly rather than rendering a
// blank: a silent gap reads as "nobody picked here", which is a different and
// wrong claim. The pick number is still shown, because that much is always known.
function UnrenderableRow({ overall }) {
  return (
    <div className="trk-b">
      <span className="n">{overall}</span>
      <span className="team">—</span>
      <div><span className="nm pending">—</span></div>
    </div>
  );
}

function buildBoardRow({ o, byOverall, currentOverall, order, userTeamIndex, teamLabels, rookieIds }) {
  {
      const pick = byOverall.get(o) ?? null;
      const onClock = currentOverall === o;
      const teamIndex = order[o - 1];
      const mine = teamIndex === userTeamIndex;
      const gap = pick ? valueGap(pick.overallPick, pick.adpAtPick) : null;
      const vCls = gap == null ? 'even' : (gap > 1 ? 'val' : (gap < -1 ? 'rch' : 'even'));
      return (
        <div className={`trk-b${onClock ? ' now' : ''}`} key={o}>
          <span className="n">{o}</span>
          <span className={`team${mine ? ' me' : ''}`}>
            {seatLabelShort(teamLabels, teamIndex, userTeamIndex).toUpperCase()}
          </span>
          <div>
            {pick ? (
              <>
                <span className="nm">{pick.synthetic ? `Replacement ${pick.slotPos}` : shortName(pick.playerName)}{!pick.synthetic && <RookieChip rookie={rookieIds.has(pick.ffcPlayerId)} />}</span>{' '}
                <span className="pt">{pick.slotPos}{pick.team ? ` ${pick.team}` : ''}</span>
              </>
            ) : onClock ? (
              <><span className="nm">on the clock</span> <span className="dot">●</span></>
            ) : (
              <span className="nm pending">—</span>
            )}
          </div>
          {pick && gap != null && (
            <span className={`v ${vCls}`}>{gap > 0 ? '+' : ''}{gap}</span>
          )}
        </div>
      );
  }
}

// GRID view: the full teams x rounds snake board, reusing the sim's own
// buildBoard so the snake geometry has ONE definition across both products.
// Seat labels become the column headers (at a live table the columns are people),
// except your own, which stays YOU - see the note in board.js.
//
// Horizontal scroll at phone width with the same right-edge fade the preset rail
// uses: a 12-team board cannot fit 390px, and a fade says "more columns" where a
// hard edge reads as clipped.
function BoardGrid({ config, picks, teamLabels, userTeamIndex, currentOverall }) {
  const board = buildBoard(config, picks, { userTeamIndex, currentOverall, seatLabels: teamLabels });
  return (
    <div className="trk-grid-wrap">
      <div className="trk-grid" style={{ '--cols': board.teams }}>
        <div className="trk-grid-row trk-grid-head">
          <span className="rd" />
          {board.columns.map((c) => (
            <span key={c.teamIndex} className={`hd${c.isYou ? ' me' : ''}`} title={c.label}>{c.label}</span>
          ))}
        </div>
        {board.rows.map((r) => (
          <div className="trk-grid-row" key={r.round}>
            {/* Snake direction per row, so the eye follows the order of play. */}
            <span className="rd">{r.round}<i>{r.round % 2 === 1 ? '→' : '←'}</i></span>
            {r.cells.map((cell) => (
              <span
                key={cell.overall}
                className={`cell${cell.mine ? ' mine' : ''}${cell.onClock ? ' now' : ''}${cell.empty ? ' empty' : ''}`}
              >
                {cell.pick ? (
                  <>
                    <b>{cell.pick.synthetic ? cell.pick.slotPos : boardName(cell.pick.playerName)}</b>
                    <i>{cell.pick.slotPos ?? cell.pick.position}</i>
                  </>
                ) : cell.onClock ? <b className="dot">●</b> : null}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// The removed pick's pool fields, recovered from the pick row we already hold.
// The provenance pool is frozen for the life of a draft, so these are the same
// values the list rendered before the pick was made.
function undoneTeamOf(picks, ffcPlayerId) {
  return picks.find((p) => p.ffcPlayerId === ffcPlayerId)?.team ?? null;
}
function undoneAdpOf(picks, ffcPlayerId) {
  return picks.find((p) => p.ffcPlayerId === ffcPlayerId)?.adpAtPick ?? 0;
}
