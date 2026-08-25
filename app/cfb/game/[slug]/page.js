/**
 * /cfb/game/[slug] - the college game page.
 *
 * A SIBLING FILE, not a conditional inside the NFL page. The same law the
 * live_state formatter and the soccer scoreboard card were built under: two
 * codes that share a shape today will not share it tomorrow, and the cost of
 * discovering that inside a route with `if (league === 'cfb')` scattered
 * through it is far higher than the cost of a second file now.
 *
 * WHAT CFB GENUINELY HAS, and therefore what this renders: the score header
 * with its chips and live clock, the line score grid (metadata.line_scores is
 * populated on 1,822 CFB rows), the DriveStrip and drive chart (CFBD's
 * /live/plays feeds table 074), and the pre-game facts.
 *
 * WHAT IT DOES NOT RENDER, and why that is correct rather than missing: the
 * NFL page's four tabs - THE BRIEF, SCORING, PLAYER LINES, TEAM BOX - are fed
 * by tables the API-Sports gridiron importer populates for the NFL alone.
 * College has zero rows in match_briefs, gridiron_game_events and
 * gridiron_player_lines, and no metadata.team_box. A tab rail over four empty
 * panels would be a promise the data cannot keep, so there is no tab rail. If
 * those feeds ever cover college, the tabs are a deliberate follow-up here -
 * not an oversight to be discovered later.
 */

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getGamePage } from '@/lib/gridiron/gameDetail';
import { lineScoreGrid, liveChip } from '@/lib/gridiron/lineScore';
import { distinctLabel } from '@/lib/gridiron/labels';
import { DriveStrip, LastPlay, DriveChart } from '@/components/gridiron/Gamecast';
import { gamecastFor } from '@/lib/gridiron/playsImport';
import { gamecastState, buildDriveChart, simulateAsOf, lastLivePlay } from '@/lib/gridiron/driveStrip';
import { apRankMap, currentApWeek, latestPollSeason, AP_POLL } from '@/lib/cfb/rankings';
import RankBadge from '@/components/gridiron/RankBadge';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import '@/components/gridiron/gridiron.css';
import '@/components/gridiron/drivestrip.css';
// The .gg-* chrome is one stylesheet, imported rather than copied. Duplicating
// it would be two places to change a header, which is exactly the drift the
// sibling law is meant to avoid - siblings get their own MARKUP, not their own
// copy of shared paint.
import '../../../nfl/game/[slug]/game.css';

export const dynamic = 'force-dynamic';

const ET = 'America/New_York';
const fmtKick = (d) => new Intl.DateTimeFormat('en-US', {
  timeZone: ET, weekday: 'short', month: 'short', day: 'numeric',
  hour: 'numeric', minute: '2-digit',
}).format(new Date(d));
const fmtDay = (d) => new Intl.DateTimeFormat('en-US', {
  timeZone: ET, weekday: 'short', month: 'short', day: 'numeric',
}).format(new Date(d));

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const g = await getGamePage(slug);
  if (!g || g.leagueSlug !== 'cfb') return { title: 'Game not found - Sportsvyn' };
  const fixture = `${g.away.name} at ${g.home.name}`;
  const when = g.kickoffAt ? fmtDay(g.kickoffAt) : null;
  const score = g.status === 'final'
    ? `Final ${g.away.abbreviation} ${g.awayScore}, ${g.home.abbreviation} ${g.homeScore}.`
    : null;
  return {
    title: `${fixture}${when ? ` - ${when}` : ''} - Sportsvyn`,
    description: [score, 'Line score and drive chart.'].filter(Boolean).join(' '),
  };
}

