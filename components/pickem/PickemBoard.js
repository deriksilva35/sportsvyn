'use client';

// components/pickem/PickemBoard.js - the LIVING board (mock frames 1+2,
// merged per the per-game-lock ruling): un-kicked games are tappable side
// pairs, kicked games are sealed rows grading in, one page all Saturday.
//
// The client clock here is DISPLAY ONLY - it decides what looks tappable and
// what the countdown reads. The save's authority is the server's clock
// against the snapshot kickoff (lib/pickem/entry); a stale client that taps
// a just-kicked game gets 'game_locked' back and the row seals itself.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { spreadParts } from '@/lib/standings/view';
import { isPreGame } from '@/lib/gridiron/oddsFormat';
import { recordLine } from '@/lib/pickem/recordLine';
import { savePickAction } from '@/app/actions/pickem';
import { useHandleGate } from '@/components/handle/HandleGate';
import { orderFor } from '@/lib/gridiron/teamOrder';
import { confirmPickemEntry } from '@/app/actions/confirm';
import StandaloneTime from '@/components/StandaloneTime';

// Where a board game's "Game" affordance points. Keyed by the contest's own
// sport so a future NFL board cannot silently link college routes.
const GAME_ROUTE = { cfb: '/cfb/game', nfl: '/nfl/game' };

// THE STEP STRIP'S THREE STEPS (v2 mock). Contextual, not static help: which
// one is lit follows the board's own state, and the line under it says when a
// pick stops being editable.
const STEP_NAMES = ['Pick', 'Fill the board', 'Locked in'];

// THESE TWO ARE A GROUPING KEY, NOT A CLOCK (relay 3b item 2). The slate's
// sections are the NFL/CFB week's own ET calendar days - which games belong
// to "Sunday" is a property of the schedule, not of where the reader is
// sitting, and regrouping them by viewer-local date would move a Thursday
// night game into Friday for anyone east of the Atlantic. Every rendered
// TIME on this board goes through StandaloneDate/StandaloneTime; no
// timestamp is formatted here.
const ET_WEEKDAY_LONG = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long' });
const ET_YMD = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });

/**
 * Games grouped by their kickoff's ET CALENDAR DAY (relay 2a item 8's
 * .secl day sections) - not by lock day-of-week generically, this specific
 * board's own dates, in the order the games already come in (kickoff-time
 * order, per lib/pickem/entry.js's gameRows()). Each group also carries
 * whether every game in it shares one lock instant ('lock {local}') or not
 * ('lock per game' - the common case once a day has more than one window).
 */
