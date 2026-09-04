/**
 * /daily/board — the season-roster board's own surface (Step 3/4).
 *
 * A NEW, SEPARATE ROUTE, NOT A REPLACEMENT OF /daily. The existing /daily
 * page is a different, already-live game (lib/daily/play.js: guess a mystery
 * player's identity from a six-slot week board, drop-the-worst PPR scoring).
 * This route is the twelve-team, eight-slot season-roster board Step 2 built
 * the generator and solver for. Whether this eventually REPLACES /daily or
 * lives alongside it as its own mode is a product decision this route does
 * not make - it exists so Step 3's mechanic can be verified at a served
 * surface without touching the live game underneath /daily.
 *
 * SERVER COMPONENT, force-dynamic: draws a fresh board on every request from
 * real nfl_player_season_totals rows via lib/daily/boardGenerator.js (Step 2,
 * pure) - the same module the acceptance report (scripts/board-measurements-
 * report.mjs) already exercises against real data. No win-loss source exists
 * for any season (Step 2 finding), so rule (d) stays dropped here too - team
 * chips show no record, because there is nothing real to put there.
 *
 * ?season=YYYY picks the season; defaults to 2023 (full real TE coverage,
 * used throughout Step 2's own measurements) so a plain visit to this route
 * always has something to show.
 */

import { sql } from '@/lib/db';
import { generateBoard } from '@/lib/daily/boardGenerator';
import { makeRng } from '@/lib/daily/pool';
import { SLOTS } from '@/lib/daily/boardShape';
import SeasonBoard from '@/components/daily/season/SeasonBoard';

export const dynamic = 'force-dynamic';

function metaFor(r) {
  switch (r.position) {
    case 'QB': return `${r.pass_yds ?? 0} yds · ${r.pass_td ?? 0} TD`;
    case 'RB': return `${r.rush_yds ?? 0} rush · ${r.rush_td ?? 0} TD`;
    case 'WR':
    case 'TE': return `${r.rec ?? 0} rec · ${r.rec_yds ?? 0} yds · ${r.rec_td ?? 0} TD`;
    case 'PK': return `${r.fgm ?? 0}/${r.fga ?? 0} FG`;
    default: return '';
  }
}

export default async function SeasonBoardPage({ searchParams }) {
  const sp = await searchParams;
  const season = Number(sp?.season) || 2023;

  const rows = await sql`
    SELECT team_key, position, raw_name, pass_yds, pass_td, pass_int, rush_yds, rush_td,
           rec, rec_yds, rec_td, fumbles_lost, fgm, fga, xp, sacks, def_int, def_td
    FROM nfl_player_season_totals WHERE season_year = ${season}`;

  // Seeded from the season alone, not Date.now() - deterministic per
  // request, matching pool.js's seedFor() convention (a board is a function
  // of its seed, not of when the page happened to load).
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
