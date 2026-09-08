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
 * COMMIT-ON-OPEN, NO CLOSE (ruling), enforced structurally, not just by
 * omission: the backdrop and the sheet itself carry NO onClick that could
 * dismiss them while a team is open or a slot choice is pending. The only
 * way out of `sheetState !== 'closed'` is finishPick(), which requires a
 * fully-formed slot index - there is no code path that clears sheetState
 * without one.
 *
 * THE SHEET IS A PORTAL TO document.body, not rendered in normal flow.
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
  pickOutcome, commitPick, startClock as canStartClock,
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
// K shoe. No TE entry - this board's shape has no TE slot, only FLEX.
const SLOT_EMOJI = { QB: '\u{1F3AF}', RB: '\u{1F3C3}', WR: '\u{1F932}', FLEX: '\u{1F504}', K: '\u{1F45F}' };

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
  // sheetState: 'closed' | { mode:'team', teamKey } | { mode:'slot', teamKey, player, slotIndexes }
  const [sheetState, setSheetState] = useState('closed');
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

  const openTeam = (team) => {
    if (teamIsDead(play, team)) return; // a dead chip has pointer-events:none too - this is the belt under the suspenders
    setSheetState({ mode: 'team', teamKey: team.key });
  };

  const choosePlayer = (team, player) => {
    const outcome = pickOutcome(play, player);
    if (!outcome.ok) return; // NO SLOT rows are already inert; unreachable from a real tap
    if (outcome.auto) {
      finishPick(team, player, outcome.slotIndex);
      return;
    }
    setSheetState({ mode: 'slot', teamKey: team.key, player, slotIndexes: outcome.slotIndexes });
  };

  const finishPick = (team, player, slotIndex) => {
    const slotPos = play.slots[slotIndex];
    setPlay((p) => commitPick(p, team, player, slotIndex));
    setSheetState('closed');
    setToast({ name: player.name, slot: slotPos, abbr: team.abbr });
    setTimeout(() => setToast(null), 1500);
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

  const openTeamObj = sheetState !== 'closed' ? teams.find((t) => t.key === sheetState.teamKey) : null;

  return (
    <div className="sbd">
      <Crumb />
      <header className="sbd-hdr">
        <span className="sbd-ed">{edition}</span>
        <span className={clockClass}>{clockText}</span>
      </header>
      <div className="sbd-yr">
        <h1>{year}</h1>
        <div className="sbd-sub">
          Twelve teams. Eight slots. Open a team and you must take someone -
          there is no backing out.
        </div>
      </div>
      {complete ? <div className="sbd-warn">{slots.length} slots filled.</div> : null}

      <div className="sbd-prog">
        <div className="sbd-rrow">
          {play.roster.map((r, i) => (
            <div key={i} className={`sbd-pip${r.pick ? ' sbd-full' : ''}`} title={r.pick ? `${r.pos} - ${r.pick.player.name}` : r.pos}>
              <span className="sbd-em">{SLOT_EMOJI[r.pos] ?? ''}</span>
              <span className="sbd-dot">{DOT_LABEL[r.pos] ?? r.pos}</span>
            </div>
          ))}
        </div>
        <div className="sbd-cap">
          <span>{filled} of {slots.length} filled</span>
          <span>{left} team{left === 1 ? '' : 's'} left</span>
        </div>
      </div>

      <div className="sbd-needline">
        {complete ? 'Roster complete.' : <>Still need <b>{needPositions.join(' · ')}</b></>}
      </div>

      <div className="sbd-secl">
        <b>Teams</b>
        <span>{teams.length - slots.length} go unused</span>
      </div>

      <div className="sbd-chips">
        {teams.map((t) => {
          const dead = teamIsDead(play, t);
          return (
            <button key={t.key} type="button" className={`sbd-tc${dead ? ' sbd-dead' : ''}`}
              disabled={dead} onClick={() => openTeam(t)}>
              <b>{t.abbr}</b>
              <small>{t.record}</small>
            </button>
          );
        })}
      </div>

      {complete ? (
        <button type="button" className="sbd-btn" onClick={handleFinish} disabled={finishing}>
          {finishing ? 'Submitting…' : 'See your grade'}
        </button>
      ) : null}

      {/* A FAILED SUBMIT DOES NOT COST THE RUN. The board above is still
          rendered with every pick in place, the button is still there, and
          this says what happened. The screen has not flipped, so no grade the
          server did not store is on display. */}
      {finishError ? (
        <div className="sbd-warn" style={{ margin: '10px 12px 0' }} role="alert">{finishError}</div>
      ) : null}

      {sheetState !== 'closed' && mountNode ? createPortal(
        <>
          {/* NO onClick HERE. The backdrop is inert while a team is open or a
              slot choice is pending - that omission IS the "no way out" rule. */}
          <div className="sbd-back" />
          <div className="sbd-sheet">
            {sheetState.mode === 'team' ? (
              <TeamSheet team={openTeamObj} play={play} onChoose={(player) => choosePlayer(openTeamObj, player)} />
            ) : (
              <SlotChoiceSheet
                team={teams.find((t) => t.key === sheetState.teamKey)}
                player={sheetState.player}
                slotIndexes={sheetState.slotIndexes}
                slots={play.slots}
                onPick={(slotIndex) => finishPick(teams.find((t) => t.key === sheetState.teamKey), sheetState.player, slotIndex)}
              />
            )}
          </div>
        </>,
        mountNode,
      ) : null}

      {toast && mountNode ? createPortal(
        <div className="sbd-toast">
          <b>{toast.name}</b>
          <p>{toast.slot} locked · {toast.abbr} spent</p>
        </div>,
        mountNode,
      ) : null}
    </div>
  );
}

