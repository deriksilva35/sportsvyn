/**
 * /nfl/game/[slug] - the gridiron game page, per
 * docs/design/sportsvyn-gridiron-game-page-v2-tabs.html (design lock).
 *
 * ONE SERVER RENDER. Every panel's markup is produced here and shipped in the
 * first response; the client island below owns which one is visible and which
 * scoring format the FPTS columns read from. There is no per-tab fetch, so
 * SCORING and PLAYER LINES are instant, and a reader who never opens them has
 * paid one query for the privilege.
 *
 * DATA HONESTY IS STRUCTURAL HERE, not a rule someone remembers. The tab rail
 * is built from the panels that HAVE data: no scoring plays means no SCORING
 * tab, no player lines means no PLAYER LINES tab, and a preseason game gets no
 * TEAM BOX tab because the provider does not serve team totals until Week 1.
 * A scheduled game therefore renders as a header, a kickoff and a venue, which
 * is everything true about it.
 */

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getGamePage, scoringByQuarter, linesByGroup, fantasyLeaders, SCORING_FORMATS } from '@/lib/gridiron/gameDetail';
import { lineScoreGrid, liveChip } from '@/lib/gridiron/lineScore';
import { distinctLabel } from '@/lib/gridiron/labels';
import { getBriefForMatch } from '@/lib/gridiron/gameBrief';
import GameTabs from '@/components/gridiron/GameTabs';
import { DriveStrip, LastPlay, DriveChart } from '@/components/gridiron/Gamecast';
import { gamecastFor } from '@/lib/gridiron/playsImport';
import { gamecastState, buildDriveChart, simulateAsOf, lastLivePlay } from '@/lib/gridiron/driveStrip';
import OddsStrip from '@/components/gridiron/OddsStrip';
import PropsPanel from '@/components/gridiron/PropsPanel';
import { propsSlate } from '@/lib/market/reads';
import { isPreGame } from '@/lib/gridiron/oddsFormat';
import { getH2hOdds } from '@/lib/gridiron/oddsReader';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import '@/components/gridiron/gridiron.css';
import '@/components/gridiron/drivestrip.css';
import './game.css';

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
  if (!g) return { title: 'Game not found - Sportsvyn' };
  const fixture = `${g.away.name} at ${g.home.name}`;
  const when = g.kickoffAt ? fmtDay(g.kickoffAt) : null;
  const score = g.status === 'final'
    ? `Final ${g.away.abbreviation} ${g.awayScore}, ${g.home.abbreviation} ${g.homeScore}.`
    : null;
  return {
    title: `${fixture}${when ? ` - ${when}` : ''} - Sportsvyn`,
    description: [score, 'Line score, scoring summary and player lines.'].filter(Boolean).join(' '),
  };
}

