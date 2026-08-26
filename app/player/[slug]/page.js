/**
 * /player/[slug] — Player profile page (Server Component, no client JS).
 *
 * Engine-B skeleton install. Mirrors /team/[slug] in structure: one
 * Server Component reading via lib/players.js, composing components
 * from components/player/*.
 *
 * Composition order matches the player mock
 * (~/Downloads/sportsvyn-player-messi-v1.html):
 *   Hero → Outlook + Awards Odds → Form strip → Anchor pills →
 *   § Rankings → § Stats → § Match Log → § Trajectory → § Articles
 *
 * What populates today:
 *   · HERO (name / position / team / jersey / photo) — REAL
 *   · § Match Log — REAL when group fixtures exist for the team; otherwise dormant
 *
 * Everything else renders the DormantSection empty-state — no
 * fabricated composite scores, no fake stats. The skeleton is in
 * place so when stats/composite/outlook/etc land, populated
 * sections drop in alongside without restructuring.
 *
 * Next 16: params is Promise-shaped — must be awaited.
 */

import { notFound } from 'next/navigation';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import BackToAppBar from '@/components/BackToAppBar';

import { auth } from '@/auth';
import { getPlayerBySlug, getPlayerGroupFixtures } from '@/lib/players';
import { isFollowingPlayer } from '@/lib/follows';

import PlayerHero from '@/components/player/PlayerHero';
import PlayerBioGrid from '@/components/player/PlayerBioGrid';
import PlayerMatchLog from '@/components/player/PlayerMatchLog';
import DormantSection from '@/components/player/DormantSection';

// GRIDIRON ARM. /player/[slug] already RESOLVED gridiron rows before this
// change - getPlayerBySlug has no league filter - so 29,721 NFL and CFB player
// pages were live, and every one of them rendered a World Cup breadcrumb over
// seven dormant soccer sections offering "Tournament Stats". This gates the
// render by league rather than adding sibling routes: the URLs are already
// indexed, and a player page is the same skeleton in different columns.
import { isGridiron, playerCrumb, playerPills, emptyLogLine } from '@/components/player/gridironPlayer';
import GridironHero from '@/components/player/GridironHero';
import GridironTeamNext from '@/components/player/GridironTeamNext';
import { SeasonTotals, GameLog, EmptyLog } from '@/components/player/GridironStats';
import { columnsFor, seasonTotals, gameLog, bdlIdOf } from '@/lib/gridiron/playerStats';
import { cfbColumnsFor, cfbSeasonTotals } from '@/lib/cfb/seasonStats';
import { cfbGameLog } from '@/lib/cfb/gameStats';
import { getTeamMatches } from '@/lib/teams';

import './player.css';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const player = await getPlayerBySlug(slug);
  if (!player) return { title: 'Player not found — Sportsvyn' };
  return {
    title: `${player.full_name} — Sportsvyn`,
    description: `Identity, group-stage fixtures, and tournament profile for ${player.full_name}.`,
  };
}

const LEAGUE_LABEL = { nfl: 'NFL', cfb: 'CFB' };

/**
 * The gridiron render. Kept whole and separate from the soccer arm below so the
 * soccer path is byte-for-byte the function it always was - the team page's
 * lesson was that a shared component edited "generically" is where soccer
 * regressions come from.
 */
async function GridironPlayer({ player, crumb }) {
  // THE COLUMN VOCABULARY FORKS BY CODE, and it is a data fact rather than a
  // design one: nfl_player_game_stats has never held a tackles column, so NFL
  // defense reads Sacks/INT/FR/TD, while CFBD does carry tackles and TFL, so
  // CFB defense reads Tkl/TFL/Sacks/INT. Same table grammar either way.
  const isCfb = player.league_slug === 'cfb';
  const columns = isCfb
    ? cfbColumnsFor(player.position, player.position_group)
    : columnsFor(player.position, player.position_group);
  const bdlId = bdlIdOf(player);

  // A lineman has no counting stats in either league and lands on the zero-row
  // path with everyone else who has not played - which is correct, and is why
  // the empty line says nothing about which of those two it is.
  const canHaveStats = columns != null
    && (isCfb ? player.id != null : player.league_slug === 'nfl' && bdlId != null);
  const [seasons, games, teamMatches] = await Promise.all([
    !canHaveStats ? Promise.resolve([])
      : isCfb ? cfbSeasonTotals(player.id, columns).catch(() => [])
              : seasonTotals(bdlId, columns).catch(() => []),
    // The log is its own table in both codes, never derived from season totals -
    // one source of truth per number.
    !canHaveStats ? Promise.resolve([])
      : isCfb ? cfbGameLog(player.id, columns, { limit: 4 }).catch(() => [])
              : gameLog(bdlId, columns, { limit: 4 }).catch(() => []),
    player.team_id != null ? getTeamMatches(player.team_id).catch(() => []) : Promise.resolve([]),
  ]);

  const hasStats = seasons.length > 0;
  const now = Date.now();
  const next = teamMatches
    .filter((m) => m.status === 'scheduled' && new Date(m.kickoff_at).getTime() >= now)
    .slice(0, 2)
    .map((m) => ({ ...m, us_id: player.team_id }));
  const latestSeason = seasons[0]?.season ?? null;

  return (
    <main className="page-shell">
      <div className="breadcrumb">
        {crumb.map((c, i) => (
          <span key={c.label}>
            {i > 0 && <span className="sep">/</span>}
            {c.current ? <span className="current">{c.label}</span> : <a href={c.href}>{c.label}</a>}
          </span>
        ))}
      </div>

      <GridironHero player={player} />

      <nav className="anchor-pills gp-pills">
        {playerPills({ hasStats, hasLog: games.length > 0 }).map((p) => (
          <a key={p.href} href={p.href} className="anchor-pill">{p.label}</a>
        ))}
      </nav>

      <div className="gp-grid">
        {hasStats ? (
          <>
            <SeasonTotals seasons={seasons} columns={columns} />
            {games.length > 0 && (
              <GameLog games={games} columns={columns}
                seasonLabel={latestSeason ? `${latestSeason} · Last ${games.length}` : ''} />
            )}
          </>
        ) : (
          <EmptyLog line={emptyLogLine({
            leagueSlug: player.league_slug,
            experienceYears: player.experience_years,
            seasonYear: next[0]?.season_year ?? null,
          })} />
        )}

        {next.length > 0 && (
          <GridironTeamNext
            teamName={player.team_name}
            teamSlug={player.team_slug}
            games={next}
            leagueLabel={LEAGUE_LABEL[player.league_slug] ?? ''}
          />
        )}
      </div>
    </main>
  );
}

