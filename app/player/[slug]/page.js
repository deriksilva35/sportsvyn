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
import SiteHeaderServer from '@/components/SiteHeaderServer';
import BackToAppBar from '@/components/BackToAppBar';

import { getPlayerBySlug, getPlayerGroupFixtures } from '@/lib/players';

import PlayerHero from '@/components/player/PlayerHero';
import PlayerBioGrid from '@/components/player/PlayerBioGrid';
import PlayerMatchLog from '@/components/player/PlayerMatchLog';
import DormantSection from '@/components/player/DormantSection';

import './player.css';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const player = await getPlayerBySlug(slug);
  if (!player) return { title: 'Player not found — Sportsvyn' };
  return {
    title: `${player.full_name} — Sportsvyn`,
    description: `Identity, group-stage fixtures, and tournament profile for ${player.full_name}.`,
    robots: { index: false, follow: false },
  };
}

export default async function PlayerPage({ params }) {
  const { slug } = await params;
  const player = await getPlayerBySlug(slug);
  if (!player) notFound();

  const fixtures = await getPlayerGroupFixtures(player.team_id);

  return (
    <>
      <BackToAppBar />
      <SiteHeaderServer />

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

        <PlayerHero player={player} />

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
