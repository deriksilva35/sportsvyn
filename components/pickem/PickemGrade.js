/**
 * components/pickem/PickemGrade.js - Pick'em's settled grade card
 * (relay 2b item 4), per docs/design/games-remock-v2.html's #s-pickem .g
 * screen: '{correct} of {played} · {pct}%' mid line, a glyph row (🟩 right,
 * ⬛ wrong, ⬜ tie or void), rows for every picked game with the winner's score
 * line, the math line naming faded ranked favourites, the board
 * leaderboard, Share (reusing item 2's ShareGrade), and a forward-looking
 * ghost line.
 */

import ShareGrade from '@/components/games/ShareGrade';
import { HouseMark } from '@/components/house/HouseTag';
import '@/components/house/house.css';
import {
  pickemGradeRows, fadedFavourites, pickemMathline, pickemGlyphRow, NOBODY_COPY,
} from '@/lib/pickem/settledGrade';
import StandaloneDateOnly from '@/components/StandaloneDateOnly';
import StandaloneDate from '@/components/StandaloneDate';
import { plural } from '@/lib/text/plural';
import BoardChips from '@/components/boards/BoardChips';

const VD_LABEL = { right: 'Right', wrong: 'Wrong', tie: 'Tie', void: 'Void' };

export default function PickemGrade({
  view, sport, settledAtIso, leaderboard, next, nextBoardNumber, userId,
  chips = [], leagueName = null,
}) {
  const rows = pickemGradeRows(view.games);
  // A TIE AND A VOID COUNT FOR NOBODY (rulings P4 and 2): they are out of
  // `played`, so the percentage is right over the games that had a winner.
  const { right, wrong, tie, void: voided } = pickemMathline(rows);
  const played = right + wrong;
  const pct = played ? Math.round((right / played) * 1000) / 10 : 0;
  const { faded, hadThem } = fadedFavourites(view.games);
  const glyph = pickemGlyphRow(rows);

  // A CONFIDENCE BOARD (ruling tue-7): points first, record second, every game a
  // row with what it scored. conf is view.confidence, null on a regular board.
  const conf = view.confidence?.points != null ? view.confidence : null;
  const confRows = conf
    ? [...view.games].sort((a, b) => (b.my_rank ?? 0) - (a.my_rank ?? 0))
    : [];
  const confRecord = conf ? `${conf.correct}-${conf.played - conf.correct}` : null;

  const myRow = leaderboard.top.find((r) => r.userId === userId) ?? leaderboard.self ?? null;

  // NO ENTRY MEANS NO GRADE (relay 2b-fix item 2). A reader who never
  // picked this board has nothing to grade, and "0 of 0 · 0%" is not a
  // result - it is a scoreline invented for somebody who did not play.
  // pickemGradeRows() only ever emits rows for games this viewer actually
  // picked, so an empty rows array IS "no entry", signed in or out.
  const entered = rows.length > 0;

  // THE BOARD'S OWN RESULT, for a reader with no entry to have come for:
  // how the slate actually went, which is a board-wide fact carrying
  // nobody's picks (the same class as the rank/record chips the living
  // board already shows every reader).
  const finals = view.games.filter((g) => g.status === 'final');

  return (
    <>
      <header className="gg-hdr">
        <span className="gg-ed">Pick&rsquo;em &middot; Board {view.contest.boardNumber} &middot; {sport.toUpperCase()}</span>
        <span className="gg-clock">settled <StandaloneDate iso={settledAtIso} /></span>
      </header>

      {!entered && (
        <div className="gg-perf">
          <b>How this board went</b>
          <p>
            {plural(finals.length, 'game')} played
            {faded > 0 && <> &middot; {faded} ranked {faded === 1 ? 'favourite' : 'favourites'} lost</>}
            <br />
            You did not pick this board.
          </p>
        </div>
      )}

      {conf && (
        <div className="cfd-grade" data-scoring="confidence">
          <div className="cfd-grade-pts n">{conf.points}<small>of {conf.max}</small></div>
          <p className="cfd-grade-line">
            {confRecord}
            {conf.beatPct != null && <> &middot; beat {conf.beatPct}% of the field</>}
          </p>
          {conf.voidCount > 0 && (
            <p className="cfd-grade-void">
              {conf.voidCount === 1 ? 'One game postponed' : `${plural(conf.voidCount, 'game')} postponed`}, so its {conf.voidPoints} came off your max.
            </p>
          )}
          <div style={{ marginTop: 8 }}>
            {confRows.map((g) => {
              const you = g.my_side === 'home' ? g.home : g.my_side === 'away' ? g.away : null;
              return (
                <div className="cfd-gr" key={g.match_id} data-points={g.void ? 'void' : (g.my_points ?? 0)}>
                  <div className="cfd-rk n">{g.my_rank}</div>
                  <div className="cfd-gr-nm">
                    {g.away} @ {g.home}
                    <small>{you ? `you: ${you}` : 'no pick'}</small>
                  </div>
                  {g.void
                    ? <span className="cfd-pts v">void</span>
                    : <span className={`cfd-pts ${g.my_points > 0 ? 'j' : 't'} n`}>{g.my_points > 0 ? `+${g.my_points}` : '0'}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {entered && !conf && (
      <div className="gg-grade">
        <div className="gg-grade-top">
          <b>Board {view.contest.boardNumber}</b>
          <span>{right} of {played} &middot; {pct}%</span>
        </div>
        <div className="gg-colhead"><div className="gg-cy">You</div><div className="gg-cb">Result</div></div>
        {rows.map((r) => (
          <div className={`gg-sbr gg-${r.verdict === 'right' ? 'hit' : r.verdict === 'wrong' ? 'miss' : 'push'}`} data-verdict={r.verdict} key={r.matchId}>
            <div className="gg-top2">
              <span className="gg-pos">{VD_LABEL[r.verdict]}</span>
              <span className="gg-vd">{VD_LABEL[r.verdict]}</span>
            </div>
            <div className="gg-two">
              <div className="gg-bx gg-you">
                <div className="gg-nm">{r.you}{r.youRank != null && <> &middot; #{r.youRank}</>}</div>
                <div className="gg-pt">{r.verdict === 'right' ? 'W' : r.verdict === 'wrong' ? 'L' : '-'}</div>
              </div>
              <div className="gg-bx">
                <div className="gg-nm">{r.winner ?? (r.verdict === 'tie' ? 'No winner' : 'Not played')}</div>
                <div className="gg-mt">{NOBODY_COPY[r.verdict] ?? r.winnerScore}{r.verdict === 'tie' && r.winnerScore ? <> &middot; {r.winnerScore}</> : null}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
      )}

      {entered && !conf && (
        <div className="gg-mathline">
          {right} right &middot; {wrong} wrong
          {tie > 0 && <> &middot; {tie} tied, counted for nobody</>}
          {voided > 0 && <> &middot; {voided} void, counted for nobody</>}
          {faded > 0 && <> &middot; <b>{faded} ranked favourites lost</b>, you had {hadThem} of them.</>}
        </div>
      )}

      {/* NATIONAL + THE READER'S LEAGUES (components/boards/BoardChips.js, the
          Weekly/Draft row). A league view is this board's members only, ranked
          among themselves - the header names the league so a place is never
          read as a national one. */}
      <BoardChips chips={chips} embed style={{ margin: '12px 12px 0', width: 'auto' }} />
      <div className="gg-lb">
        <div className="gg-lb-h"><span>{leagueName ?? `Board ${view.contest.boardNumber}`}</span><span>{leaderboard.played} played</span></div>
        {leaderboard.top.map((r) => (
          <div className={`gg-lr${myRow && r.userId === myRow.userId ? ' gg-lr--you' : ''}`} key={r.userId}>
            <span className="gg-lr-rk">{r.rank}</span>
            <span className="gg-lr-who">{myRow && r.userId === myRow.userId ? 'you' : r.name}<HouseMark row={r} /></span>
            <span className="gg-lr-sc">{leaderboard.confidence && r.max != null ? `${r.score} of ${r.max}` : r.score}</span>
          </div>
        ))}
        {leaderboard.self && (
          <div className="gg-lr gg-lr--you">
            <span className="gg-lr-rk">{leaderboard.self.rank}</span>
            <span className="gg-lr-who">you</span>
            <span className="gg-lr-sc">{leaderboard.confidence && leaderboard.self.max != null ? `${leaderboard.self.score} of ${leaderboard.self.max}` : leaderboard.self.score}</span>
          </div>
        )}
      </div>

      {entered && (
        <ShareGrade
          glyph={glyph}
          // THE SHARE CARD CARRIES THE NATIONAL PLACE ONLY: "2 of 3" from a
          // league view would read as a place on the whole board.
          caption={`Pick'em Board ${view.contest.boardNumber} · ${conf ? `${conf.points} of ${conf.max} · ${confRecord}` : `${right} of ${played} · ${pct}%`}${myRow?.rank && leaderboard.played > 1 && !leaderboard.league ? ` · ${myRow.rank} of ${leaderboard.played}` : ''}`}
          url={`sportsvyn.com/pickem/${sport}`}
        />
      )}

      {next && (
        <div className="gg-mathline">
          Board {nextBoardNumber} opens <StandaloneDateOnly iso={next.opensAt} />
        </div>
      )}
    </>
  );
}