export default async function CfbGamePage({ params, searchParams }) {
  const { slug } = await params;
  const sp = (await searchParams) ?? {};
  const game = await getGamePage(slug);
  // The mirror of the NFL route's guard, pointing the other way. getGamePage
  // resolves both gridiron leagues, so without this an NFL slug would render
  // here too and the two routes would both answer for the same game.
  if (!game || game.leagueSlug !== 'cfb') notFound();

  const final = game.status === 'final';
  const live = game.status === 'live';
  const grid = lineScoreGrid(game);
  // AP badges. The rank shown is the CURRENT poll's, not the poll as it stood
  // when the game was played - a historical game page carries today's ranking,
  // which is the same thing every scoreboard does.
  const apSeason = await latestPollSeason(AP_POLL);
  const apWeek = apSeason ? await currentApWeek(apSeason) : null;
  const apRanks = await apRankMap({ season: apSeason, week: apWeek });

  // ---- DriveStrip ---------------------------------------------------------
  const gamecast = await gamecastFor(game.id);
  const rawAsOf = Array.isArray(sp.asOf) ? sp.asOf[0] : sp.asOf;
  const asOf = rawAsOf != null && /^\d+$/.test(String(rawAsOf)) ? Number(rawAsOf) : null;
  const sim = simulateAsOf(gamecast?.plays ?? [], asOf);
  const driveRows = buildDriveChart(sim.plays, {
    drives: gamecast?.drives ?? [],
    homeTeamId: game.home?.id,
    teamAbbr: gamecast?.teamAbbr ?? new Map(),
    inProgressDriveId: sim.simulated ? (sim.plays.at(-1)?.driveId ?? null) : null,
  });
  const currentDrive = driveRows[0] ?? null;
  const stripLastPlay = lastLivePlay(sim.plays);
  const stripState = gamecastState({
    status: sim.simulated ? 'live' : game.status,
    playCount: sim.plays.length,
    lastPlay: stripLastPlay,
  });
  const defenseAbbr = currentDrive
    ? (currentDrive.offenseIsHome ? game.away?.abbreviation : game.home?.abbreviation)
    : null;

  const winner = final
    ? (game.homeScore > game.awayScore ? 'home' : game.awayScore > game.homeScore ? 'away' : null)
    : null;
  const foot = [distinctLabel(game.weekLabel), game.venue, game.venueCity].filter(Boolean).join(' · ');

  return (
    <div className="gi ggame" data-surface="ink">
      <GlobalHeaderServer activeNav="cfb" />

      <div className="gg-wrap">
        <div className="gg-crumb">
          <Link href="/scores?sport=cfb">&#8249; Scores{game.kickoffAt ? ` · ${fmtDay(game.kickoffAt)}` : ''}</Link>
        </div>

        <header className="gg-head">
          <div className="gg-chips">
            {final ? <span className="gg-chip final">FINAL</span> : null}
            {live ? (
              <span className="gg-chip live">
                LIVE{liveChip(game.liveState) ? <span className="gi-qc"> {liveChip(game.liveState)}</span> : null}
              </span>
            ) : null}
            {!final && !live && game.kickoffAt
              ? <span className="gg-chip time">{fmtKick(game.kickoffAt)} ET</span> : null}
          </div>

          <TeamRow t={game.away} score={game.awayScore} loser={winner === 'home'} show={final || live} rank={apRanks.get(game.away?.id) ?? null} />
          <TeamRow t={game.home} score={game.homeScore} loser={winner === 'away'} show={final || live} rank={apRanks.get(game.home?.id) ?? null} />

          <div className="gg-headfoot">
            <span>CFB · {game.seasonPhase} W{game.week}</span>
            {foot ? <span className="r">{foot}</span> : null}
          </div>
        </header>

        {grid ? (
          <section className="gg-sect" aria-label="Line score">
            <div className="gg-kick"><h2>LINE SCORE</h2><div className="rule" /></div>
            <table className="gg-ls">
              <thead>
                <tr>
                  <th className="t" scope="col"><span className="gg-sr">Team</span></th>
                  {grid.columns.map((c) => <th key={c} scope="col">{c}</th>)}
                  <th className="tot" scope="col">T</th>
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((r) => (
                  <tr key={r.abbr}>
                    <th className="t" scope="row">{r.abbr}</th>
                    {r.cells.map((v, j) => <td key={grid.columns[j]}>{v}</td>)}
                    <td className="tot">{r.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        {/* PRESENT-BUT-EMPTY, NEVER HIDDEN. The ruling for this route: a CFB
            game that has no plays yet still grows a DRIVES section saying so.
            The NFL page hides the section entirely when the feed is empty; this
            one does not, because a Pick'em entrant tapping through before
            kickoff must be told the drive chart exists and is waiting, not left
            to conclude the page is broken. The honest gap is rendered, not
            omitted - the same three-state law the strip itself obeys. */}
        <section className="gg-sect" aria-label="Drive chart">
          <div className="gg-kick"><h2>DRIVES</h2><div className="rule" /></div>
          {sim.plays.length ? (
            <>
              <DriveStrip
                state={stripState}
                lastPlay={stripLastPlay}
                drive={currentDrive}
                homeAbbr={game.home?.abbreviation}
                awayAbbr={game.away?.abbreviation}
                offenseAbbr={currentDrive?.offenseAbbr}
                defenseAbbr={defenseAbbr}
                simulated={sim.simulated}
              />
              {stripState.mode !== 'final' && <LastPlay play={stripLastPlay} />}
              <DriveChart rows={driveRows} teamAbbr={gamecast.teamAbbr} homeTeamId={game.home?.id} />
            </>
          ) : (
            <div className="ds-empty">
              {live
                ? 'Play data pending - the score and clock above are live.'
                : final
                  ? 'No play-by-play stored for this game.'
                  : 'Drive chart appears once the game kicks off.'}
            </div>
          )}
        </section>

        <GameFacts game={game} final={final} />

        <footer className="gg-foot">
          SPORTSVYN IS NOT AFFILIATED WITH, ENDORSED BY, OR SPONSORED BY THE NCAA,
          ITS MEMBER INSTITUTIONS, OR THEIR ATHLETES.
        </footer>
      </div>
    </div>
  );
}

// TeamRow and PreGameFacts are deliberately duplicated from the NFL route
// rather than extracted: they are markup, the sibling law says siblings own
// their markup, and hoisting them would mean editing the NFL page in a relay
// whose brief was explicitly not to touch it. If a third gridiron surface ever
// wants them, that is the moment to extract - three callers is a component,
// two is a coincidence.
function TeamRow({ t, score, loser, show, rank }) {
  return (
    <div className={`gg-teamrow${loser ? ' loser' : ''}`}>
      <span className="abbr">{t?.abbreviation ?? ''}</span>
      <RankBadge rank={rank} size="big" />
      <span className="tname">{t?.name ?? 'TBD'}</span>
      {/* No score column before kickoff. A 0 next to a team that has not played
          is not a low score, it is a wrong one. */}
      <span className="score">{show ? score : ''}</span>
    </div>
  );
}

function GameFacts({ game, final }) {
  const place = [game.venue, game.venueCity].filter(Boolean).join(', ');
  const round = distinctLabel(game.weekLabel);
  if (!game.kickoffAt && !place && !round) return null;
  // "KICKOFF" is a promise about the future. On a game already played it reads
  // as a mistake, so the heading follows the game's state while the facts
  // beneath it - when, where, which round - stay worth showing either way.
  return (
    <section className="gg-sect" aria-label="Game details">
      <div className="gg-kick"><h2>{final ? 'DETAILS' : 'KICKOFF'}</h2><div className="rule" /></div>
      <dl className="gg-facts">
        {game.kickoffAt ? <div><dt>When</dt><dd>{fmtKick(game.kickoffAt)} ET</dd></div> : null}
        {place ? <div><dt>Where</dt><dd>{place}</dd></div> : null}
        {round ? <div><dt>Round</dt><dd>{round}</dd></div> : null}
      </dl>
    </section>
  );
}
