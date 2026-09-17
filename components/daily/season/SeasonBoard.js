'use client';

/**
 * components/daily/season/SeasonBoard.js — the season-roster board's
 * surface: rules card, board screen, grade. Per
 * docs/design/daily-full-mock-v3.html.
 *
 * NOT THE EXISTING /daily WEEK-GAME. lib/daily/play.js's SLOTS (6, drop-the-
 * worst PPR scoring, a season/week guess bonus) is a DIFFERENT game this file
 * does not touch. This one is the twelve-team, eight-slot roster board
 * (Step 2/3/4): QB/RB/RB/WR/WR/FLEX/FLEX/K, graded against the solver's
 * ceiling (lib/daily/seasonBoardGrade.js). All state logic lives in
 * lib/daily/seasonBoardPlay.js and seasonBoardGrade.js (pure, tested); this
 * file is rendering plus the local UI state those modules deliberately have
 * no opinion on - which screen is showing, and whether a chosen player still
 * needs a slot picked for them.
 *
 * COMMIT-ON-OPEN IS GONE (v2.0 ruling, docs/design/mocks/daily-v2.html).
 * Opening a team used to spend it and a closeless modal enforced that; the
 * ranked board is a three-minute puzzle with a lock at the end, so the panel
 * is browsable, the hold is reversible, and a filled slot can be cleared -
 * the mock's own copy says so. What replaced the modal is two pieces of
 * state, `cur` and `held`, and a panel that is always on screen.
 *
 * THE TOAST IS STILL A PORTAL TO document.body, not rendered in normal flow.
 * position:fixed centering (left:50%;top:50%;transform:translate(-50%,-50%))
 * is relative to the nearest ancestor with a CSS transform/filter/perspective
 * if one exists ANYWHERE up the tree, not the viewport - a common shell-
 * chrome pattern in this app. Rendered in place, that turns a centered modal
 * into whatever the nearest transformed ancestor's box happens to produce,
 * which reads as "a drawer" rather than a centered sheet. A portal to
 * document.body sidesteps the whole class of bug rather than hunting for the
 * one ancestor responsible.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import {
  initBoardPlay, teamIsDead, isRosterComplete, filledCount, teamsLeft,
  legalSlotIndexes, commitPick, clearSlot, startClock as canStartClock,
} from '@/lib/daily/seasonBoardPlay';
import { gradeBoard, boardStory } from '@/lib/daily/seasonBoardGrade';
import { DAILY_V2_PATH, DAILY_ROUND_SECONDS } from '@/lib/daily/boardShape';

// THE ONE PLACE THE DOMAIN-QUALIFIED SHARE URL IS BUILT (relay 5b item 7) -
// DAILY_V2_PATH is the same constant lib/push/copy.js's url fields use, so
// there is exactly one '/daily/board' literal in the whole v2 surface.
const SHARE_URL = `sportsvyn.com${DAILY_V2_PATH}`;
import './seasonBoard.css';
import StandaloneTime from '@/components/StandaloneTime';

const DOT_LABEL = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', FLEX: 'FX', K: 'K' };

// THE POSITION GLYPHS - a slot's identity on the board, so the same glyph
// carries through everywhere that slot is shown: the progress row AND the
// grade rows (ruling). Verbatim codepoints from docs/design/daily-full-
// mock-v3.html's own EM map: QB target, RB runner, WR hands, FLEX cycle,
// K shoe. TE now has a slot of its own (v2.0) and takes the FLEX cycle's
// sibling - a hand-off - so every slot on the ranked shape has a glyph.
const SLOT_EMOJI = { QB: '\u{1F3AF}', RB: '\u{1F3C3}', WR: '\u{1F932}', TE: '\u{1F91D}', FLEX: '\u{1F504}', K: '\u{1F45F}' };

// THE SLOT'S OWN COLOUR, per the v2.0 mock's --qb/--rb/--wr/--te/--k. FLEX
// has none in the mock and inherits the quiet default.
const SLOT_CLASS = { QB: 'qb', RB: 'rb', WR: 'wr', TE: 'te', FLEX: 'flx', K: 'k' };

// THE STEP STRIP'S THREE STEPS (v2.0 ruling R5). Contextual, not static help:
// which one is lit is derived from what the player is holding, and the line
// under it says the next thing to do.
const STEP_NAMES = ['Team', 'Player', 'Slot'];

/** The name as a filled slot shows it: the last word, uppercased by CSS.
 * "A. St. Brown" -> "Brown", "Jahmyr Gibbs" -> "Gibbs". A slot tile is 70px
 * wide and a full name does not fit one; the panel beside it carries the
 * whole name, so nothing is hidden, only abbreviated where it must be. */
function lastNameOf(name) {
  const parts = String(name ?? '').trim().split(/\s+/);
  return parts.length ? parts[parts.length - 1] : '';
}

/** A team key -> the abbreviation the board carries for it. The pick stores
 * the key; the tile shows what the chip row shows. */
function abbrOf(teams, teamKey) {
  return teams.find((t) => t.key === teamKey)?.abbr ?? teamKey;
}

