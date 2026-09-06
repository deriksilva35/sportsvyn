/**
 * components/pickem/PickemGrade.js - Pick'em's settled grade card
 * (relay 2b item 4), per docs/design/games-remock-v2.html's #s-pickem .g
 * screen: '{correct} of {played} · {pct}%' mid line, a glyph row (🟩 right,
 * ⬛ wrong, ⬜ push), rows for every picked game with the winner's score
 * line, the math line naming faded ranked favourites, the board
 * leaderboard, Share (reusing item 2's ShareGrade), and a forward-looking
 * ghost line.
 */

import ShareGrade from '@/components/games/ShareGrade';
import {
  pickemGradeRows, fadedFavourites, pickemMathline, pickemGlyphRow,
} from '@/lib/pickem/settledGrade';
import StandaloneDateOnly from '@/components/StandaloneDateOnly';

const VD_LABEL = { right: 'Right', wrong: 'Wrong', push: 'Push' };

export default function PickemGrade({
  view, sport, settledAtLabel, leaderboard, next, nextBoardNumber, userId,
}) {
  const rows = pickemGradeRows(view.games);
  const { right, wrong, push } = pickemMathline(rows);
  const played = right + wrong + push;
  const pct = played ? Math.round((right / played) * 1000) / 10 : 0;
  const { faded, hadThem } = fadedFavourites(view.games);
  const glyph = pickemGlyphRow(rows);

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
        <span className="gg-clock">settled {settledAtLabel}</span>
      </header>

      {!entered && (
        <div className="gg-perf">
          <b>How this board went</b>
          <p>
            {finals.length} games played
            {faded > 0 && <> &middot; {faded} ranked {faded === 1 ? 'favourite' : 'favourites'} lost</>}
            <br />
            You did not pick this board.
          </p>
        </div>
      )}

      {entered && (
      <div className="gg-grade">
        <div className="gg-grade-top">
          <b>Board {view.contest.boardNumber}</b>
          <span>{right} of {played} &middot; {pct}%</span>
        </div>
        <div className="gg-colhead"><div className="gg-cy">You</div><div className="gg-cb">Result</div></div>
        {rows.map((r) => (
          <div className={`gg-sbr gg-${r.verdict === 'right' ? 'hit' : r.verdict === 'wrong' ? 'miss' : 'push'}`} key={r.matchId}>
            <div className="gg-top2">
              <span className="gg-pos">{VD_LABEL[r.verdict]}</span>
              <span className="gg-vd">{VD_LABEL[r.verdict]}</span>
            </div>
            <div className="gg-two">
              <div className="gg-bx gg-you">
                <div className="gg-nm">{r.you}{r.youRank != null && <> &middot; #{r.youRank}</>}</div>
                <div className="gg-pt">{r.verdict === 'push' ? '-' : r.verdict === 'right' ? 'W' : 'L'}</div>
              </div>
              <div className="gg-bx">
                <div className="gg-nm">{r.winner ?? 'Cancelled'}</div>
                <div className="gg-mt">{r.winnerScore ?? 'off the board'}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
      )}

      {entered && (
        <div className="gg-mathline">
          {right} right &middot; {wrong} wrong &middot; {push} push
          {faded > 0 && <> &middot; <b>{faded} ranked favourites lost</b>, you had {hadThem} of them.</>}
        </div>
      )}

      <div className="gg-lb">
        <div className="gg-lb-h"><span>Board {view.contest.boardNumber}</span><span>{leaderboard.played} played</span></div>
        {leaderboard.top.map((r) => (
          <div className={`gg-lr${myRow && r.userId === myRow.userId ? ' gg-lr--you' : ''}`} key={r.userId}>
            <span className="gg-lr-rk">{r.rank}</span>
            <span className="gg-lr-who">{myRow && r.userId === myRow.userId ? 'you' : r.name}</span>
            <span className="gg-lr-sc">{r.score}</span>
          </div>
        ))}
        {leaderboard.self && (
          <div className="gg-lr gg-lr--you">
            <span className="gg-lr-rk">{leaderboard.self.rank}</span>
            <span className="gg-lr-who">you</span>
            <span className="gg-lr-sc">{leaderboard.self.score}</span>
          </div>
        )}
      </div>

      {entered && (
        <ShareGrade
          glyph={glyph}
          caption={`Pick'em Board ${view.contest.boardNumber} · ${right} of ${played} · ${pct}%${myRow?.rank ? ` · ${myRow.rank} of ${leaderboard.played}` : ''}`}
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
