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

import { notFound } from 'next/navigation';
import Wordmark from '@/components/Wordmark';
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

import TeamHero from '@/components/team/TeamHero';
import SportsvynOutlook from '@/components/team/SportsvynOutlook';
import FormStrip from '@/components/team/FormStrip';
import RecentNext from '@/components/team/RecentNext';
import TeamStatsGrid from '@/components/team/TeamStatsGrid';
import TopPlayers from '@/components/team/TopPlayers';
import SquadList from '@/components/team/SquadList';
import Trajectory from '@/components/team/Trajectory';
import Schedule from '@/components/team/Schedule';
import Articles from '@/components/team/Articles';

import './team.css';

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const team = await getTeamBySlug(slug);
  if (!team) return { title: 'Team not found — Sportsvyn' };
  return {
    title: `${team.name} — Sportsvyn`,
    description: `Power ranking, form, stats, top performers, and schedule for ${team.name}.`,
    robots: { index: false, follow: false },
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

  const matches = await getTeamMatches(team.id);
  const { recent, next } = pickRecentAndNext(matches);

  const [stats, players, squad, trajectory, odds, broadcasters] = await Promise.all([
    getTeamStats(team.id),
    getTopPlayers(team.id),
    getTeamSquad(team.id),
    getTeamTrajectory(team.id),
    getTeamOdds(team.id, next?.id ?? null),
    next ? getNextMatchBroadcasters(next.id) : Promise.resolve([]),
  ]);

  const nextInfo = nextMatchOpponentInfo(next, team.id);

  return (
    <>
      <header className="site-header">
        <div className="site-header-inner">
          <div className="brand-row">
            <Wordmark sizeClassName="text-[22px]" />
            <div className="crumb">
              <span className="accent">WORLD CUP 2026</span>
              <span className="sep">/</span>
              TEAM
            </div>
          </div>
          <div className="nav">
            <a href="#">Bracket</a>
            <a href="#">Rankings</a>
            <a href="#">Stats</a>
            <a href="#">Reads</a>
          </div>
        </div>
      </header>

      <main className="page-shell">
        <div className="breadcrumb">
          <a href="/">Home</a>
          <span className="sep">/</span>
          <a href="#">FIFA World Cup 2026</a>
          <span className="sep">/</span>
          <a href="#">Teams</a>
          <span className="sep">/</span>
          <span className="current">{team.name}</span>
        </div>

        <TeamHero team={team} />
        <SportsvynOutlook team={team} odds={odds} nextMatch={nextInfo} />
        <FormStrip matches={matches} teamId={team.id} stats={stats} />

        <nav className="anchor-pills">
          <a href="#matches" className="anchor-pill">Recent + Next</a>
          <a href="#stats" className="anchor-pill">Team Stats</a>
          <a href="#players" className="anchor-pill">Top Players</a>
          <a href="#squad" className="anchor-pill">Squad</a>
          <a href="#trajectory" className="anchor-pill">Trajectory</a>
          <a href="#schedule" className="anchor-pill">Schedule</a>
          <a href="#articles" className="anchor-pill">Articles</a>
        </nav>

        <RecentNext
          teamId={team.id}
          recent={recent}
          next={next}
          nextBroadcasters={broadcasters}
        />
        <TeamStatsGrid stats={stats} />
        <TopPlayers players={players} />
        <SquadList players={squad} teamName={team.name} />
        <Trajectory entries={trajectory} />
        <Schedule matches={matches} teamId={team.id} />
        <Articles team={team} />
      </main>

      <footer className="site-footer">
        <div className="site-footer-inner">
          <div className="footer-brand">
            <Wordmark sizeClassName="text-[28px]" />
            <p className="tagline">Read the Game. Editorial sports coverage that takes the reader seriously.</p>
            <p className="copyright">© 2026 Sportsvyn · Considered Network</p>
          </div>
          <div className="footer-links">
            <div className="footer-col">
              <h4>Read</h4>
              <a href="#">Daily Card</a>
              <a href="#">Bracket</a>
              <a href="#">Rankings</a>
              <a href="#">Stats</a>
            </div>
            <div className="footer-col">
              <h4>About</h4>
              <a href="#">Methodology</a>
              <a href="#">Voice Bible</a>
            </div>
            <div className="footer-col">
              <h4>Follow</h4>
              <a href="#">Newsletter</a>
              <a href="#">RSS</a>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}
