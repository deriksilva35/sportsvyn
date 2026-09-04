/**
 * /daily/board — the season-roster board's own surface (Step 3/4/5a).
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
 * THE GUARDING BRANCH (5a): no ?season -> today's real, FROZEN, STORED
 * edition via ensureBoardForDate() (lib/daily/seasonBoardEditions.js) -
 * `boardId` is passed down, because that id is what a run submission
 * (app/api/daily/board/run) references. ?season=YYYY -> the PREVIEW path,
 * UNCHANGED from Step 3/4: a fresh board generated in-request, never written
 * to daily_boards, so `boardId` is never passed. A run can only ever be
 * inserted against a real daily_boards.id (the table's own FK), so a preview
 * session has no id to submit against - there is nothing further this route
 * needs to do to keep a preview run from writing; the id it would need
 * simply does not exist for that path.
 *
 * No win-loss source exists for any season (Step 2 finding) - team chips
 * show no record on either path, because there is nothing real to put there.
 */

import { sql } from '@/lib/db';
import { generateBoard } from '@/lib/daily/boardGenerator';
import { makeRng } from '@/lib/daily/pool';
import { SLOTS } from '@/lib/daily/boardShape';
import { todayEt } from '@/lib/daily/entries';
import { ensureBoardForDate, metaFor } from '@/lib/daily/seasonBoardEditions';
import SeasonBoard from '@/components/daily/season/SeasonBoard';

export const dynamic = 'force-dynamic';

export default async function SeasonBoardPage({ searchParams }) {
  const sp = await searchParams;
  const seasonParam = Number(sp?.season) || null;

  if (!seasonParam) {
    const editionDate = await todayEt();
    const board = await ensureBoardForDate(sql, editionDate);
    return (
      <SeasonBoard
        edition={`The Daily · ${editionDate}`}
        year={String(board.season_year)}
        teams={board.board}
        slots={SLOTS}
        ranked
        boardId={board.id}
      />
    );
  }

  const season = seasonParam;
  const rows = await sql`
    SELECT team_key, position, raw_name, pass_yds, pass_td, pass_int, rush_yds, rush_td,
           rec, rec_yds, rec_td, fumbles_lost, fgm, fga, xp, sacks, def_int, def_td
    FROM nfl_player_season_totals WHERE season_year = ${season}`;

  // Seeded from the season alone, not Date.now() - deterministic per
  // request, matching pool.js's seedFor() convention (a board is a function
  // of its seed, not of when the page happened to load). PREVIEW ONLY -
  // never written to daily_boards, never scored server-side, no run can
  // reference it (see the guarding-branch note above).
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