function mmss(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
const ROUND_MS = DAILY_ROUND_SECONDS * 1000;
/** Countdown display: CEIL, not floor. With 49.99s left the clock reads
 * 0:50, and it reads 0:00 only once the round is actually over - floor would
 * show 0:00 for the last full second while the board was still open. */
function mmssCountdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
/** Receipt/share clock: elapsed, CAPPED at the round. A run that took 31
 * wall-clock minutes before the clock existed reads 3:00, never 31:28. */
const clockFor = (elapsedMs) => mmss(Math.min(ROUND_MS, Math.max(0, elapsedMs)));

/** THE WAY OUT - the same crumb the Weekly and the Draft carry, first child
 * of the screen. /daily/board has no <main>; the .sbd root is its main. */
const Crumb = () => (
  <div className="sbd-crumb-row"><Link className="appcrumb" href="/games">&larr; Games</Link></div>
);

/**
 * @param edition   "The Daily · No. 020"
 * @param year      "2017"
 * @param teams     [{ key, abbr, record, card:[{position, name, meta, points}] }]
 * @param slots     ['QB','RB','RB','WR','WR','FLEX','FLEX','K'] - see boardShape.js
 * @param ranked    true for the Daily itself, false for practice
 * @param userId    signed-in user id, or null - gates the clock (5b). Only
 *                  meaningful on the edition path; the preview passes null
 *                  and never renders a rules card that needs it, since
 *                  practice has no sign-in requirement of its own.
 * @param signInHref  when set (edition path, signed out), the rules card
 *                    shows a sign-in link in place of Start.
 * @param initialPlay/initialGrade/initialClockLabel  A3: a returning user
 *   who already has a run for this board lands straight on their STORED
 *   grade - these three, passed together, skip 'rules'/'board' entirely.
 */
export default function SeasonBoard({
  edition, year, teams, slots, ranked, userId = null, signInHref = null,
  initialPlay = null, initialGrade = null, initialClockLabel = null, streak = null,
  closesAt = null, todayRows = null, boardId = null,
  // RESUMING A STARTED RUN (097). The server hands the stored started_at back
  // as an ISO string; the clock is drawn from it, so a reload shows the time
  // already spent instead of restarting at 0:00.
  initialStartedAt = null, initialScreen = null,
}) {
  const [screen, setScreen] = useState(initialScreen ?? (initialGrade ? 'grade' : 'rules')); // 'rules' | 'board' | 'grade'
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState(null);
  // REHYDRATE A RECEIPT'S PLAY. initialPlay arrives across the RSC boundary
  // with `used` as an ARRAY (a Set cannot cross it); everything on this side
  // - teamIsDead, commitPick, boardStory's play.used.size - wants the Set
  // initBoardPlay makes. Convert once, here, and nowhere else has to know.
  const hydratePlay = (p) => (p && !(p.used instanceof Set) ? { ...p, used: new Set(p.used ?? []) } : p);
  const [play, setPlay] = useState(() => hydratePlay(initialPlay) ?? initBoardPlay(teams, slots));
  // THE MOCK'S TWO PIECES OF SELECTION STATE, and there is no third. `cur` is
  // the team whose six are in the panel; `held` is the player waiting for a
  // slot. Both are cleared by placing a pick. The modal sheet flow they
  // replace is gone: the panel is always on screen, so a tap never covers the
  // board it is about.
  const [cur, setCur] = useState(null);
  const [held, setHeld] = useState(null);
  const [toast, setToast] = useState(null);
  const [startedAt, setStartedAt] = useState(
    initialStartedAt ? new Date(initialStartedAt).getTime() : null,
  );
  const [nowMs, setNowMs] = useState(null);
  const [finishedMs, setFinishedMs] = useState(null);
  // THE SERVER'S GRADE. Set only by a 200 from /api/daily/board/run, and the
  // only thing the ranked grade screen will render.
  const [serverGrade, setServerGrade] = useState(null);
  const [serverElapsedS, setServerElapsedS] = useState(null);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState(null);
  // The clock fires the submit exactly once; a re-render at 0:00 must not
  // fire it again while the first is in flight.
  const autoFiredRef = useRef(false);
  // Lazy initializer, not an effect: SSR has no `document` (null, safely),
  // and the client's first render (hydration) runs this function fresh, so
  // document.body is picked up without a setState-in-effect render cascade.
  const [mountNode] = useState(() => (typeof document !== 'undefined' ? document.body : null));
  const tickRef = useRef(null);

  // THE CLOCK STARTS ON THE RULES CARD'S START, NOT ON THE FIRST TAP. Idempotent:
  // once startedAt is set, calling this again does nothing.
  //
  // t0 IS THE SERVER'S INSTANT, NOT Date.now(). It arrives from
  // POST /api/daily/board/start (or from initialStartedAt on a resume), so the
  // clock a player sees is the one the row was stamped with - a reload, a
  // second tab and a wrong device clock all show the same elapsed time.
  const beginTimer = (serverStartedAt) => {
    if (startedAt) return;
    const t0 = serverStartedAt ? new Date(serverStartedAt).getTime() : Date.now();
    setStartedAt(t0);
    setNowMs(Date.now());
    tickRef.current = setInterval(() => setNowMs(Date.now()), 1000);
  };

  // A RESUMED RUN IS ALREADY TICKING when the page hands it to us.
  useEffect(() => {
    if (initialStartedAt && tickRef.current == null && !initialGrade) {
      setNowMs(Date.now());
      tickRef.current = setInterval(() => setNowMs(Date.now()), 1000);
    }
  }, [initialStartedAt, initialGrade]);
  useEffect(() => () => clearInterval(tickRef.current), []);

  // THE CLOCK CANNOT START SIGNED OUT (ruling, 5b) - the rules card already
  // renders sign-in in place of Start when signedOut, so onStart should be
  // unreachable here signed out; canStartClock(userId) is the pure gate
  // this only defers to, not a second decision of its own.
  //
  // THE BOARD IS NOT SHOWN UNTIL THE SERVER HAS THE ROW (097). Before, Start
  // was beginTimer() + setScreen('board') and wrote nothing anywhere, so a
  // player could read all twelve cards, reload, and start over on a fresh
  // clock as often as they liked. The attempt is claimed first now, and the
  // screen only changes on a response - a failed or offline start leaves the
  // rules card up rather than handing out a board that was never claimed.
  const handleStart = async () => {
    if (!canStartClock(userId).ok) return;
    if (starting) return;                       // double-tap is not two attempts
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch('/api/daily/board/start', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStartError(body?.error === 'board closed'
          ? 'This board has closed.'
          : 'Could not start. Try again.');
        return;
      }
      beginTimer(body.startedAt);
      setScreen('board');
    } catch {
      setStartError('Could not start. Check your connection.');
    } finally {
      setStarting(false);
    }
  };

  // OPENING A TEAM COSTS NOTHING NOW. The old board was commit-on-open - look
  // at a team and you had spent it - and the modal existed to enforce that.
  // The v2.0 mock replaces it with a panel you can browse: the team is spent
  // when a player of theirs lands in a slot, and not before.
  const selectTeam = (team) => {
    if (teamIsDead(play, team)) return;
    setCur(team.key);
    setHeld(null);
  };

  // HOLDING A PLAYER IS NOT PLACING ONE. A held player lights the slots he can
  // fill; tapping another player just moves the hold, which is the mock's own
  // "or tap another player to change your mind".
  const holdPlayer = (team, player) => {
    if (!legalSlotIndexes(play, player.position).length) return; // row renders inert
    setHeld({ teamKey: team.key, player });
  };

  const placeInSlot = (slotIndex) => {
    if (!held) return;
    const team = teams.find((t) => t.key === held.teamKey);
    if (!team) return;
    if (!legalSlotIndexes(play, held.player.position).includes(slotIndex)) return;
    const slotPos = play.slots[slotIndex];
    setPlay((p) => commitPick(p, team, held.player, slotIndex));
    setHeld(null);
    setCur(null);
    setToast({ name: held.player.name, slot: slotPos, abbr: team.abbr });
    setTimeout(() => setToast(null), 1500);
  };

  // TAP A FILLED SLOT TO CLEAR IT (the mock's copy, and the rule it reverses).
  // The team comes back with it - clearSlot rebuilds `used` from what is left
  // rather than decrementing, so a team cannot be released twice.
  const clearAt = (slotIndex) => {
    if (!play.roster[slotIndex]?.pick) return;
    setPlay((p) => clearSlot(p, slotIndex));
    setHeld(null);
  };

  //
  // FINISH SUBMITS. Until now this function cleared the interval and flipped
  // the screen - nothing was ever POSTed, /api/daily/board/run had zero
  // callers at every commit it has existed for, and the grade the player saw
  // was computed in their own browser and thrown away. picks stayed NULL
  // forever, which is why the board could be replayed from the lobby all
  // day even after the start row shipped.
  //
  // THE SCREEN DOES NOT FLIP UNTIL THE SERVER HAS THE ROW. On any failure the
  // board and every pick stay exactly where they are and the player can press
  // Finish again - a lost connection must not cost a run that cannot be
  // restarted. The one thing this must never do is show a grade the server
  // did not store.
  // play.roster -> the wire shape lib/daily/seasonBoardRuns.js validates:
  // slot index, which team card it came off, and the player's name. NEVER the
  // points - the server re-reads those off the frozen board, so a client that
  // lied about a score is refused rather than merely out-scored.
  const picksFromPlay = (st) => st.roster.map((r, slotIndex) => ({
    slotIndex,
    teamKey: r.pick?.teamKey ?? null,
    playerName: r.pick?.player?.name ?? null,
  }));

  const handleFinish = async ({ auto = false } = {}) => {
    if (finishing) return;
    if (auto) autoFiredRef.current = true;
    // PRACTICE HAS NO ROW TO WRITE. The unranked preview board (?season=) has
    // no daily_boards row and no boardId, so it keeps the client grade - see
    // the grade screen below, where `ranked` decides which grade is used.
    if (!ranked || boardId == null) {
      clearInterval(tickRef.current);
      setFinishedMs(Date.now());
      setScreen('grade');
      return;
    }
    setFinishing(true);
    setFinishError(null);
    const elapsedS = startedAt ? Math.max(0, Math.round((Date.now() - startedAt) / 1000)) : 0;
    try {
      const res = await fetch('/api/daily/board/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boardId, picks: picksFromPlay(play), elapsedS }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.ok || !body?.grade) {
        // TWO REFUSALS ARE FINAL, NOT RETRYABLE: the clock ran out on the
        // server, or it ran out with nothing on the board. Both are a DNF,
        // and the screen says so rather than offering a retry that cannot
        // succeed.
        if (body?.error === 'time expired' || body?.error === 'nothing picked') {
          clearInterval(tickRef.current);
          setScreen('dnf');
          return;
        }
        setFinishError(body?.error === 'board closed'
          ? 'This board closed before your roster landed. Nothing was scored.'
          : 'Could not submit. Your picks are safe - try again.');
        return;
      }
      // Includes the alreadyRan case: the server hands back the STORED grade
      // with the same shape, so this renders it rather than an error.
      clearInterval(tickRef.current);
      setServerGrade(body.grade);
      setServerElapsedS(Number(body.elapsedS ?? elapsedS));
      setFinishedMs(Date.now());
      setScreen('grade');
    } catch {
      setFinishError('Could not submit. Your picks are safe - check your connection and try again.');
    } finally {
      setFinishing(false);
    }
  };

  const complete = isRosterComplete(play);
  const filled = filledCount(play);
  const left = teamsLeft(play);

  // THE COUNTDOWN. Remaining = the round minus time since the SERVER's
  // started_at; nowMs is only ever compared against that anchor, so a reload
  // shows what is actually left, not a fresh 3:00. Null until the clock has
  // started.
  const remainingMs = startedAt != null && nowMs != null ? ROUND_MS - (nowMs - startedAt) : null;
  const clockText = remainingMs == null ? mmssCountdown(ROUND_MS) : mmssCountdown(remainingMs);
  const clockClass = `sbd-clock${remainingMs != null && remainingMs < 30_000 ? ' sbd-clock--terra' : ''}`;

  // AT ZERO, SUBMIT WHATEVER IS THERE. No modal, no confirmation - the round
  // is over and the server would refuse a later submit anyway. Once only.
  useEffect(() => {
    if (screen !== 'board' || !ranked || boardId == null) return;
    if (remainingMs == null || remainingMs > 0 || autoFiredRef.current) return;
    handleFinish({ auto: true });
  // handleFinish is recreated each render; the ref is the real guard.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingMs, screen]);
  const needPositions = [...new Set(play.roster.filter((r) => !r.pick).map((r) => r.pos))];

  if (screen === 'dnf') {
    // OUT OF CLOCK. v1's own DNF words (app/daily/page.js mod--dnf) with
    // "lineup" -> "roster"; the attempt is spent and nothing is offered.
    return (
      <div className="sbd">
        <Crumb />
        <header className="sbd-hdr"><span className="sbd-ed">{edition}</span><span className="sbd-clock sbd-clock--terra">0:00</span></header>
        <div className="sbd-mid-wait" style={{ margin: '16px 12px 0' }}>
          <b>Ran out of clock</b>
          <div style={{ marginTop: 6 }}>
            You opened today&rsquo;s board but never locked a roster, so there&rsquo;s no score.
            One board a day - the perfect roster and the leaderboard unlock at midnight ET.
          </div>
        </div>
      </div>
    );
  }

  if (screen === 'rules') {
    return (
      <div className="sbd">
        <Crumb />
        <RulesCard
          edition={edition} year={year} slotCount={slots.length} teamCount={teams.length}
          ranked={ranked} onStart={handleStart} signInHref={signInHref}
          starting={starting} startError={startError}
        />
      </div>
    );
  }

  if (screen === 'grade') {
    // A RETURNING USER (initialGrade set) lands here with no play-through
    // in THIS render at all - startedAt/finishedMs are both still null, so
    // the stored grade and its own stored elapsed-time label are used
    // as-is, never gradeBoard()/mmss(finishedMs-startedAt) against state
    // that was never populated this render.
    // WHICH GRADE, AND THE RANKED BOARD NEVER USES THE CLIENT'S.
    //   initialGrade  a returning player - the server already regraded the
    //                 stored row on the page, unchanged behaviour
    //   serverGrade   this submit's response
    //   gradeBoard()  BYPASSED, not removed: it is still the only grade the
    //                 unranked practice board (?season=) can have, since that
    //                 board has no row, no boardId and no server run. On a
    //                 ranked board reaching it would mean showing a score
    //                 nothing stored, so it is unreachable there by
    //                 construction rather than by care.
    const grade = initialGrade ?? serverGrade
      ?? (ranked && boardId != null ? null : gradeBoard(play, teams, slots));
    if (!grade) {
      // Ranked, submitted, but no server grade - only reachable if something
      // set screen='grade' without a response, which nothing does. Refuse to
      // invent a number.
      return <div className="sbd"><div className="sbd-warn" style={{ margin: 16 }}>No stored grade for this run.</div></div>;
    }
    // finishedMs is always set by handleFinish() before screen flips to
    // 'grade' on a live play-through - there is no other path there, so no
    // impure now-fallback.
    const clockLabel = initialGrade
      ? initialClockLabel
      : (serverElapsedS != null ? clockFor(serverElapsedS * 1000) : clockFor(finishedMs - startedAt));
    return (
      <div className="sbd">
        <Crumb />
        <GradeScreen
          edition={edition} year={year} grade={grade} play={play} teams={teams} clockLabel={clockLabel} ranked={ranked}
          streak={streak} closesAt={closesAt} todayRows={todayRows} userId={userId}
        />
      </div>
    );
  }

  // ---- THE BOARD SCREEN, per docs/design/mocks/daily-v2.html --------------
  // Clock and points, the step strip, twelve teams as a 6x2 grid, then the
  // roster 2x4 beside a player panel that is always on screen.
  const totalPoints = play.roster.reduce((a, r) => a + Number(r.pick?.player?.points ?? 0), 0);
  const unspent = teams.length - play.used.size;
  const curTeam = cur ? teams.find((t) => t.key === cur) : null;
  // THE LIT SLOTS. Computed once here rather than per slot, because the same
  // list decides which slots glow AND which taps are accepted.
  const litSlots = held ? legalSlotIndexes(play, held.player.position) : [];
  // WHICH STEP IS LIVE (R5). Derived from what the player is holding - never
  // stored, so it cannot disagree with the board.
  const stage = complete ? 4 : held ? 3 : cur ? 2 : 1;
  const secondsLeft = remainingMs == null ? ROUND_MS / 1000 : Math.max(0, remainingMs / 1000);
  const crowClass = `sbd-crow${secondsLeft <= 30 ? ' sbd-crit' : secondsLeft <= 60 ? ' sbd-warn2' : ''}`;

  return (
    <div className="sbd sbd-v2">
      <Crumb />

      <header className="sbd-hd">
        <div className="sbd-hd-top">
          <span className="sbd-eb">The Daily</span>
          <span className="sbd-ed2">{edition}</span>
        </div>
        <div className={crowClass}>
          {/* THE CLOCK IS UNCHANGED BENEATH THE SKIN. Same remainingMs off the
              server's started_at; only its rendering is new - one tile per
              digit, the colon between them. */}
          <div className="sbd-clk">
            {clockText.split('').map((ch, i) => (ch === ':'
              ? <span key={i} className="sbd-cl">:</span>
              : <span key={i} className="sbd-dg">{ch}</span>))}
          </div>
          <div className="sbd-tot">
            <b className="n">{totalPoints.toFixed(1)}</b>
            <span>Points</span>
          </div>
        </div>
        <div className="sbd-pips">
          {play.roster.map((r, i) => <span key={i} className={`sbd-pip2${r.pick ? ' sbd-on' : ''}`} />)}
        </div>
        <div className="sbd-sub2">
          <span>{filled} of {slots.length} slots</span>
          {/* TEAMS LEFT IS THE UNSPENT COUNT, matching the ticks on the chips
              above it. teamsLeft(play) counts teams that can still fill
              something, which on a full board is zero while four chips sit
              there visibly unticked - two true numbers, and this is the one
              the reader can see. The other is what dims a chip. */}
          <span>{unspent} team{unspent === 1 ? '' : 's'} left</span>
        </div>
      </header>

      <div className="sbd-steps">
        <div className="sbd-strip">
          {STEP_NAMES.map((name, i) => {
            const cls = stage === 4 ? 'done' : (i + 1 === stage ? 'on' : (i + 1 < stage ? 'done' : ''));
            return (
              <span key={name} className="sbd-stpwrap">
                <span className={`sbd-stp ${cls}`}>
                  <i>{cls === 'done' ? '✓' : i + 1}</i>
                  <b>{name}</b>
                </span>
                {i < STEP_NAMES.length - 1 ? <span className="sbd-arw" /> : null}
              </span>
            );
          })}
        </div>
        {/* THE LINE SAYS THE NEXT THING TO DO (R5). Copy is the mock's, with
            its two em dashes written as hyphens per the house rule. */}
        <p className="sbd-note">
          {stage === 1 ? (
            <>Fill <b>eight slots</b> from <b>twelve teams</b>, one player each. Their real season points are your score. Tap a team to see its six.</>
          ) : stage === 2 ? (
            <>Six from the <b>{curTeam?.abbr}</b>. Dimmed ones fit no slot you have left. Tap one.</>
          ) : stage === 3 ? (
            <><b>{held.player.name}</b> fits the lit slots. Tap one to place him - or tap another player to change your mind.</>
          ) : (
            <>All eight in. <b>Lock it in</b> before the clock runs out, or keep swapping - tap any filled slot to clear it.</>
          )}
        </p>
      </div>

      <div className="sbd-sh2">
        <h3>Teams</h3>
        <span>{held ? 'tap a lit slot' : 'tap a team'}</span>
      </div>
      <div className="sbd-grid">
        {teams.map((t) => {
          // TWO DIFFERENT DEAD CHIPS, and they mean different things to a
          // reader. SPENT is a team whose player is already on the board - it
          // wears the tick. DEAD-BUT-UNSPENT is a team that can no longer fill
          // anything still open; it dims and refuses a tap, but it never
          // claims a pick that was not made.
          const spent = play.used.has(t.key);
          const dead = teamIsDead(play, t);
          return (
            <button key={t.key} type="button"
              className={`sbd-tc2${cur === t.key ? ' sbd-tcon' : ''}${spent ? ' sbd-used' : ''}${dead && !spent ? ' sbd-dead2' : ''}`}
              disabled={dead} onClick={() => selectTeam(t)}>
              <span className="sbd-mk" aria-hidden="true" />
              <b>{t.abbr}</b>
            </button>
          );
        })}
      </div>

      <div className="sbd-duo">
        <div className="sbd-field">
          <div className="sbd-form">
            {play.roster.map((r, i) => {
              const lit = litSlots.includes(i);
              const cls = SLOT_CLASS[r.pos] ?? 'flx';
              if (r.pick) {
                return (
                  <button key={i} type="button" className={`sbd-slot filled ${cls}`}
                    onClick={() => clearAt(i)} aria-label={`Clear ${r.pos}`}>
                    <span className="sbd-x">&times;</span>
                    <span className="sbd-spos">{r.pos}</span>
                    {/* THE NAME, NOT A JERSEY (R4). */}
                    <span className="sbd-nm">{lastNameOf(r.pick.player.name)}</span>
                    <span className="sbd-tm">{abbrOf(teams, r.pick.teamKey)}</span>
                    <span className="sbd-pts n">{Number(r.pick.player.points).toFixed(1)}</span>
                  </button>
                );
              }
              return (
                <button key={i} type="button" className={`sbd-slot ${cls}${lit ? ' elig' : ''}`}
                  onClick={() => placeInSlot(i)} aria-label={r.pos}>
                  <span className="sbd-spos">{r.pos}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="sbd-panel">
          <div className="sbd-panh">
            {curTeam ? <span className="sbd-mk" aria-hidden="true" /> : null}
            <b>{curTeam ? curTeam.abbr : 'The board'}</b>
            <small className={held ? 'go' : ''}>
              {curTeam
                ? (held ? <>{held.player.name}<br />tap a lit slot</> : 'tap a player')
                : 'tap a team above'}
            </small>
          </div>
          <div className="sbd-panb">
            {!curTeam ? (
              <div className="sbd-empty">tap a team<br />above</div>
            ) : curTeam.card.map((p, i) => {
              const fits = legalSlotIndexes(play, p.position).length > 0;
              const sel = held?.teamKey === curTeam.key && held?.player?.name === p.name;
              return (
                <button key={`${p.name}-${i}`} type="button"
                  className={`sbd-prow${sel ? ' sel' : ''}${fits ? '' : ' gone'}`}
                  disabled={!fits} onClick={() => holdPlayer(curTeam, p)}>
                  <span className={`sbd-pb ${SLOT_CLASS[p.position] ?? 'flx'}`}>{p.position}</span>
                  <span className="sbd-who">
                    <b>{p.name}</b>
                    <small>{p.meta}</small>
                  </span>
                  <span className="sbd-val">
                    <b className="n">{Number(p.points).toFixed(1)}</b>
                    <small>PTS</small>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="sbd-ft">
        <div className="sbd-pace">
          {filled} of {slots.length} in<br />
          <b className="n">{totalPoints.toFixed(1)}</b> points on the board
        </div>
        <button type="button" className="sbd-lock" onClick={() => handleFinish()}
          disabled={!complete || finishing}>
          {finishing ? 'Locking…' : 'Lock it in'}
        </button>
      </div>

      {/* A FAILED SUBMIT DOES NOT COST THE RUN. The board above is still
          rendered with every pick in place, the button is still there, and
          this says what happened. The screen has not flipped, so no grade the
          server did not store is on display. */}
      {finishError ? (
        <div className="sbd-warn" style={{ margin: '10px 12px 0' }} role="alert">{finishError}</div>
      ) : null}

      {toast && mountNode ? createPortal(
        <div className="sbd-toast">
          <b>{toast.name}</b>
          <p>{toast.slot} locked &middot; {toast.abbr} spent</p>
        </div>,
        mountNode,
      ) : null}
    </div>
  );
}

// TeamSheet and SlotChoiceSheet ARE GONE, not commented out. They were the
// commit-on-open modal pair: a backdrop with no dismiss, a team sheet you
// had to pick from, and a slot chooser for an ambiguous position. The v2.0
// board browses a panel instead and lets a placed pick be cleared, so both
// were unreachable the moment the new screen landed - and an unreachable
// component is how a second, stale interaction model survives a redesign.

function RulesCard({ edition, year, slotCount, teamCount, ranked, onStart, signInHref, starting = false, startError = null }) {
  const unused = teamCount - slotCount;
  return (
    <div className="sbd-rules">
      <div className="sbd-kick">{edition}</div>
      <h2>{year}</h2>

      <div className="sbd-rl">
        <span className="sbd-n">1</span>
        <div className="sbd-t">
          <b>Open a team, take a player</b>
          {/* THE RULE THIS CARD USED TO STATE IS GONE (v2.0). It read "tap one
              and you are committed", which is no longer true and was the first
              thing a player would have found out by tapping. */}
          <p>Twelve team cards. Open any of them and look - a team is only spent once one of its players is on your board.</p>
        </div>
      </div>
      <div className="sbd-rl">
        <span className="sbd-n">2</span>
        <div className="sbd-t">
          <b>You choose the slot</b>
          <p>Take a back and decide whether he fills RB or FLEX. Tap a filled slot to clear it and get the team back.</p>
        </div>
      </div>
      <div className="sbd-rl">
        <span className="sbd-n">3</span>
        <div className="sbd-t">
          <b>{slotCount === 8 ? 'Eight' : slotCount} slots, {unused} team{unused === 1 ? '' : 's'} unused</b>
          <p>QB, two RB, two WR, a TE, a FLEX and a kicker. Choosing which teams to skip is part of it, and scoring is season fantasy points, PPR.</p>
        </div>
      </div>
      <div className="sbd-rl">
        <span className="sbd-n">4</span>
        <div className="sbd-t">
          <b>You are graded against the board</b>
          <p>Not against a season all-star team - against the best roster these twelve teams could actually have produced, one player per team.</p>
        </div>
      </div>

      <div className="sbd-rnote">
        {signInHref
          ? 'Three minutes from Start. The clock is on the server. Sign in to start it. One attempt - this board is ranked.'
          : ranked
            ? 'Three minutes from Start. The clock is on the server. One attempt - this board is ranked.'
            : 'Three minutes from Start. Practice is unranked and touches no leaderboard.'}
      </div>

      {signInHref ? (
        <a className="sbd-btn" style={{ marginTop: 16, textDecoration: 'none', textAlign: 'center' }} href={signInHref}>Sign in to play</a>
      ) : (
        <>
          <button type="button" className="sbd-btn" style={{ marginTop: 16 }} onClick={onStart} disabled={starting}>
            {starting ? 'Starting…' : 'Start the 3:00 clock'}
          </button>
          {startError ? <div className="sbd-warn" style={{ marginTop: 10 }}>{startError}</div> : null}
        </>
      )}
    </div>
  );
}

/**
 * The grade (Part A / Step 4). Set-match already happened in gradeBoard() -
 * this component only formats what it is handed. Column order (You left,
 * Best roster right) and row order (matched rows first, in the solver's own
 * slot order, then swap rows) match the mock exactly.
 */
function GradeScreen({
  edition, year, grade, play, teams, clockLabel, ranked, streak,
  closesAt = null, todayRows = null, userId = null,
}) {
  // THE HOOK COMES BEFORE THE EARLY RETURN - React's own rule, and an
  // eslint error otherwise (a conditional useState call). copied/setCopied
  // is unused on the infeasible-grade path, harmlessly.
  const [copied, setCopied] = useState(false);
  if (!grade.ok) {
    return <div style={{ padding: 24 }}>This board has no feasible grade: {grade.reason}.</div>;
  }
  const story = boardStory(grade, play.used.size, teams.length, clockLabel);
  // D2: the glyph row, score, pct and streak, as text - the copy-to-
  // clipboard target. Streak is OMITTED, never shown as 0 or "-", when the
  // caller has no streak context (practice, or a page that never computed
  // one) - a missing fact is left out, not guessed at.
  const shareText = [
    grade.glyph,
    `${ranked ? edition : 'Practice'} · ${year}`,
    `${grade.mine.toLocaleString()} pts · ${grade.pct}%${streak != null ? ` · streak ${streak}` : ''}`,
    SHARE_URL,
  ].join('\n');
  // THE SHARE SHEET, NOT JUST THE CLIPBOARD (relay 6 item 2). This was
  // clipboard-only, which was defensible while the button said "Copy" -
  // it is not once the button says "Share your board". On a phone that
  // label promises the OS share sheet, and every other game in the product
  // already opens it: components/games/ShareGrade.js does exactly this and
  // the Weekly, the Draft and Pick'em all go through it. The Daily kept its
  // own inline copy because it predates that module.
  //
  // Clipboard stays as the fallback, and it is reached two ways: no
  // navigator.share at all (desktop), or a share that throws mid-call
  // (cancelled, or refused). The tap never does nothing.
  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ text: shareText });
        return;
      } catch {
        // Cancelled or unsupported mid-call - fall through to the clipboard.
      }
    }
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard permission denied or unavailable - the text is still
      // visible on screen to select by hand, so this fails silently.
    }
  };

  return (
    <>
      <header className="sbd-hdr">
        <span className="sbd-ed">{edition}</span>
        {/* STREAK, IN THE HEADER, NEVER BURIED (spec §6) - only for ranked
            play with a real streak; practice/preview show the clock alone. */}
        {ranked && streak != null ? <span className="sbd-streak">🔥 {streak} day{streak === 1 ? '' : 's'}</span> : null}
        <span className="sbd-clock">{clockLabel}</span>
      </header>

      {/* THE SHARE, ABOVE THE ROWS (relay 6 item 2). It used to sit under
          the grade rows, the story and the leaderboard - past everything, on
          a screen whose whole point is a result worth showing somebody. The
          glyph row IS the summary, so putting it directly under the header
          reads as: here is your board, here is how it went, send it.

          The card's own shapes are unchanged: .sbd-share and .sbd-g are
          byte-identical to .share and .g in docs/design/daily-full-mock-v3
          (18px, .09em, 1.5), so the glyph row is already the mock's size and
          moving it did not resize it. */}
      <div className="sbd-share">
        <div className="sbd-g">{grade.glyph}</div>
        <div className="sbd-cap">
          {ranked ? edition : 'Practice'} · {year}<br />
          {grade.mine.toLocaleString()} pts · {grade.pct}% · {clockLabel}<br />
          {SHARE_URL}
        </div>
        <button type="button" className="sbd-copy" onClick={handleShare}>
          {copied ? 'Copied' : 'Share your board'}
        </button>
      </div>

      <div className="sbd-grade">
        <div className="sbd-grade-top">
          <b>{year}</b>
          <span>{grade.mine.toLocaleString()} pts · {grade.pct}% of {grade.perfect.toLocaleString()}</span>
        </div>
        <div className="sbd-colhead">
          <div className="sbd-cy">You</div>
          <div className="sbd-cb">Best roster</div>
        </div>
        {grade.rows.map((r, i) => <GradeRow key={i} row={r} />)}
      </div>

      <div className="sbd-mathline">
        {grade.pointsLeft === 0
          ? 'You matched the best roster this board allowed.'
          : <>{grade.matchedCount} of {grade.slotCount} matched · <b>{grade.pointsLeft.toLocaleString()}</b> points left on the board.</>}
      </div>

      <div className="sbd-perf">
        <b>The best roster this board allowed</b>
        <p>
          {grade.bestRosterAbbrs.join(' · ')}
          <br />{grade.slotCount} teams, {grade.slotCount} players, {grade.perfect.toLocaleString()} points. No team appears twice.
        </p>
      </div>

      <div className="sbd-story">
        <b>About your board</b>
        <p>{story}</p>
      </div>

      {/* D1: BEFORE CLOSE, THE TODAY BOARD IS NOT RENDERED ANYWHERE - just
          this line. AFTER CLOSE (todayRows passed), the real Today board
          renders in its place, your row highlighted.

          ONE TIME ZONE, NOT TWO (relay 3b item 2). This line used to state
          the same instant twice - "3:00 AM ET (12:00 AM your time)" - which
          is the exact thing item 2 rules out, and the "your time" half was
          a bare toLocaleString() inside a client component: during SSR that
          formats in the SERVER's zone (UTC on Vercel) and then changes on
          hydration, which is a real mismatch, not just an inconsistency.
          StandaloneTime is ET until mount and the viewer's own zone after,
          identical bytes on both sides of hydration. "Midnight" stays
          because the Daily's close is DEFINED as midnight ET - that is the
          rule, and the timestamp beside it is now what it means locally. */}
      {todayRows == null ? (
        closesAt ? (
          <div className="sbd-mid-wait">
            Leaderboard at midnight ET · <StandaloneTime iso={closesAt} /> your time
          </div>
        ) : null
      ) : (
        <div className="sbd-lb">
          <div className="sbd-lb-h"><span>Today</span><span>{todayRows.length} played</span></div>
          {todayRows.map((r) => (
            <div key={r.userId} className={`sbd-lr${userId != null && Number(r.userId) === Number(userId) ? ' sbd-lr--you' : ''}`}>
              <span className="sbd-lr-rk">{r.rank}</span>
              <span className="sbd-lr-who">{r.handle}</span>
              <span className="sbd-lr-sc">{r.primary.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}

      {/* E3: the one leaderboards hook this relay adds - the rest of the
          spec's home screen (section 6) is not built here. */}
      <Link className="sbd-lbd-link" href="/daily/leaderboards">See the leaderboards →</Link>
    </>
  );
}

function GradeRow({ row }) {
  const cls = row.hit ? 'sbd-hit' : row.ahead ? 'sbd-ahead' : 'sbd-miss';
  const verdict = row.hit ? 'MATCHED' : row.ahead ? 'YOU WERE AHEAD' : 'MISSED';
  const diff = row.hit ? '✓' : row.ahead
    ? `+${Math.round(Math.abs(row.you.points - row.best.points) * 10) / 10}`
    : `-${Math.round((row.best.points - (row.you?.points ?? 0)) * 10) / 10}`;
  // ALWAYS your own slot, never the literal string "SWAP" - the verdict
  // pill already says whether it matched, so this row's position label can
  // just say which of YOUR eight slots it is (ruling): the same identity
  // the roster row already showed for this pick, glyph included.
  const poslab = row.you?.slot ?? row.best.slot;

  return (
    <div className={`sbd-sbr ${cls}`}>
      <div className="sbd-top2">
        <span className="sbd-pos">{SLOT_EMOJI[poslab] ?? ''} {poslab}</span>
        <span className="sbd-vd">{verdict}</span>
        <span className="sbd-dif">{diff}</span>
      </div>
      <div className="sbd-two">
        {row.you?.name != null
          ? <GradeBox p={row.you} cls="sbd-you" />
          : <div className="sbd-bx sbd-you sbd-empty"><div>empty slot</div><div>0</div></div>}
        {row.hit ? (
          <div className="sbd-bx sbd-same">
            <div className="sbd-tick">✓</div>
            <div className="sbd-sm">same pick</div>
          </div>
        ) : <GradeBox p={row.best} cls="sbd-best" />}
      </div>
      {row.moved ? (
        <div className="sbd-swap">You had him at {row.moved}. Same player, same points - it counts.</div>
      ) : null}
    </div>
  );
}

function GradeBox({ p, cls }) {
  if (!p) {
    return (
      <div className={`sbd-bx ${cls}`}>
        <div className="sbd-nm" style={{ color: 'var(--muted-dim, #5A5A56)' }}>nobody</div>
        <div className="sbd-mt">&nbsp;</div>
        <div className="sbd-pt" style={{ color: 'var(--muted-dim, #5A5A56)' }}>0</div>
      </div>
    );
  }
  return (
    <div className={`sbd-bx ${cls}`}>
      <div className="sbd-nm">{p.name}</div>
      <div className="sbd-mt">{p.abbr} · {p.meta}</div>
      <div className="sbd-pt">{p.points}</div>
    </div>
  );
}
