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
import {
  initBoardPlay, teamIsDead, isRosterComplete, filledCount, teamsLeft,
  pickOutcome, commitPick,
} from '@/lib/daily/seasonBoardPlay';
import { gradeBoard, boardStory } from '@/lib/daily/seasonBoardGrade';
import './seasonBoard.css';

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

/**
 * @param edition   "The Daily · No. 020"
 * @param year      "2017"
 * @param teams     [{ key, abbr, record, card:[{position, name, meta, points}] }]
 * @param slots     ['QB','RB','RB','WR','WR','FLEX','FLEX','K'] - see boardShape.js
 * @param ranked    true for the Daily itself, false for practice
 */
export default function SeasonBoard({ edition, year, teams, slots, ranked }) {
  const [screen, setScreen] = useState('rules'); // 'rules' | 'board' | 'grade'
  const [play, setPlay] = useState(() => initBoardPlay(teams, slots));
  // sheetState: 'closed' | { mode:'team', teamKey } | { mode:'slot', teamKey, player, slotIndexes }
  const [sheetState, setSheetState] = useState('closed');
  const [toast, setToast] = useState(null);
  const [startedAt, setStartedAt] = useState(null);
  const [nowMs, setNowMs] = useState(null);
  const [finishedMs, setFinishedMs] = useState(null);
  // Lazy initializer, not an effect: SSR has no `document` (null, safely),
  // and the client's first render (hydration) runs this function fresh, so
  // document.body is picked up without a setState-in-effect render cascade.
  const [mountNode] = useState(() => (typeof document !== 'undefined' ? document.body : null));
  const tickRef = useRef(null);

  // THE CLOCK STARTS ON THE RULES CARD'S START, NOT ON THE FIRST TAP. Idempotent:
  // once startedAt is set, calling this again does nothing.
  const startClock = () => {
    if (startedAt) return;
    const t0 = Date.now();
    setStartedAt(t0);
    setNowMs(t0);
    tickRef.current = setInterval(() => setNowMs(Date.now()), 1000);
  };
  useEffect(() => () => clearInterval(tickRef.current), []);

  const handleStart = () => { startClock(); setScreen('board'); };

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

  const handleFinish = () => {
    clearInterval(tickRef.current);
    setFinishedMs(Date.now());
    setScreen('grade');
  };

  const complete = isRosterComplete(play);
  const filled = filledCount(play);
  const left = teamsLeft(play);
  const needPositions = [...new Set(play.roster.filter((r) => !r.pick).map((r) => r.pos))];

  if (screen === 'rules') {
    return (
      <div className="sbd">
        <RulesCard
          edition={edition} year={year} slotCount={slots.length} teamCount={teams.length}
          ranked={ranked} onStart={handleStart}
        />
      </div>
    );
  }

  if (screen === 'grade') {
    const grade = gradeBoard(play, teams, slots);
    // finishedMs is always set by handleFinish() before screen flips to
    // 'grade' - there is no other path here, so no impure now-fallback.
    const clockLabel = mmss(finishedMs - startedAt);
    return (
      <div className="sbd">
        <GradeScreen edition={edition} year={year} grade={grade} play={play} teams={teams} clockLabel={clockLabel} ranked={ranked} />
      </div>
    );
  }

  const openTeamObj = sheetState !== 'closed' ? teams.find((t) => t.key === sheetState.teamKey) : null;

  return (
    <div className="sbd">
      <header className="sbd-hdr">
        <span className="sbd-ed">{edition}</span>
        <span className="sbd-clock">{startedAt ? mmss(nowMs - startedAt) : '0:00'}</span>
      </header>
      <div className="sbd-yr">
        <h1>{year}</h1>
        <div className="sbd-sub">
          Twelve teams. Eight slots. Open a team and you must take someone -
          there is no backing out.
        </div>
      </div>
      <div className="sbd-warn">
        {complete ? `${slots.length} slots filled.` : 'Open a team and you must take someone. No backing out.'}
      </div>

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
        <button type="button" className="sbd-btn" onClick={handleFinish}>See your grade</button>
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
 */
function RulesCard({ edition, year, slotCount, teamCount, ranked, onStart }) {
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
        {ranked
          ? 'The clock starts when you tap Start. One attempt - this board is ranked.'
          : 'The clock starts when you tap Start. Practice is unranked and touches no leaderboard.'}
      </div>

      <button type="button" className="sbd-btn" style={{ marginTop: 16 }} onClick={onStart}>Start</button>
    </div>
  );
}

/**
 * The grade (Part A / Step 4). Set-match already happened in gradeBoard() -
 * this component only formats what it is handed. Column order (You left,
 * Best roster right) and row order (matched rows first, in the solver's own
 * slot order, then swap rows) match the mock exactly.
 */
function GradeScreen({ edition, year, grade, play, teams, clockLabel, ranked }) {
  if (!grade.ok) {
    return <div style={{ padding: 24 }}>This board has no feasible grade: {grade.reason}.</div>;
  }
  const story = boardStory(grade, play.used.size, teams.length, clockLabel);

  return (
    <>
      <header className="sbd-hdr">
        <span className="sbd-ed">{edition}</span>
        <span className="sbd-clock">{clockLabel}</span>
      </header>

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

      <div className="sbd-share">
        <div className="sbd-g">{grade.glyph}</div>
        <div className="sbd-cap">
          {ranked ? edition : 'Practice'} · {year}<br />
          {grade.mine.toLocaleString()} pts · {grade.pct}% · {clockLabel}<br />
          sportsvyn.com/daily
        </div>
      </div>
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
        <GradeBox p={row.you} cls="sbd-you" />
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
