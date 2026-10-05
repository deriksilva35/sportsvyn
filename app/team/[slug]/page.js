/**
 * /team/[slug] — Team page (Server Component, no client JS).
 *
 * Composition order matches the locked design (sportsvyn-team-argentina-v2.html):
 *   Hero → Outlook + Odds → FormStrip → AnchorPills → Recent+Next →
 *   Stats → Top Players → Trajectory → Schedule → Articles.
 *
 * The seven queries fan out via Promise.all once the team row resolves.
 * notFound() is called before the fan-out when the slug doesn't exist, so a
 * bad URL is cheap.
 *
 * Next 16: params is Promise-shaped — must be awaited.
 */

import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { isRetiredLeague } from '@/lib/retired';
import { auth } from '@/auth';
import { resolveShellMode } from '@/lib/shell/shell';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import BackToAppBar from '@/components/BackToAppBar';
import {
  getTeamBySlug,
  getTeamStats,
  getTeamMatches,
  getTopPlayers,
  getTeamTrajectory,
  getTeamOdds,
  getNextMatchBroadcasters,
} from '@/lib/teams';
import { getTeamSquad } from '@/lib/players';
import { isFollowingTeam } from '@/lib/follows';

import TeamHero from '@/components/team/TeamHero';
import { servedList, servedRankFor } from '@/lib/rankings/servedBoard';
import SportsvynOutlook from '@/components/team/SportsvynOutlook';
import FormStrip from '@/components/team/FormStrip';
import RecentNext from '@/components/team/RecentNext';
import TeamStatsGrid from '@/components/team/TeamStatsGrid';
import TopPlayers from '@/components/team/TopPlayers';
import SquadList from '@/components/team/SquadList';
import GridironRoster from '@/components/team/GridironRoster';
import { isGridiron, breadcrumbFor, anchorPillsFor, scheduleHeadingFor } from '@/components/team/gridiron';
import Trajectory from '@/components/team/Trajectory';
import Schedule from '@/components/team/Schedule';
import Articles from '@/components/team/Articles';
import SiteFooter from '@/components/SiteFooter';

import './team.css';

// NOINDEX UNTIL REBUILT (sun-12 item 3). Every team page still renders the
// retired World Cup template, so none is offered to a search index and none is
// in the sitemap (lib/seo/sitemapPlan.js). follow stays true: the links out of
// a team page (players, matches) are live pages a crawler may still reach.
// /team is deliberately NOT in robots.txt Disallow - a crawler that cannot fetch
// the page never reads this noindex, and already-indexed URLs would linger.
const TEAM_ROBOTS = Object.freeze({ index: false, follow: true });

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const team = await getTeamBySlug(slug);
  if (!team) return { title: 'Team not found — Sportsvyn', robots: TEAM_ROBOTS };
  return {
    title: `${team.name} — Sportsvyn`,
    description: `Power ranking, form, stats, top performers, and schedule for ${team.name}.`,
    robots: TEAM_ROBOTS,
  };
}

function pickRecentAndNext(matches) {
  const finals = matches.filter((m) => m.status === 'final');
  const scheduled = matches
    .filter((m) => m.status === 'scheduled')
    .sort((a, b) => new Date(a.kickoff_at) - new Date(b.kickoff_at));
  const recent = finals.length ? finals[finals.length - 1] : null;
  const next = scheduled.length ? scheduled[0] : null;
  return { recent, next };
}

function nextMatchOpponentInfo(match, teamId) {
  if (!match) return null;
  const isHome = match.home_team_id === teamId;
  return {
    opponent_name: isHome ? match.away_name : match.home_name,
    opponent_short_name: isHome ? match.away_short_name : match.home_short_name,
    stage: match.stage,
  };
}