function TeamSheet({ team, play, onChoose }) {
  return (
    <div>
      <div className="sbd-sh">
        <b>{team.abbr} · {team.record ?? '—'}</b>
        <span>you must take one player</span>
      </div>
      {team.card.map((p, i) => {
        const gone = pickOutcome(play, p).ok === false;
        return (
          <button key={i} type="button" className={`sbd-pr${gone ? ' sbd-gone' : ''}`}
            disabled={gone} onClick={() => onChoose(p)}>
            <span className="sbd-pos">{SLOT_EMOJI[p.position] ?? ''} {p.position}</span>
            <span className="sbd-nm"><b>{p.name}</b><small>{p.meta}</small></span>
            <span className="sbd-tk">{gone ? 'NO SLOT' : 'TAKE'}</span>
          </button>
        );
      })}
    </div>
  );
}

function SlotChoiceSheet({ team, player, slotIndexes, slots, onPick }) {
  return (
    <div>
      <div className="sbd-sh">
        <b>{player.name}</b>
        <span>{team.abbr} · {player.meta}</span>
      </div>
      <div className="sbd-slotq">
        <p>Where does he go? <b>This locks the slot and spends {team.abbr}.</b></p>
        <div className="sbd-slotbtns">
          {slotIndexes.map((s) => (
            <button key={s} type="button" className="sbd-slotbtn" onClick={() => onPick(s)}>{slots[s]}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The rules card. Four numbered lines, then the ranked-or-not line. THE
 * CLOCK STARTS HERE, not on the first team tap - onStart is the only thing
 * that calls startClock.
 *
 * SIGN-IN IN PLACE OF START (5b, edition path only): when signInHref is
 * set, the card renders exactly as before through every rule line, and
 * ONLY the button at the bottom changes - a sign-in link, dest back to
 * /daily/board, instead of Start. The clock cannot start signed out
 * (lib/daily/seasonBoardPlay.js's startClock), and this is the reason it's
 * unreachable: there is no Start button to tap.
 */
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
          <p>Twelve team cards. Tap one and you are committed - you must take somebody from it, and then that team is spent.</p>
        </div>
      </div>
      <div className="sbd-rl">
        <span className="sbd-n">2</span>
        <div className="sbd-t">
          <b>You choose the slot</b>
          <p>Take a back and decide whether he fills RB or FLEX. The slot locks with the pick.</p>
        </div>
      </div>
      <div className="sbd-rl">
        <span className="sbd-n">3</span>
        <div className="sbd-t">
          <b>{slotCount === 8 ? 'Eight' : slotCount} slots, {unused} team{unused === 1 ? '' : 's'} unused</b>
          <p>Choosing which teams to skip is part of it. Scoring is season fantasy points, PPR.</p>
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
          ? 'Sign in to start the clock. One attempt - this board is ranked.'
          : ranked
            ? 'Three minutes from Start. The clock is on the server. One attempt - this board is ranked.'
            : 'Three minutes from Start. Practice is unranked and touches no leaderboard.'}
      </div>

      {signInHref ? (
        <a className="sbd-btn" style={{ marginTop: 16, textDecoration: 'none', textAlign: 'center' }} href={signInHref}>Sign in to play</a>
      ) : (
        <>
          <button type="button" className="sbd-btn" style={{ marginTop: 16 }} onClick={onStart} disabled={starting}>
            {starting ? 'Starting…' : 'Start'}
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
