/**
 * /daily/board — the season-roster board's own surface (Step 3/4/5a/5b).
 *
 * A NEW, SEPARATE ROUTE, NOT A REPLACEMENT OF /daily. The existing /daily
 * page is a different, already-live game (lib/daily/play.js: guess a mystery
 * player's identity from a six-slot week board, drop-the-worst PPR scoring).
 * This route is the twelve-team, eight-slot season-roster board Step 2 built
 * the generator and solver for. Whether this eventually REPLACES /daily or
 * lives alongside it as its own mode is a product decision this route does
 * not make - it exists so the mechanic can be verified at a served surface
 * without touching the live game underneath /daily.
 *
 * SIGN-IN AT START (5b, supersedes 5a's blanket requireSignInInShell): the
 * EDITION PATH ONLY - never the ?season preview - shows the rules card with
 * a sign-in link in place of Start when signed out, on every platform (not
 * a shell-only redirect; there is nowhere for a signed-out web visitor to
 * be redirected FROM here that matters, since the board itself has nothing
 * to hide). The clock cannot start signed out either way - SeasonBoard's own
 * handleStart defers to lib/daily/seasonBoardPlay.js's startClock(userId),
 * the pure gate this UI treatment is a courtesy in front of, not a
 * replacement for.
 *
 * A RETURNING SIGNED-IN USER (5b, A3) lands on their STORED grade, rebuilt
 * server-side via regradeStoredRun() from the run's own picks/board/
 * best_roster - never a fresh board, never re-solved.
 *
 * THE EPOCH GATE (5a): no real edition exists before DAILY_V2_EPOCH
 * (2026-09-08) - isEditionLive() decides this, PURELY, off editionDate alone.
 * Before the epoch, a plain visit falls through to the SAME preview path an
 * explicit ?season=2023 request uses, and ensureBoardForDate is never
 * called - no daily_boards row is created for a date the product has not
 * actually launched on.
 *
 * THE MIDNIGHT REVEAL (5b, D1): once closes_at has passed, the grade screen
 * appends the real Today leaderboard (raw points, your row highlighted) in
 * place of the "leaderboard at midnight" line - see SeasonBoard.js's own
 * GradeScreen for the actual rendering split.
 *
 * No win-loss source exists for any season (Step 2 finding) - team chips
 * show no record on any path, because there is nothing real to put there.
 */

import { auth } from '@/auth';
import { resolveShellMode } from '@/lib/shell/shell';
import { shellSigninHref } from '@/lib/shell/signinHref';
import { sql } from '@/lib/db';
import { generateBoard } from '@/lib/daily/boardGenerator';
import { makeRng } from '@/lib/daily/pool';
import { SLOTS } from '@/lib/daily/boardShape';
import { todayEt } from '@/lib/daily/entries';
import { ensureBoardForDate, isEditionLive, metaFor } from '@/lib/daily/seasonBoardEditions';
import { regradeStoredRun } from '@/lib/daily/seasonBoardRuns';
import { todayLeaderboard, streakLeaderboard } from '@/lib/daily/seasonBoardLeaderboards';
import SeasonBoard from '@/components/daily/season/SeasonBoard';

export const dynamic = 'force-dynamic';