export default async function TeamPage({ params }) {
  const { slug } = await params;
  const team = await getTeamBySlug(slug);
  if (!team) notFound();
  // SOCCER IS RETIRED (tue-14): a soccer club's page is history, not a page.
  // Before any reader runs; gridiron and MLB rows are untouched.
  if (isRetiredLeague(team.leagueSlug ?? team.league_slug)) permanentRedirect('/scores');

  const matches = await getTeamMatches(team.id);
  const { recent, next } = pickRecentAndNext(matches);

  // Session is resolved server-side so the initial follow state renders
  // synchronously — no client flash from outline → filled on hydration.
  // The session itself is not prop-drilled to the client; only the
  // boolean `isAuthed` and the seed value cross the server/client line.
  // isShell for the follow star's signed-out link only: a client component
  // cannot read the cookie, so the mode is resolved here and passed down.
  const [session, isShell] = await Promise.all([auth(), resolveShellMode().catch(() => false)]);
  const userId = session?.user?.id ?? null;
  const isAuthed = !!session?.user;

  // THE HERO'S RANK COMES FROM THE SERVED LIST for a gridiron team (tue-13):
  // nfl-power-z / cfb-top25, not the Elo columns on `team`. undefined for every
  // other league, which keeps the World Cup hero on its own columns.
  const leagueSlug = team.leagueSlug ?? team.league_slug;
  const [stats, players, squad, trajectory, odds, broadcasters, initialFollowing, power] = await Promise.all([
    getTeamStats(team.id),
    getTopPlayers(team.id),
    getTeamSquad(team.id),
    getTeamTrajectory(team.id),
    getTeamOdds(team.id, next?.id ?? null),
    next ? getNextMatchBroadcasters(next.id) : Promise.resolve([]),
    isFollowingTeam(userId, team.id),
    servedList(leagueSlug) ? servedRankFor(leagueSlug, team.id).catch(() => null) : Promise.resolve(undefined),
  ]);

  const nextInfo = nextMatchOpponentInfo(next, team.id);

  // League-aware chrome. Every one of these falls back to the soccer value, so
  // a World Cup team page renders exactly what it rendered before.
  const gridiron = isGridiron(team.leagueSlug ?? team.league_slug);
  const crumb = breadcrumbFor(team.leagueSlug ?? team.league_slug);
  const pills = anchorPillsFor(team.leagueSlug ?? team.league_slug);
    // The season comes from the schedule itself - `team` carries no season, so
  // the heading read a bare "Season". Newest season the team actually has
  // matches in.
  const seasonYear = matches?.reduce((y, m) => Math.max(y, Number(m.season_year) || 0), 0) || null;
  const scheduleHeading = scheduleHeadingFor(team.leagueSlug ?? team.league_slug, seasonYear);

  return (
    <>
      <BackToAppBar />
      <GlobalHeaderServer />

      <main className="page-shell">
        {/* LEAGUE-AWARE. This was hardcoded to the World Cup on every team
            page, so all 275 gridiron pages told the reader the Chiefs play in
            it. Soccer's crumb is unchanged - breadcrumbFor falls back to the
            same label and href it always had. */}
        <div className="breadcrumb">
          <Link href="/">Home</Link>
          <span className="sep">/</span>
          <a href={crumb.href}>{crumb.label}</a>
          <span className="sep">/</span>
          <a href="#">Teams</a>
          <span className="sep">/</span>
          <span className="current">{team.name}</span>
        </div>

        <TeamHero team={team} isAuthed={isAuthed} initialFollowing={initialFollowing} isShell={isShell} power={power} />
        <SportsvynOutlook team={team} odds={odds} nextMatch={nextInfo} />
        <FormStrip matches={matches} teamId={team.id} stats={stats} />

        {/* Four of these pointed at sections gridiron does not render, so a
            third of the rail went nowhere on every NFL and CFB page. Per
            league now; soccer's seven are byte-identical. */}
        <nav className="anchor-pills">
          {pills.map((p) => (
            <a key={p.href} href={p.href} className="anchor-pill">{p.label}</a>
          ))}
        </nav>

        <RecentNext
          teamId={team.id}
          recent={recent}
          next={next}
          nextBroadcasters={broadcasters}
        />
        {/* The four gridiron-absent sections stop rendering rather than
            rendering empty - GATED = ABSENT. Their readers return nothing for
            gridiron anyway; this stops the page reserving space for them. */}
        {!gridiron && <TeamStatsGrid stats={stats} />}
        {!gridiron && <TopPlayers players={players} />}
        {gridiron
          ? <GridironRoster players={squad} />
          : <SquadList players={squad} teamName={team.name} />}
        {!gridiron && <Trajectory entries={trajectory} />}
        <Schedule matches={matches} teamId={team.id} heading={scheduleHeading} />
        <Articles team={team} />
      </main>

      {/* THE STANDARD FOOTER (mon-16): this page carried its own pre-R5 copy
          - four headed columns, "#" links and the old editorial line. */}
      <SiteFooter />
    </>
  );
}