export default async function PlayerPage({ params }) {
  const { slug } = await params;
  const player = await getPlayerBySlug(slug);
  if (!player) notFound();

  if (isGridiron(player.league_slug)) {
    return (
      <>
        <BackToAppBar />
        <GlobalHeaderServer />
        <GridironPlayer player={player} crumb={playerCrumb(player.league_slug, player.full_name)} />
      </>
    );
  }

  // Session-aware for the follow star (mirrors /team). Only the isAuthed
  // boolean + seed value cross the server/client line; the session does not.
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const isAuthed = !!session?.user;
  const initialFollowing = await isFollowingPlayer(userId, player.id);

  const fixtures = await getPlayerGroupFixtures(player.team_id);

  return (
    <>
      <BackToAppBar />
      <GlobalHeaderServer />

      <main className="page-shell">
        <div className="breadcrumb">
          <a href="/">Home</a>
          <span className="sep">/</span>
          <a href="/world-cup-2026/bracket">FIFA World Cup 2026</a>
          <span className="sep">/</span>
          <a href="#">Players</a>
          <span className="sep">/</span>
          <span className="current">{player.full_name}</span>
        </div>

        <PlayerHero player={player} isAuthed={isAuthed} initialFollowing={initialFollowing} />

        {/* Bio grid renders only when at least one bio field is populated.
            Pre-backfill (today) → returns null, no header, no broken grid. */}
        <PlayerBioGrid player={player} />

        <section className="player-section">
          <div className="section-head">
            <div className="section-head-left">
              <span className="section-head-num">§ Outlook</span>
              <h2 className="section-head-title">Sportsvyn <span className="accent">Outlook</span></h2>
            </div>
          </div>
          <DormantSection message="Sportsvyn's player outlook is being written." />
        </section>

        <section className="player-section">
          <div className="section-head">
            <div className="section-head-left">
              <span className="section-head-num">§ Awards</span>
              <h2 className="section-head-title">Awards <span className="accent">Futures</span></h2>
            </div>
          </div>
          <DormantSection message="Player futures coming soon." />
        </section>

        <section className="player-section">
          <div className="section-head">
            <div className="section-head-left">
              <span className="section-head-num">§ Form</span>
              <h2 className="section-head-title">Form · <span className="accent">G+A by match</span></h2>
            </div>
          </div>
          <DormantSection message="Form populates as the player's matches are played." />
        </section>

        <nav className="anchor-pills">
          <a href="#rankings"   className="anchor-pill">Rankings</a>
          <a href="#stats"      className="anchor-pill">Tournament Stats</a>
          <a href="#match-log"  className="anchor-pill">Match-by-Match</a>
          <a href="#trajectory" className="anchor-pill">Trajectory</a>
          <a href="#articles"   className="anchor-pill">Articles</a>
        </nav>

        <section className="player-section" id="rankings">
          <div className="section-head">
            <div className="section-head-left">
              <span className="section-head-num">§ Rankings</span>
              <h2 className="section-head-title">Where {player.known_as ?? player.full_name} <span className="accent">stands</span></h2>
            </div>
          </div>
          <DormantSection message="Player rankings begin once the tournament is underway." />
        </section>

        <section className="player-section" id="stats">
          <div className="section-head">
            <div className="section-head-left">
              <span className="section-head-num">§ Stats</span>
              <h2 className="section-head-title">Tournament <span className="accent">Stats</span></h2>
            </div>
          </div>
          <DormantSection message="Stats populate as matches are played." />
        </section>

        <section className="player-section" id="match-log">
          <div className="section-head">
            <div className="section-head-left">
              <span className="section-head-num">§ Match Log</span>
              <h2 className="section-head-title">Contribution <span className="accent">per match</span></h2>
            </div>
            {player.team_slug && (
              <a href={`/team/${player.team_slug}`} className="section-head-cta">
                Team schedule <span className="arrow">→</span>
              </a>
            )}
          </div>
          <PlayerMatchLog fixtures={fixtures} teamId={player.team_id} />
        </section>

        <section className="player-section" id="trajectory">
          <div className="section-head">
            <div className="section-head-left">
              <span className="section-head-num">§ Trajectory</span>
              <h2 className="section-head-title">Composite <span className="accent">over time</span></h2>
            </div>
          </div>
          <DormantSection message="Trajectory plots editions of the player composite as the tournament progresses." />
        </section>

        <section className="player-section" id="articles">
          <div className="section-head">
            <div className="section-head-left">
              <span className="section-head-num">§ Articles</span>
              <h2 className="section-head-title">Reads · <span className="accent">{player.known_as ?? player.full_name}</span></h2>
            </div>
          </div>
          <DormantSection message="No player coverage yet." />
        </section>
      </main>
    </>
  );
}