export default async function GamePage({ params, searchParams }) {
  const { slug } = await params;
  const sp = (await searchParams) ?? {};
  const game = await getGamePage(slug);
  // A soccer slug reaching a gridiron route is a 404, not a redirect loop back
  // to /match: getGamePage only resolves rows in the two gridiron leagues.
  if (!game || game.leagueSlug !== 'nfl') notFound();

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
  const quarters = scoringByQuarter(game);
  const brief = await getBriefForMatch(game.id);

  // ---- DriveStrip ---------------------------------------------------------
  // ?asOf=N replays a completed game as it stood after N plays. It proves the
  // VISUAL component against real data and nothing whatever about live polling
  // - see simulateAsOf().
  const gamecast = await gamecastFor(game.id);
  const rawAsOf = Array.isArray(sp.asOf) ? sp.asOf[0] : sp.asOf;
  const asOf = rawAsOf != null && /^\d+$/.test(String(rawAsOf)) ? Number(rawAsOf) : null;
  const sim = simulateAsOf(gamecast?.plays ?? [], asOf);
  const driveRows = buildDriveChart(sim.plays, {
    drives: gamecast?.drives ?? [],
    homeTeamId: game.home?.id,
    teamAbbr: gamecast?.teamAbbr ?? new Map(),
    // Only a simulated cut has a drive still in progress; a real final does not.
    inProgressDriveId: sim.simulated ? (sim.plays.at(-1)?.driveId ?? null) : null,
  });
  const currentDrive = driveRows[0] ?? null;
  const stripLastPlay = lastLivePlay(sim.plays);
  // A simulated cut is shown as the game stood THEN, so it renders live even
  // though the row's own status says final. Unsimulated, the status rules.
  const stripState = gamecastState({
    status: sim.simulated ? 'live' : game.status,
    playCount: sim.plays.length,
    lastPlay: stripLastPlay,
  });
  const defenseAbbr = currentDrive
    ? (currentDrive.offenseIsHome ? game.away?.abbreviation : game.home?.abbreviation)
    : null;

  const teams = [game.away, game.home].filter((t) => t?.id);
  const teamTables = teams.map((t) => ({ team: t, tables: linesByGroup(game, t.id) }));
  const hasPlayers = teamTables.some((t) => t.tables.length > 0);

  // Leaders are computed PER FORMAT rather than once and re-sorted in the
  // browser. The table is a top five, and a top five re-sorted after slicing is
  // the wrong five: drop the receptions and a three-catch night leaves the list
  // entirely rather than moving down it.
  const leaders = {};
  for (const f of SCORING_FORMATS) leaders[f] = fantasyLeaders(game, f, 5);

  const teamBox = game.teamBox && Object.keys(game.teamBox).length ? game.teamBox : null;

  const panels = [
    brief ? { key: 'brief', label: 'THE BRIEF' } : null,
    quarters.length ? { key: 'scoring', label: 'SCORING' } : null,
    hasPlayers ? { key: 'players', label: 'PLAYER LINES' } : null,
    teamBox ? { key: 'teambox', label: 'TEAM BOX' } : null,
  ].filter(Boolean);

  const winner = final ? (game.homeScore > game.awayScore ? 'home' : game.awayScore > game.homeScore ? 'away' : null) : null;
  // The provider's prose week only earns its place when it says something the
  // mechanical "PRE W1" beside it does not. "Hall of Fame Weekend" does; a
  // second "Week 1" is the same fact in longer words.
  const foot = [distinctLabel(game.weekLabel), game.venue, game.venueCity].filter(Boolean).join(' · ');

  return (
    <div className="gi ggame" data-surface="ink">
      <GlobalHeaderServer activeNav="nfl" />

      <div className="gg-wrap">
        <div className="gg-crumb">
          <Link href="/scores">&#8249; Scores{game.kickoffAt ? ` · ${fmtDay(game.kickoffAt)}` : ''}</Link>
        </div>

        <header className="gg-head">
          <div className="gg-chips">
            {final ? <span className="gg-chip final">FINAL</span> : null}
            {/* Where in the game, the ONE formatter (lineScore.js) - the same
                chip the scoreboard card wears, per the one-definition law
                this page originally escaped by being missed in recon. */}
            {live ? (
              <span className="gg-chip live">
                LIVE{liveChip(game.liveState) ? <span className="gi-qc"> {liveChip(game.liveState)}</span> : null}
              </span>
            ) : null}
            {!final && !live && game.kickoffAt
              ? <span className="gg-chip time">{fmtKick(game.kickoffAt)} ET</span> : null}
            {game.seasonPhase === 'PRE' ? <span className="gg-chip pre">PRE</span> : null}
          </div>

          <TeamRow t={game.away} score={game.awayScore} loser={winner === 'home'} show={final || live} />
          <TeamRow t={game.home} score={game.homeScore} loser={winner === 'away'} show={final || live} />

          <div className="gg-headfoot">
            <span>{game.leagueSlug.toUpperCase()} · {game.seasonPhase} W{game.week}</span>
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

        {/* THE DRIVESTRIP. Renders nothing at all when no plays are stored -
            the honest gap is a state of the strip, not of the page, and a game
            with no feed simply does not grow a section. */}
        {gamecast?.plays?.length ? (
          <section className="gg-sect" aria-label="Drive chart">
            <div className="gg-kick"><h2>DRIVES</h2><div className="rule" /></div>
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
            <DriveChart
              rows={driveRows}
              teamAbbr={gamecast.teamAbbr}
              homeTeamId={game.home?.id}
            />
          </section>
        ) : null}

        {/* THE MARKET'S READ, pre-kickoff only. The component already
            existed and already rendered on the /scores card's expanded pane;
            the game page - the surface with the most room for it - had no
            market module at all. Same guard as the card: isPreGame gates it,
            which is freeze-at-kickoff by construction because the ingest only
            joins scheduled matches. Renders null when there is no clean
            two-sided read: absence over inference. */}
        {isPreGame(game.status) && odds ? <OddsStrip odds={odds} leagueSlug="nfl" matchId={game.id} /> : null}
        {isPreGame(game.status) && propsCard ? <PropsPanel card={propsCard} leagueSlug="nfl" matchId={game.id} /> : null}

        {panels.length ? (
          <GameTabs
            panels={panels}
            leaders={leaders}
            teams={teamTables.map((t) => ({
              id: t.team.id, abbr: t.team.abbreviation ?? t.team.name, tables: t.tables,
            }))}
            nodes={{
              brief: brief ? <BriefPanel brief={brief} /> : null,
              scoring: quarters.length ? <ScoringPanel quarters={quarters} game={game} /> : null,
              teambox: teamBox ? <TeamBoxPanel box={teamBox} teams={teams} /> : null,
            }}
          />
        ) : (
          <PreGameFacts game={game} />
        )}

        <footer className="gg-foot">
          SPORTSVYN IS NOT AFFILIATED WITH, ENDORSED BY, OR SPONSORED BY THE NATIONAL
          FOOTBALL LEAGUE, ITS TEAMS, OR ITS PLAYERS.
        </footer>
      </div>
    </div>
  );
}

