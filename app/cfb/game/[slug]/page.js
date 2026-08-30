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
 * IT NOW RENDERS A BOX SCORE, and the note that used to sit here is gone.
 * The note argued that a tab rail could not be
 * honoured, because college had zero rows in match_briefs,
 * gridiron_game_events and gridiron_player_lines. All three statements are still true and all three are
 * now beside the point: the CFB box score does not live in those tables. It
 * lives in cfb_player_game_stats (migration 078), written by the weekly CFBD
 * importer, and as of 29 Aug it is populated same-day - UNC @ TCU landed
 * within ~35 minutes of the provider calling the game complete. The note was
 * correct when written and became stale when 078 shipped; leaving it would
 * have argued against a tab whose data was already sitting in the database.
 *
 * THE NFL'S RULE STILL HOLDS, and it is the reason there is one tab and not
 * four: a tab exists only when its data does. No box score, no PLAYER LINES
 * tab - not an empty frame.
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
import { getTeamRecordChip } from '@/lib/standings/read';
import OddsStrip from '@/components/gridiron/OddsStrip';
import PropsPanel from '@/components/gridiron/PropsPanel';
import GameTabs from '@/components/gridiron/GameTabs';
import { parseGameTab } from '@/lib/gridiron/gameTabsNav';
import { cfbBoxScoreFor, boxScoreLabel } from '@/lib/cfb/boxScore';
import { propsSlate } from '@/lib/market/reads';
import { isPreGame } from '@/lib/gridiron/oddsFormat';
import { getH2hOdds } from '@/lib/gridiron/oddsReader';
import BackToAppBar from '@/components/BackToAppBar';
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
  // One batch read keyed by match id - the same reader /scores uses.
  const odds = isPreGame(game.status)
    ? (await getH2hOdds([game.id]).catch(() => new Map())).get(game.id) ?? null
    : null;
  // Props are scoped to the game week and the board, so most games have none -
  // PropsPanel renders null rather than an empty shell.
  const propsCard = isPreGame(game.status)
    ? (await propsSlate({ matchIds: [game.id] }).catch(() => []))[0] ?? null
    : null;
  // AP badges. The rank shown is the CURRENT poll's, not the poll as it stood
  // when the game was played - a historical game page carries today's ranking,
  // which is the same thing every scoreboard does.
  const apSeason = await latestPollSeason(AP_POLL);
  const apWeek = apSeason ? await currentApWeek(apSeason) : null;
  const apRanks = await apRankMap({ season: apSeason, week: apWeek });
  // REG-only by construction (getTeamRecord filters season_type), nullable,
  // and caught: a missing standings row must not break a game page.
  const [homeRecord, awayRecord] = await Promise.all([
    getTeamRecordChip('cfb', game.home?.id, game.seasonYear),
    getTeamRecordChip('cfb', game.away?.id, game.seasonYear),
  ]);

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
  // liveState IS PASSED, and only when the cut is real. It is what makes the
  // halftime branch (driveStrip.js:105) reachable at all - without it that
  // branch reads two undefined fields and can never fire, so the strip would
  // draw a stale ball through the interval. A SIMULATED cut deliberately does
  // not get it: the replay shows the game as it stood at play N, and the
  // clock we hold describes now, not then.
  const stripState = gamecastState({
    status: sim.simulated ? 'live' : game.status,
    playCount: sim.plays.length,
    lastPlay: stripLastPlay,
    liveState: sim.simulated ? null : game.liveState,
  });
  const defenseAbbr = currentDrive
    ? (currentDrive.offenseIsHome ? game.away?.abbreviation : game.home?.abbreviation)
    : null;

  // ---- BOX SCORE ----------------------------------------------------------
  // OUR TABLES, NOT THE PROVIDER, AND THE PAGE DOES NOT CHOOSE BETWEEN THEM.
  // cfbBoxScoreFor is handed the status and hands back rows plus the state that
  // produced them - live overlay, complete import, or the bridge snapshot in
  // the gap between the whistle and the import. Every decision about which
  // table answers lives in that reader; this page only renders what it gets,
  // which is the whole point of source-per-game-state.
  //
  // THE TAB RULE IS UNCHANGED IN FORM AND WIDER IN EFFECT: no rows, no tab -
  // but "rows" now means EITHER table, so the tab appears during the game
  // instead of only after it.
  const box = await cfbBoxScoreFor(game.id, game.status).catch(() => null);
  const boxLabel = boxScoreLabel(box?.state);
  // The team order is the scoreboard's - away first - so the team toggle reads
  // the same direction as the header above it.
  const boxTeams = (box?.teams ?? [])
    .map((t) => {
      const side = [game.away, game.home].find((g) => g && (g.name === t.name || g.shortName === t.name));
      return { id: side?.id ?? t.name, abbr: side?.abbreviation ?? t.name, tables: t.tables };
    })
    .sort((a) => (a.id === game.away?.id ? -1 : 1));
  // THE RAIL'S PANELS, in the order they are read. Drives first because that
  // is what a game in progress is about; the box score is the second question.
  const panels = [
    { key: 'drives', label: 'DRIVES' },
    boxTeams.length ? { key: 'players', label: 'PLAYER LINES' } : null,
  ].filter(Boolean);
  // ONE PARSER, and it is handed the keys this game actually has - a ?tab=
  // naming a panel that does not exist here falls to the default rather than
  // selecting nothing. See lib/gridiron/gameTabsNav.js.
  const activeTab = parseGameTab(sp, panels.map((p) => p.key));
  // CFB HAS NO FANTASY SCORING IN THIS PRODUCT. GameTabs renders the leaders
  // block only when a format has rows, so three empty lists is the honest way
  // to say "no fantasy here" without a second component.
  const noLeaders = { ppr: [], 'half-ppr': [], standard: [] };

  const winner = final
    ? (game.homeScore > game.awayScore ? 'home' : game.awayScore > game.homeScore ? 'away' : null)
    : null;
  const foot = [distinctLabel(game.weekLabel), game.venue, game.venueCity].filter(Boolean).join(' · ');

  // PRESENT-BUT-EMPTY, NEVER HIDDEN. The ruling for this route: a CFB
  // game that has no plays yet still grows a DRIVES section saying so.
  // The NFL page hides the section entirely when the feed is empty; this
  // one does not, because a Pick'em entrant tapping through before
  // kickoff must be told the drive chart exists and is waiting, not left
  // to conclude the page is broken. The honest gap is rendered, not
  // omitted - the same three-state law the strip itself obeys.
  const drivesNode = (
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
  );

  return (
    <div className="gi ggame" data-surface="ink">
      <BackToAppBar />
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

          <TeamRow record={awayRecord} t={game.away} score={game.awayScore} loser={winner === 'home'} show={final || live} rank={apRanks.get(game.away?.id) ?? null} />
          <TeamRow record={homeRecord} t={game.home} score={game.homeScore} loser={winner === 'away'} show={final || live} rank={apRanks.get(game.home?.id) ?? null} />

          <div className="gg-headfoot">
            <span>CFB · {game.seasonPhase} W{game.week}</span>
            {foot ? <span className="r">{foot}</span> : null}
          </div>
        </header>

        {/* THE MARKET'S READ, pre-kickoff only. The component already existed
            and already rendered on the /scores card's expanded pane; the game
            page - the surface with the most room for it - had no market module
            at all. Same guard as the card: isPreGame gates it, which is
            freeze-at-kickoff by construction because the ingest only joins
            scheduled matches. Renders null when there is no clean two-sided
            read: absence over inference. */}
        {isPreGame(game.status) && odds ? <OddsStrip odds={odds} leagueSlug="cfb" matchId={game.id} /> : null}
        {isPreGame(game.status) && propsCard ? <PropsPanel card={propsCard} leagueSlug="cfb" matchId={game.id} /> : null}

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

        {/* THE RAIL, DIRECTLY UNDER THE LINE SCORE. Drives and the box score
            are two views of the same game, so they SWAP rather than stack:
            stacked, a reader on a phone scrolls past a full drive chart to
            reach a stat line, and neither section is ever the one they wanted
            first. GameTabs already owns a rail, and reusing it means the NFL
            page inherits this the moment it declares the same panels.

            DRIVES IS ALWAYS A PANEL, and that is deliberate against the letter
            of "a tab only when its content has rows". The drives section has
            three states and renders an honest line in the empty one - "Drive
            chart appears once the game kicks off" - and hiding the tab would
            delete that sentence for every scheduled game. PLAYER LINES is the
            tab the rule was written for, and it obeys it exactly: no box
            score, no tab.

            ONE PANEL MEANS NO RAIL. A tab strip with a single tab is furniture
            pretending to be a control, so the section renders bare, exactly as
            it did before this rail existed. */}
        {panels.length > 1 ? (
          <GameTabs
            panels={panels}
            nodes={{ drives: drivesNode }}
            leaders={noLeaders}
            teams={boxTeams}
            boxLabel={boxLabel}
            initial={activeTab}
            basePath={`/cfb/game/${game.slug}`}
          />
        ) : drivesNode}

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
function TeamRow({ t, score, loser, show, rank, record = null }) {
  // ORDER IS LAYOUT HERE, so it is written once and not rearranged
  // casually: badge, abbreviation, name, record, then the score pushed to
  // the right edge by margin-left:auto. Every part but the name is
  // flex:none; the name is the only child that gives way.
  return (
    <div className={`gg-teamrow${loser ? ' loser' : ''}`}>
      <RankBadge rank={rank} size="big" />
      <span className="abbr">{t?.abbreviation ?? ''}</span>
      <span className="tname">{t?.name ?? 'TBD'}</span>
      {/* A chip may only claim knowledge. Records carry no kickoff, so this
          renders pre-game, live and final alike - unlike the market strip. */}
      {record ? <span className="gg-rec">{record}</span> : null}
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