function groupByLockDay(games) {
  const groups = [];
  const byKey = new Map();
  for (const g of games) {
    const d = new Date(g.kickoff_at);
    const key = ET_YMD.format(d);
    if (!byKey.has(key)) {
      const group = { key, label: ET_WEEKDAY_LONG.format(d), games: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    byKey.get(key).games.push(g);
  }
  for (const group of groups) {
    const first = group.games[0].kickoff_at;
    group.sameLock = group.games.every((g) => g.kickoff_at === first);
    group.lockAt = group.sameLock ? first : null;
  }
  return groups;
}

/** A board game's page, or null when we have no route for its sport. */
function gameHref(contest, g) {
  const base = GAME_ROUTE[contest?.sport];
  return base && g?.slug ? `${base}/${g.slug}` : null;
}

function countdownTo(iso, now) {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return null;
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return d > 0 ? `${d}d ${h}h ${mm}m` : h > 0 ? `${h}h ${mm}m` : `${mm}m`;
}

/**
 * ONE ROW ALWAYS, unless the board is too big for one to stay legible
 * (relay 2a-polish item 3). Below the split point every pip shrinks
 * (flex:1) to fit 390px; past it, splitting keeps a pip tappable rather
 * than shrinking it into a sliver - and the split is two EQUAL rows, never
 * a nearly-full row plus a two-pip orphan the way CSS wrapping would.
 */
const PIP_SPLIT_AT = 26;
function pipRows(games) {
  if (games.length <= PIP_SPLIT_AT) return [games];
  const half = Math.ceil(games.length / 2);
  return [games.slice(0, half), games.slice(half)];
}

export default function PickemBoard({
  view, signedIn, signinHref, hasHandle = true, initialConfirmedAt = null, locksAt = null, sportSwitch = null,
  // THE SEASON LINE, or null. Computed on the server by lib/pickem/seasonPct.js
  // from the same table the lobby ranks with; null for a reader with no
  // settled board, and then the header simply has no season on it.
  season = null,
}) {
  const { guard, modal: handleModal, pending: heldRows } = useHandleGate(hasHandle);
  // CONFIRM AND RECEIPT (relay 3 item 3), the Weekly's own model: picks
  // already autosave, so this records that the reader has seen a finished
  // board. An unconfirmed board still counts at each game's own lock.
  const [confirmedAt, setConfirmedAt] = useState(initialConfirmedAt);
  const [confirming, setConfirming] = useState(false);
  const { contest, games: initialGames } = view;
  // Optimistic overlay: matchId -> side. The server payload stays the truth
  // for everything else.
  const [mine, setMine] = useState({});
  const [savedTick, setSavedTick] = useState(false);
  const [lockedMsg, setLockedMsg] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const games = useMemo(() => initialGames.map((g) => ({
    ...g,
    kicked: g.kicked || new Date(g.kickoff_at).getTime() <= now,
    my_side: mine[g.match_id] ?? g.my_side,
  })), [initialGames, mine, now]);

  // ONE DENOMINATOR ON THE PAGE (GO rider): the header clock, the pip
  // caption and the confirm line all count the PICKABLE games - see below.
  // WHAT CAN STILL BE PICKED, at this render (FRESH-USER FIXES, D4). The
  // confirm card used to wait for picked === total, and a board that already
  // had a kicked game - every NFL board from Friday on - could never reach it:
  // the Thursday game's buttons are disabled and a forced save is refused,
  // so "Lock it in" never rendered for anyone joining mid-week. The card now
  // asks for every game that is STILL OPEN; kicked rows are out of both the
  // numerator and the denominator. Server confirmVerdict is unchanged.
  const pickable = games.filter((g) => !g.kicked).length;
  const pickedOpen = games.filter((g) => !g.kicked && g.my_side != null).length;
  const wins = games.filter((g) => g.graded === 'W').length;
  const losses = games.filter((g) => g.graded === 'L').length;
  const pending = games.filter((g) => g.status !== 'final').length;
  const anyKicked = games.some((g) => g.kicked);
  const nextKick = games.find((g) => !g.kicked)?.kickoff_at ?? null;
  const cd = nextKick ? countdownTo(nextKick, now) : null;

  function tap(g, side) {
    if (!signedIn || g.kicked) return;
    const was = g.my_side;
    // THE PICK SHOWS AT THE TAP, handle or no handle (FRESH-USER FIXES, D3).
    // The optimistic paint used to wait behind guard(), so a reader who
    // tapped Not now saw a board that had not moved and a pick that did not
    // exist. Now the overlay is applied here and only the SERVER write waits
    // behind the gate: a held write leaves the row painted and marked
    // pk-pending ("Needs a handle"), and the claim replays it.
    setMine((m) => ({ ...m, [g.match_id]: side === was ? was : side }));
    setLockedMsg(null);
    setConfirmedAt(null);
    guard(() => savePick(g, side, was), g.match_id);
  }

  async function savePick(g, side, was) {
    const res = await savePickAction(contest.id, g.match_id, side)
      .catch(() => ({ ok: false, reason: 'network' }));
    if (!res.ok) {
      setMine((m) => ({ ...m, [g.match_id]: was ?? undefined }));
      if (res.reason === 'game_locked') {
        setLockedMsg(`${g.away} @ ${g.home} kicked - that pick is sealed`);
        setNow(Date.now());
      }
      return;
    }
    setSavedTick(true);
    // EDITING AFTER CONFIRMING drops the confirmation until it is re-pressed.
    setConfirmedAt(null);
    setTimeout(() => setSavedTick(false), 1600);
  }

  const dayGroups = useMemo(() => groupByLockDay(games), [games]);

  async function lockItIn() {
    if (confirming) return;
    setConfirming(true);
    const r = await confirmPickemEntry(contest.id).catch(() => null);
    setConfirming(false);
    if (r?.ok) setConfirmedAt(r.confirmedAt);
  }

  // ---- THE v2 BOARD, per docs/design/mocks/pickem-v2.html (fdd4fcc) --------
  // Record and pips in the header, the sport switch as two cards, the step
  // strip with one contextual line, games grouped by day with an open count,
  // two large tap targets a game, the line and the network in the foot, and a
  // footer that is a COUNTER until every open game is picked.
  const toGo = pickable - pickedOpen;
  // THE DENOMINATOR IS PICKABLE ROWS ONLY (the fresh-user rider). A game that
  // has already kicked with no pick on it is neither "to go" nor a reason the
  // board cannot be locked in - it is simply gone, and it scores nothing.
  const stage = pickable === 0 ? 3 : toGo === 0 ? 3 : pickedOpen > 0 ? 2 : 1;
  const canConfirm = signedIn && pickable > 0 && toGo === 0;

  return (
    <>
      {handleModal}

      <header className="pkv-hd">
        <div className="pkv-hd-top">
          <span className="pkv-eb">Pick&rsquo;em</span>
          <span className="pkv-ed">
            Board {contest.boardNumber ?? ''} &middot; {contest.sport.toUpperCase()}
            {contest.displayWeek != null && <> Week {contest.displayWeek}</>}
          </span>
        </div>
        <div className="pkv-rec">
          <div>
            <div className="pkv-eb pkv-quiet">Your board {nextKick == null ? '· locked' : ''}</div>
            {/* W-L AND PENDING, the same three numbers the old .pk-record
                block carried - recordOf's own arithmetic, not a second count. */}
            <div className="pkv-big n">
              {wins}-{losses}<small className="n"> &middot; {pending} pending</small>
            </div>
          </div>
          {/* THE SEASON AVERAGE, or nothing at all. A reader with no settled
              board has no season, and an invented .000 would read as a record
              of failure rather than an absence of one. */}
          {season ? (
            <div className="pkv-rt">
              <b className="n">{season.avg}</b>
              <span>Season</span>
            </div>
          ) : null}
        </div>
        <div className="pkv-pips">
          {games.map((g) => {
            const cls = g.graded === 'W' ? ' w' : g.graded === 'L' ? ' l' : g.my_side != null ? ' on' : '';
            const title = `${g.away} at ${g.home}`;
            return <span key={g.match_id} className={`pkv-pip${cls}${g.kicked && g.my_side == null ? ' none' : ''}`} title={title} />;
          })}
        </div>
        <div className="pkv-sub">
          <span>{pickedOpen} of {pickable} picked</span>
          {cd && <span>next lock <b>{cd}</b></span>}
        </div>
      </header>

      {sportSwitch}

      <div className="pkv-steps">
        <div className="pkv-strip">
          {STEP_NAMES.map((name, i) => {
            const cls = i + 1 === stage ? 'on' : (i + 1 < stage ? 'done' : '');
            return (
              <span key={name} className="pkv-stpwrap">
                <span className={`pkv-stp ${cls}`}>
                  <i>{cls === 'done' ? '✓' : i + 1}</i>
                  <b>{name}</b>
                </span>
                {i < STEP_NAMES.length - 1 ? <span className="pkv-arw" /> : null}
              </span>
            );
          })}
        </div>
        {/* ONE LINE, AND IT SAYS WHEN A PICK STOPS BEING EDITABLE. The mock's
            copy, with its em dash written as a hyphen per the house rule. */}
        <p className="pkv-note">
          {stage === 1 ? (
            <>Pick the <b>winner</b> of every game, straight up. The line is shown for reference and does not change the scoring. Each game locks at its own kickoff.</>
          ) : stage === 2 ? (
            <><b>{toGo} still open.</b> Tap a side to change a pick any time before that game kicks off. A game you never picked scores nothing.</>
          ) : (
            <>Every open game is picked. Keep changing them right up to each kickoff - <b>nothing is final until the game starts</b>.</>
          )}
        </p>
      </div>

      {lockedMsg && <p className="pk-lockedmsg">{lockedMsg}</p>}

      {dayGroups.map((group) => {
        const openInGroup = group.games.filter((g) => !g.kicked).length;
        return (
          <div key={group.key}>
            <div className={`pkv-dh${openInGroup ? '' : ' locked'}`}>
              <h3>{group.label}</h3>
              <span>{openInGroup ? `${openInGroup} still open` : 'all locked'}</span>
            </div>
            <div className="pkv-games">
              {group.games.map((g) => {
                const held = heldRows?.has?.(g.match_id);
                const locked = g.kicked;
                const live = g.status === 'live';
                const showScores = g.status !== 'scheduled';
                return (
                  <div className={`pkv-g${locked ? ' locked' : ''}${live ? ' live' : ''}${held ? ' pk-pending' : ''}`} key={g.match_id}>
                    <div className="pkv-gtop">
                      {live ? (
                        // THE LIVE RULE CARRIES THE CLOCK, when the poller has
                        // one. A live game with no live_state yet says LIVE and
                        // nothing more rather than an invented quarter.
                        <span className="pkv-l">{g.period ? `${g.period}${g.clock ? ` ${g.clock}` : ''}` : 'LIVE'}</span>
                      ) : (
                        <span>{held ? <span className="pk-pending-lbl">Needs a handle</span> : <StandaloneTime iso={g.kickoff_at} />}</span>
                      )}
                      <span className="pkv-gtopr">
                        {/* THE WAY OUT TO THE GAME PAGE stays. The mock does not
                            draw it; removing a navigation affordance is a
                            behaviour change, not a reskin, so it keeps its
                            place beside the network. */}
                        {/* NO ROUTE, NO LINK. gameHref returns null for a sport
                            this app has no game page for (soccer today), and a
                            Link with a null href throws rather than degrading -
                            it crashed the whole board in test before this guard. */}
                        {gameHref(contest, g) ? (
                          <Link className="pkv-gamelink" href={gameHref(contest, g)}>Game</Link>
                        ) : null}
                        {g.network ? <span className="pkv-net">{g.network}</span> : null}
                      </span>
                    </div>

                    <div className="pkv-sides">
                      {/* BOTH OR NEITHER, the helmets' own rule carried onto the
                          disc. One coloured mark beside one grey one reads as a
                          favourite, which is the thing this board must never
                          imply - so a row where either side has no colours
                          draws two neutral marks, not one of each. */}
                      {orderFor(contest?.sport).map((side) => {
                        const dressed = Boolean(g.home_colors?.primary && g.away_colors?.primary);
                        const isAway = side === 'away';
                        const name = isAway ? g.away : g.home;
                        const score = isAway ? g.away_score : g.home_score;
                        const colors = isAway ? g.away_colors : g.home_colors;
                        const rank = isAway ? g.away_rank : g.home_rank;
                        const record = isAway ? g.away_record : g.home_record;
                        const isMine = g.my_side === side;
                        const won = isMine && g.graded === 'W';
                        const lost = isMine && g.graded === 'L';
                        const cls = `pkv-side${won ? ' won' : lost ? ' lost' : isMine ? ' picked' : ''}`;
                        const content = (
                          <>
                            {/* THE TWO-COLOUR MARK is Helmet's own colours in a
                                disc - Helmet itself is unchanged and still
                                draws the game page's helmet. */}
                            <span
                              className="pkv-mk"
                              aria-hidden="true"
                              style={dressed ? {
                                background: `linear-gradient(to bottom, ${colors.primary} 0 58%, ${colors.secondary ?? colors.primary} 58% 100%)`,
                              } : undefined}
                            />
                            <span className="pkv-nm">
                              <b>{name}</b>
                              {/* RANK AND RECORD (ruling c), and the side word
                                  when there is neither. recordLine returns a
                                  bare '-' for a team with no record, which
                                  claims we looked and found nothing; "away"
                                  says the true thing instead. */}
                              <small>{record ? recordLine(rank, record) : (isAway ? 'away' : 'home')}</small>
                            </span>
                            {showScores ? <span className="pkv-sc n">{score ?? 0}</span> : null}
                            {won ? <span className="pkv-tick w">✓</span>
                              : lost ? <span className="pkv-tick l">✗</span>
                                : isMine ? <span className="pkv-tick p">●</span> : null}
                          </>
                        );
                        if (!signedIn && !locked) {
                          return <a key={side} className={cls} href={signinHref}>{content}</a>;
                        }
                        return (
                          <button key={side} type="button" className={cls} disabled={locked} onClick={() => tap(g, side)}>
                            {content}
                          </button>
                        );
                      })}
                    </div>

                    <div className="pkv-gfoot">
                      {(() => {
                        if (!isPreGame(g.status)) return null;
                        const p = spreadParts({ spreadHome: g.spread_home, homeAbbr: g.home, awayAbbr: g.away });
                        if (!p) return null;
                        return <span className="pkv-line">{p.fav}{' '}{p.mag}</span>;
                      })()}
                      {g.my_side != null ? (
                        <span className={`pkv-pick${g.graded === 'W' ? ' j' : g.graded === 'L' ? ' t' : ' v'}`}>
                          {g.my_side === 'away' ? g.away : g.home}
                          {g.graded === 'W' ? ' ✓' : g.graded === 'L' ? ' ✗' : ''}
                        </span>
                      ) : (
                        <span className="pkv-pick pkv-nopick">{locked ? 'no pick' : 'no pick'}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {!signedIn ? (
        <a className="pk-signin" href={signinHref}>Sign in to make your picks &rarr;</a>
      ) : null}

      {/* THE FOOTER IS THE CONFIRM CONTROL (R4). ConfirmCard's markup is gone;
          confirmPickemEntry and confirmVerdict are still the only action and
          the only gate behind it. The word "submit" appears nowhere: picks
          autosave and an unconfirmed board still counts at each kickoff. */}
      <div className="pkv-ft">
        <div className="pkv-pace">
          {confirmedAt ? (
            <>Locked in<br /><b><StandaloneTime iso={confirmedAt} /></b> &middot; edit any pick until its kickoff</>
          ) : savedTick ? (
            <><b>Saved</b><br />edit any pick until its kickoff</>
          ) : (
            <>Straight up, no spread<br />The line is <b>for reference only</b></>
          )}
        </div>
        {signedIn && pickable > 0 ? (
          <button
            type="button"
            className="pkv-lock"
            disabled={!canConfirm || confirming || Boolean(confirmedAt)}
            onClick={lockItIn}
          >
            {confirming ? 'Locking…' : confirmedAt ? 'Locked in' : canConfirm ? 'Lock it in' : `${toGo} to go`}
          </button>
        ) : null}
      </div>
    </>
  );
}