function TeamRow({ t, score, loser, show }) {
  return (
    <div className={`gg-teamrow${loser ? ' loser' : ''}`}>
      <span className="abbr">{t?.abbreviation ?? ''}</span>
      <span className="tname">{t?.name ?? 'TBD'}</span>
      {/* No score column before kickoff. A 0 next to a team that has not played
          is not a low score, it is a wrong one. */}
      <span className="score">{show ? score : ''}</span>
    </div>
  );
}

/**
 * What a game that has not kicked off can honestly say about itself. This is
 * the whole page for a scheduled fixture - no tab rail, because there is
 * nothing behind it yet.
 */
function PreGameFacts({ game }) {
  const place = [game.venue, game.venueCity].filter(Boolean).join(', ');
  const round = distinctLabel(game.weekLabel);
  return (
    <section className="gg-sect" aria-label="Game details">
      <div className="gg-kick"><h2>KICKOFF</h2><div className="rule" /></div>
      <dl className="gg-facts">
        {game.kickoffAt ? <div><dt>When</dt><dd>{fmtKick(game.kickoffAt)} ET</dd></div> : null}
        {place ? <div><dt>Where</dt><dd>{place}</dd></div> : null}
        {round ? <div><dt>Round</dt><dd>{round}</dd></div> : null}
      </dl>
      <p className="gg-note">
        Scoring summary and player lines land once the game is played.
      </p>
    </section>
  );
}

function BriefPanel({ brief }) {
  return (
    <section aria-label="The brief">
      <div className="gg-kick"><h2>THE BRIEF</h2><div className="rule" /></div>
      <div className="gg-brief">
        {brief.paragraphs.map((p, i) => <p key={i}>{p}</p>)}
        <span className="tag">AUTO-GENERATED FROM MATCH DATA{brief.publishedLabel ? ` · ${brief.publishedLabel}` : ''}</span>
      </div>
    </section>
  );
}

function ScoringPanel({ quarters, game }) {
  const abbrOf = (id) => (id === game.home.id ? game.home : id === game.away.id ? game.away : null);
  const total = quarters.reduce((a, q) => a + q.plays.length, 0);
  return (
    <section aria-label="Scoring summary">
      <div className="gg-kick">
        <h2>SCORING SUMMARY</h2>
        <span className="sub">{total} SCORING {total === 1 ? 'PLAY' : 'PLAYS'}</span>
        <div className="rule" />
      </div>
      {quarters.map((q) => (
        <div className="gg-qtr" key={q.quarter}>
          <div className="gg-qlabel">{q.label}</div>
          {q.plays.map((e) => {
            const t = abbrOf(e.team_id);
            const kind = String(e.scoring_type || '').toUpperCase();
            const cls = kind === 'TD' ? 'td' : kind === 'FG' ? 'fg' : '';
            const homeAhead = e.home_score != null && e.away_score != null && e.home_score >= e.away_score;
            return (
              <div className="gg-ev" key={e.seq}>
                <span className={`type ${cls}`}>{kind}</span>
                <div className="body">
                  {t ? <div className="team">{t.abbreviation} · {t.name.toUpperCase()}</div> : null}
                  {e.description ? <div className="play">{e.description}</div> : null}
                  {e.clock ? <div className="clock">{e.clock}</div> : null}
                </div>
                {e.home_score != null && e.away_score != null ? (
                  <div className="run">
                    <span className={homeAhead ? '' : 'lead'}>{game.away.abbreviation} {e.away_score}</span>
                    <br />
                    <span className={homeAhead ? 'lead' : ''}>{game.home.abbreviation} {e.home_score}</span>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}

/**
 * REG only. The provider serves no team totals for preseason, so this never
 * renders in August - and the tab that would open it is not in the rail.
 */
function TeamBoxPanel({ box, teams }) {
  const cols = teams.filter((t) => box[t.id]);
  const labels = [...new Set(cols.flatMap((t) => Object.keys(box[t.id] ?? {})))];
  return (
    <section aria-label="Team box score">
      <div className="gg-kick"><h2>TEAM BOX SCORE</h2><div className="rule" /></div>
      <table className="gg-tb">
        <thead>
          <tr>
            <th className="l" scope="col"><span className="gg-sr">Statistic</span></th>
            {cols.map((t) => <th key={t.id} scope="col">{t.abbreviation}</th>)}
          </tr>
        </thead>
        <tbody>
          {labels.map((k) => (
            <tr key={k}>
              <td className="l">{k.replace(/_/g, ' ').toUpperCase()}</td>
              {cols.map((t) => <td key={t.id}>{fmtBoxValue(box[t.id]?.[k])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// The provider nests a few team totals one level deep ({ total, yards }). Flatten
// to a readable cell rather than printing [object Object].
function fmtBoxValue(v) {
  if (v == null) return '–';
  if (typeof v === 'object') return Object.values(v).filter((x) => x != null).join('-');
  return String(v);
}
