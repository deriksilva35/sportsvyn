/**
 * /ucl/standings - the Champions League's league-phase table (fri-3),
 * mirroring /epl/standings: the stored document (leagues.metadata.standings
 * on the 'ucl' row, written by the epl-standings cron), never the provider.
 *
 * ONE TABLE OF 36, banded by the competition's rule (lib/soccer/leagues.js
 * uclBand): 1-8 to the round of 16, 9-24 to the knockout play-off, 25-36 out.
 * The arcade table is components/soccer/UclTableArcade.js; the dark page
 * below the branch draws the EPL dark table's rows (app/epl/standings's CSS,
 * unchanged) with the same bands as its rails.
 */

import Link from 'next/link';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import { getSoccerStandings } from '@/lib/soccer/standings';
import { uclBand, UCL_BAND_NAME } from '@/lib/soccer/leagues';
import { arcadeFor } from '@/lib/brand/theme';
import { resolveShellMode } from '@/lib/shell/shell';
import BackToAppBar from '@/components/BackToAppBar';
import UclTableArcade from '@/components/soccer/UclTableArcade';
import '@/components/soccer/eplArcade.css';
import '@/components/soccer/uclArcade.css';
import '@/components/gridiron/gridiron.css';
import '@/app/epl/standings/standings.css';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Champions League table - Sportsvyn',
  description: 'The Champions League league phase: played, won, drawn, lost, goal difference, points and form for all 36 clubs.',
};

// The dark table's rails, reused: volt for the round of 16, jade for the play-off.
const DARK_RAIL = { r16: 'ucl', playoff: 'uel' };

export default async function UclStandingsPage() {
  const table = await getSoccerStandings('ucl').catch(() => null);

  const isShell = await resolveShellMode().catch(() => false);
  if (arcadeFor(isShell)) {
    return (
      <>
        <BackToAppBar />
        <GlobalHeaderServer activeNav="scores" />
        <UclTableArcade table={table} />
        <SiteFooter />
      </>
    );
  }

  return (
    <>
      <GlobalHeaderServer activeNav="scores" />
      <main className="gi" data-surface="ink">
        <div className="gi-wrap">
          <div className="gi-kicker">
            <span className="k">Champions League</span>
            <span className="rule" />
            <Link className="lnk" href="/scores?sport=ucl">Scores &rarr;</Link>
          </div>

          {!table ? (
            <div className="gi-empty">The table lands with the first sync.</div>
          ) : (
            <>
              <div className="ep-table" role="table" aria-label="Champions League league phase table">
                <div className="ep-row ep-row--h" role="row">
                  <span className="ep-rank">#</span>
                  <span className="ep-club">Club</span>
                  <span className="ep-n">P</span>
                  <span className="ep-n">W</span>
                  <span className="ep-n">D</span>
                  <span className="ep-n">L</span>
                  <span className="ep-n wide">GF</span>
                  <span className="ep-n wide">GA</span>
                  <span className="ep-n wide">GD</span>
                  <span className="ep-n pts">PTS</span>
                </div>
                {table.rows.map((r) => {
                  const rail = DARK_RAIL[uclBand(r.rank)];
                  return (
                    <div className={`ep-row${rail ? ` rail-${rail}` : ''}`} role="row" key={r.teamId ?? r.rank}>
                      <span className="ep-rank">{r.rank}</span>
                      <span className="ep-club">{r.team}</span>
                      <span className="ep-n">{r.played}</span>
                      <span className="ep-n">{r.win}</span>
                      <span className="ep-n">{r.draw}</span>
                      <span className="ep-n">{r.lose}</span>
                      <span className="ep-n wide">{r.goalsFor}</span>
                      <span className="ep-n wide">{r.goalsAgainst}</span>
                      <span className="ep-n wide">{r.goalsDiff > 0 ? `+${r.goalsDiff}` : r.goalsDiff}</span>
                      <span className="ep-n pts">{r.points}</span>
                    </div>
                  );
                })}
              </div>
              <p className="ep-key">
                <i className="ep-swatch rail-ucl" /> 1-8 {UCL_BAND_NAME.r16}
                <i className="ep-swatch rail-uel" /> 9-24 {UCL_BAND_NAME.playoff}
              </p>
              <p className="ep-key" data-cross="epl"><Link className="lnk" href="/epl/standings">Premier League table &rarr;</Link></p>
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
