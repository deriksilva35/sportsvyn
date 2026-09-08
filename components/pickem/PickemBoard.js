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
import { confirmPickemEntry } from '@/app/actions/confirm';
import StandaloneDate from '@/components/StandaloneDate';
import StandaloneTime from '@/components/StandaloneTime';
import ConfirmCard from '@/components/games/ConfirmCard';

// Where a board game's "Game" affordance points. Keyed by the contest's own
// sport so a future NFL board cannot silently link college routes.
const GAME_ROUTE = { cfb: '/cfb/game', nfl: '/nfl/game' };

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
  view, signedIn, signinHref, hasHandle = true, initialConfirmedAt = null, locksAt = null,
}) {
  const { guard, modal: handleModal } = useHandleGate(hasHandle);
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

  const picked = games.filter((g) => g.my_side != null).length;
  const total = games.length;
  const wins = games.filter((g) => g.graded === 'W').length;
  const losses = games.filter((g) => g.graded === 'L').length;
  const pending = games.filter((g) => g.status !== 'final').length;
  const anyKicked = games.some((g) => g.kicked);
  const nextKick = games.find((g) => !g.kicked)?.kickoff_at ?? null;
  const cd = nextKick ? countdownTo(nextKick, now) : null;

  function tap(g, side) {
    if (!signedIn || g.kicked) return;
    // GUARDED BEFORE THE OPTIMISTIC PAINT, not after. Flipping the side first
    // and asking second would show the reader a pick that does not exist yet,
    // and cancelling would then have to un-flip it - a board that moves under
    // somebody who declined. Nothing changes until there is a handle.
    guard(() => savePick(g, side));
  }

  async function savePick(g, side) {
    const was = g.my_side;
    setMine((m) => ({ ...m, [g.match_id]: side === was ? was : side }));
    setLockedMsg(null);
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

  return (
    <>
      {handleModal}
      {/* THE HEADER (relay 2a item 8, week fixed in 2a-polish item 3) -
          replaces the old .pk-hero/h1/.pk-ctx. The display week only
          appears when one exists (the AP poll's current week for CFB) -
          contest.week itself is an internal board-sequencing number, never
          shown here. */}
      <header className="hdr">
        <span className="ed">
          Pick&rsquo;em &middot; Board {contest.boardNumber ?? ''} &middot; {contest.sport.toUpperCase()}
          {contest.displayWeek != null && <> Week {contest.displayWeek}</>}
        </span>
        <span className="clock">{picked} of {total}</span>
      </header>
      {/* STRAIGHT UP, SAID ONCE. The line below each game is reference, not
          the bet - a board that shows a spread beside two buttons reads as
          against-the-spread to anyone fluent, which this game is not. */}
      <p className="pk-straight">Pick the winner. Straight up. The line is for reference.</p>

      {anyKicked && (
        <section className="pk-record">
          <div className="pk-eb">Your board {nextKick == null ? '· locked' : ''}</div>
          <div className="pk-big">{wins}-{losses} <small>&middot; {pending} pending</small></div>
        </section>
      )}

      {/* THE TINY PIP ROW (relay 2a item 8, split fixed in 2a-polish item 3) -
          one per game, checked when picked, dashed border once its own
          kickoff has passed. Replaces the old linear .pk-progress bar. */}
      <div className="prog">
        {pipRows(games).map((row, i) => (
          <div className="rrow" key={i}>
            {row.map((g) => (
              <div key={g.match_id} className={`pip tiny${g.my_side != null ? ' full' : ''}${g.kicked ? ' lock' : ''}`}>
                <span className="dot">{g.my_side != null ? '✓' : '·'}</span>
              </div>
            ))}
          </div>
        ))}
        <div className="cap">
          <span>{picked} of {total} picked</span>
          {cd && <span>next lock <b>{cd}</b></span>}
        </div>
      </div>

      {lockedMsg && <p className="pk-lockedmsg">{lockedMsg}</p>}

      {dayGroups.map((group) => (
        <div key={group.key}>
          {/* THE DAY GROUP HEADER (relay 2a item 8) - '{Day} · {n} games',
              'lock {local}' when every game in the group shares one kickoff,
              'lock per game' otherwise (the common case past Thursday). */}
          <div className="secl">
            <b>{group.label} &middot; {group.games.length} game{group.games.length === 1 ? '' : 's'}</b>
            <span>{group.sameLock ? <>lock <StandaloneDate iso={group.lockAt} /></> : 'lock per game'}</span>
          </div>
          {group.games.map((g) => {
        const kickedAtMs = new Date(g.kickoff_at).getTime() <= now;
        // NO DAY LABEL INSIDE A ROW (2a-polish item 3) - the group header
        // above already names the day; a row only speaks up here for a real
        // in-progress fact, live or final.
        const eyebrowLeft = g.status === 'final' ? 'Final'
          : g.status === 'live' ? '● Live'
            : null;
        // KICKOFF IN THE VIEWER'S OWN ZONE (relay 3b item 2), like the
        // group header's lock time directly above it. This cell used to
        // print a hardcoded " ET" while that header printed PDT, so a
        // California reader saw two clocks three hours apart on one board.
        const eyebrowRight = g.status === 'final' || g.status === 'live'
          ? (g.home_score != null ? `${g.away_score}-${g.home_score}` : '')
          : <StandaloneTime iso={g.kickoff_at} />;
        return (
          <div className="pk-game" key={g.match_id}>
            {/* THE LINK LIVES IN THE HEADER, NEVER AROUND THE PICKS.
                .pk-eb and .pk-sides are SIBLINGS - the anchor is not an
                ancestor of the pick buttons, so a pick tap has no anchor to
                navigate; and nothing on .pk-game or .pk-eb carries an onClick,
                so the link's own tap has no handler to bubble into. The
                separation is structural, not a z-index or a stopPropagation
                that the next edit could undo. The 9px .pk-eb margin-bottom
                keeps the two tap targets physically apart as well.
                NO 'GAME ->' PILL (2a-polish item 3): the mono readout itself -
                the kickoff time pre-kickoff, the score once live or final -
                IS the link now, so there is no separate label left to cut.
                It stays in the eyebrow rather than moving into a .pk-side:
                that side is a <button> carrying the pick's own onClick, and
                an anchor nested inside it would either be swallowed by the
                pick tap or fire both - the exact hazard the test below pins
                against, for the label this replaces as much as the old one. */}
            <div className={`pk-eb${g.status === 'live' ? ' live' : ''}`}>
              <span>{eyebrowLeft}</span>
              <span className="pk-ebr">
                {gameHref(contest, g) ? (
                  <Link
                    className="pk-gamelink"
                    href={gameHref(contest, g)}
                    aria-label={`${g.away} at ${g.home} game page`}
                  >
                    {eyebrowRight}
                  </Link>
                ) : (
                  <span className="pk-mono">{eyebrowRight}</span>
                )}
              </span>
            </div>
            <div className="pk-sides">
              {['away', 'home'].map((side, i) => {
                const name = side === 'home' ? g.home : g.away;
                const isMine = g.my_side === side;
                let cls = 'pk-side';
                if (!g.kicked && !kickedAtMs) {
                  // A PICK IS A WINNER, NOT A BET: the chosen side keeps the
                  // volt fill and carries YOUR PICK; the other side drops to
                  // muted so the pair reads as decided, not as two prices.
                  if (isMine) cls += ' on';
                  else if (g.my_side != null) cls += ' dim';
                } else if (isMine) {
                  cls += g.graded === 'W' ? ' win' : g.graded === 'L' ? ' loss' : ' pick';
                } else {
                  cls += ' dim';
                }
                // A KICKED GAME DISABLES BOTH SIDES FOR EVERYONE - there is no
                // pick left to make, signed in or not, so it is never a
                // sign-in prompt. SIGNED OUT AND NOT YET KICKED IS THE ONE
                // CASE THAT ROUTES: the side becomes a real link to sign-in
                // with a return URL (2a-polish item 1), not a disabled
                // button pretending the pick does not exist.
                const lockedByKickoff = g.kicked || kickedAtMs;
                const rank = side === 'home' ? g.home_rank : g.away_rank;
                const record = side === 'home' ? g.home_record : g.away_record;
                const content = (
                  <>
                    <span className="pk-nmwrap">
                      <span className="pk-nm">{name}</span>
                      {/* THE JOIN IS BY TEAM ID (lib/pickem/entry.js's
                          recordMapFor), never by name - two "State" schools
                          never collide. An absent row is a stated '-', never
                          a hidden line. */}
                      <small className="pk-rec">{recordLine(rank, record)}</small>
                    </span>
                    {!lockedByKickoff && (isMine
                      ? <span className="pk-tag pk-yourpick">YOUR PICK</span>
                      : <span className="pk-tag">{side.toUpperCase()}</span>)}
                    {isMine && g.graded === 'W' && <span className="pk-res w">W</span>}
                    {isMine && g.graded === 'L' && <span className="pk-res l">L</span>}
                    {isMine && g.status === 'live' && <span className="pk-res live">LIVE</span>}
                  </>
                );
                return (
                  <>
                    {/* THE MOCK'S "at" (2a-polish item 3) - the two sides
                        read as one sentence, "Away at Home". */}
                    {i === 1 && <div className="pk-at" key="at">at</div>}
                    {!signedIn && !lockedByKickoff ? (
                      <a key={side} className={cls} href={signinHref}>{content}</a>
                    ) : (
                      <button
                        key={side}
                        type="button"
                        className={cls}
                        disabled={lockedByKickoff}
                        onClick={() => tap(g, side)}
                      >
                        {content}
                      </button>
                    )}
                  </>
                );
              })}
            </div>
            {/* THE LINE, BELOW THE SIDES, MUTED MONO, PREFIXED. It used to sit
                in the eyebrow beside the kickoff time, above the buttons -
                where a fluent reader takes it as the bet. Down here, after the
                choice, it is reference. isPreGame at the render as well as at
                the fetch: it vanishes the moment a game kicks, because a
                pre-kickoff line beside a live score is a number that stopped
                being true. Never in the eyebrow, never inside a .pk-side. */}
            {(() => {
              if (!isPreGame(g.status)) return null;
              const p = spreadParts({ spreadHome: g.spread_home, homeAbbr: g.home, awayAbbr: g.away });
              if (!p) return null;
              return (
                <div className="pk-line">
                  <span className="pk-line-k">line</span>
                  <span className="pk-line-t">{p.fav}</span>
                  <span className="pk-line-n">{'\u00a0'}{p.mag}</span>
                </div>
              );
            })()}
          </div>
            );
          })}
        </div>
      ))}

      {signedIn ? (
        <p className="pk-savebar">{savedTick ? <b>Saved</b> : 'Saved'} &middot; edit any pick until its kickoff</p>
      ) : (
        <a className="pk-signin" href={signinHref}>Sign in to make your picks &rarr;</a>
      )}

      {/* THE CONFIRM CARD (relay 3 item 3, shared 3b item 1). Only once
          EVERY game is picked - a part-picked board has nothing to confirm,
          and each game locks at its own kickoff regardless. Same component
          the Weekly renders; this board's summary is a count rather than a
          roster, which is the one thing the two games differ on. */}
      {signedIn && picked === total && total > 0 && (
        <ConfirmCard
          title="Your board"
          line={`${total} of ${total} picked`}
          receiptLine={`All ${total} picked`}
          lockIso={locksAt}
          lockPre="First lock"
          note="Each game stays editable until its own kickoff; a change re-confirms when it saves."
          confirmedAt={confirmedAt}
          confirming={confirming}
          onLockIn={lockItIn}
        />
      )}
    </>
  );
}