function mmss(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

async function currentStreakFor(userId, editionDate) {
  const rows = await streakLeaderboard(sql, editionDate);
  return rows.find((r) => Number(r.userId) === Number(userId))?.primary ?? null;
}

export default async function SeasonBoardPage({ searchParams }) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const isShell = await resolveShellMode();
  const sp = await searchParams;
  const seasonParam = Number(sp?.season) || null;

  if (!seasonParam) {
    const editionDate = await todayEt();
    if (isEditionLive(editionDate)) {
      const board = await ensureBoardForDate(sql, editionDate);
      const edition = `The Daily · ${editionDate}`;
      const year = String(board.season_year);

      if (userId == null) {
        // A2: the rules card, sign-in in place of Start - every platform,
        // the edition path only. dest back to /daily/board.
        return (
          <SeasonBoard
            edition={edition} year={year} teams={board.board} slots={SLOTS} ranked
            signInHref={shellSigninHref('/daily/board', isShell)}
          />
        );
      }

      // "Closed" is a Postgres now() >= closes_at compare, never Date.now() -
      // both a purity rule (no impure call during a server component's
      // render) and the same discipline the rest of this feature already
      // follows for every other instant comparison.
      const [{ closed }] = await sql`SELECT now() >= ${board.closes_at}::timestamptz AS closed`;
      const existing = (await sql`
        SELECT * FROM daily_board_runs WHERE board_id = ${board.id} AND user_id = ${userId}`)[0] ?? null;

      if (existing) {
        // A3: land on the STORED grade, rebuilt from the run's own picks -
        // never a fresh board, never re-solved.
        const regraded = regradeStoredRun(board, existing.picks, SLOTS);
        const clockLabel = mmss(Number(existing.elapsed_s) * 1000);
        const [streak, todayRows] = await Promise.all([
          currentStreakFor(userId, editionDate),
          closed ? todayLeaderboard(sql, board.id) : Promise.resolve(null),
        ]);
        return (
          <SeasonBoard
            edition={edition} year={year} teams={board.board} slots={SLOTS} ranked userId={userId}
            initialPlay={regraded.play} initialGrade={regraded.grade} initialClockLabel={clockLabel}
            streak={streak} closesAt={board.closes_at} todayRows={todayRows}
          />
        );
      }

      if (closed) {
        // Never played, and the board is closed: the reveal is still public
        // information, but there is no personal grade to show and no run to
        // highlight - the board data itself (season, best roster via a
        // fresh grade against an EMPTY roster) is not meaningful here, so
        // this is the Today leaderboard alone, with no "you" row.
        const [streak, todayRows] = await Promise.all([
          currentStreakFor(userId, editionDate),
          todayLeaderboard(sql, board.id),
        ]);
        return (
          <div className="sbd">
            <header className="sbd-hdr">
              <span className="sbd-ed">{edition}</span>
              {streak != null ? <span className="sbd-streak">🔥 {streak} day{streak === 1 ? '' : 's'}</span> : null}
            </header>
            <div className="sbd-mid-wait" style={{ margin: '16px 12px 0' }}>
              You never opened this board - it closed before you played. See who did:
            </div>
            <div className="sbd-lb">
              <div className="sbd-lb-h"><span>Today</span><span>{todayRows.length} played</span></div>
              {todayRows.map((r) => (
                <div key={r.userId} className="sbd-lr">
                  <span className="sbd-lr-rk">{r.rank}</span>
                  <span className="sbd-lr-who">{r.handle}</span>
                  <span className="sbd-lr-sc">{r.primary.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        );
      }

      // SIGNED IN, OPEN, NEVER PLAYED: normal play.
      const streak = await currentStreakFor(userId, editionDate);
      return (
        <SeasonBoard
          edition={edition} year={year} teams={board.board} slots={SLOTS} ranked userId={userId}
          streak={streak} closesAt={board.closes_at}
        />
      );
    }
    // BEFORE THE EPOCH: fall through to the preview path below exactly as an
    // explicit ?season=2023 request would - no ensureBoardForDate call, no
    // daily_boards row.
  }

  const season = seasonParam ?? 2023;
  const rows = await sql`
    SELECT team_key, position, raw_name, pass_yds, pass_td, pass_int, rush_yds, rush_td,
           rec, rec_yds, rec_td, fumbles_lost, fgm, fga, xp, sacks, def_int, def_td
    FROM nfl_player_season_totals WHERE season_year = ${season}`;

  // Seeded from the season alone, not Date.now() - deterministic per
  // request, matching pool.js's seedFor() convention (a board is a function
  // of its seed, not of when the page happened to load). PREVIEW ONLY -
  // never written to daily_boards, never scored server-side, no run can
  // reference it, never sign-in-gated (see the header note above).
  const draw = generateBoard(rows, makeRng(`board-preview-${season}`));
  if (!draw.ok) {
    return (
      <div style={{ padding: 24, color: 'var(--paper, #F5F5F2)' }}>
        Season {season} could not draw a board: {draw.reason}.
      </div>
    );
  }

  // The generator's card entries carry the raw season_totals fields plus
  // `points` (buildCard already scored them); shape them into what
  // SeasonBoard needs to render, and nothing more - team_key is already the
  // abbreviation Step 2's team-key resolution produced.
  const teams = draw.teams.map((t) => ({
    key: t.key,
    abbr: t.key,
    record: null, // no win-loss source exists for any season (Step 2 finding) - never fabricated
    card: t.card.map((p) => ({
      position: p.position,
      name: p.raw_name,
      meta: metaFor(p),
      points: p.points,
    })),
  }));

  return (
    <SeasonBoard
      edition={`The Daily · Season ${season} preview`}
      year={String(season)}
      teams={teams}
      slots={SLOTS}
      ranked={false}
    />
  );
}
