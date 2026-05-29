/**
 * /match/[slug] — pre-match / live / recap surface.
 *
 * Port of the locked Option-C layout (sportsvyn-match-prematch-option-c-tabs-twocol.html)
 * with the v2-winprob rail composition. Server Component shell;
 * MatchTabBar is the only client island.
 *
 * SHELL build: every data block is a graceful-empty slot. Real wiring
 * for Watch Score, Win Probability, Edge Pick, Where-to-Watch, Power
 * Rankings, and Form lands in the next slice. The page renders
 * top-to-bottom for sparse-data fixtures (e.g. the USA-Senegal friendly
 * with no rankings, no odds, no recent finals) without crashes and
 * without fabricated content.
 *
 * noindex remains active through the dev-data phase.
 */

import { notFound } from 'next/navigation';
import { sql } from '@/lib/db';
import Wordmark from '@/components/Wordmark';
import MatchMetaStrip from '@/components/match/MatchMetaStrip';
import TeamsHeader from '@/components/match/TeamsHeader';
import MatchTabBar from '@/components/match/MatchTabBar';
import PreviewLeft from '@/components/match/PreviewLeft';
import WatchScoreVertical from '@/components/match/WatchScoreVertical';
import WinProbability from '@/components/match/WinProbability';
import EdgePick from '@/components/match/EdgePick';
import WhereToWatch from '@/components/match/WhereToWatch';
import PowerRankingsCompare from '@/components/match/PowerRankingsCompare';
import FormSection from '@/components/match/FormSection';
import LivePoller from '@/components/match/LivePoller';

import './match.css';

export const metadata = {
  robots: { index: false, follow: false },
};

async function getMatchBySlug(slug) {
  const rows = await sql`
    SELECT
      m.id, m.slug, m.kickoff_at, m.status, m.stage, m.group_code,
      m.home_team_id, m.away_team_id, m.home_score, m.away_score,
      m.venue, m.external_ids,
      h.name                AS home_name,
      h.slug                AS home_slug,
      h.abbreviation        AS home_abbreviation,
      h.flag_color_primary  AS home_flag_color,
      h.flag_svg_path       AS home_flag_svg,
      a.name                AS away_name,
      a.slug                AS away_slug,
      a.abbreviation        AS away_abbreviation,
      a.flag_color_primary  AS away_flag_color,
      a.flag_svg_path       AS away_flag_svg
    FROM matches m
    LEFT JOIN teams h ON h.id = m.home_team_id
    LEFT JOIN teams a ON a.id = m.away_team_id
    WHERE m.slug = ${slug}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function getWatchScore(matchId) {
  const rows = await sql`
    SELECT
      stakes_score, quality_score, narrative_score, drama_score, moment_score,
      composite_score,
      stakes_note, quality_note, narrative_note, drama_note, moment_note,
      watch_summary
    FROM articles
    WHERE match_id = ${matchId}
      AND type = 'preview'
      AND score_type = 'watch'
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function getBroadcasters(matchId, country = 'US') {
  const rows = await sql`
    SELECT broadcaster_name, broadcaster_type, is_primary, display_order, language_code
    FROM match_broadcasters
    WHERE match_id = ${matchId}
      AND country_code = ${country}
    ORDER BY display_order
  `;
  return rows.length ? rows : null;
}

async function getPreview(matchId) {
  const rows = await sql`
    SELECT title, subtitle, body, author, published_at, updated_at
    FROM articles
    WHERE match_id = ${matchId}
      AND type = 'preview'
      AND score_type IS NULL
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

// Cross-league form fetch: the same real team can have multiple teams rows
// (one per league it appears in). The CTE collects all rows sharing the
// same api_sports id so the form query finds matches across leagues.
async function getFormForTeam(teamId) {
  if (!teamId) return null;
  const rows = await sql`
    WITH this_team_ids AS (
      SELECT id FROM teams
      WHERE external_ids->>'api_sports' = (
        SELECT external_ids->>'api_sports' FROM teams WHERE id = ${teamId}
      )
    )
    SELECT
      m.kickoff_at,
      m.home_team_id, m.away_team_id,
      m.home_score, m.away_score,
      (SELECT name FROM teams WHERE id = ${teamId}) AS this_team_name,
      (this_team_ids.id IS NOT NULL)               AS was_home
    FROM matches m
    LEFT JOIN this_team_ids ON this_team_ids.id = m.home_team_id
    WHERE (
        m.home_team_id IN (SELECT id FROM this_team_ids)
        OR m.away_team_id IN (SELECT id FROM this_team_ids)
      )
      AND m.status = 'final'
      AND m.kickoff_at < now()
    ORDER BY m.kickoff_at DESC
    LIMIT 5
  `;
  if (rows.length === 0) return null;

  // Reverse → oldest first so the FormCard pill row reads chronologically
  // left-to-right (newest on the right).
  const results = rows.slice().reverse().map((r) => {
    const us = r.was_home ? r.home_score : r.away_score;
    const them = r.was_home ? r.away_score : r.home_score;
    let code = 'D';
    if (us != null && them != null) {
      if (us > them) code = 'W';
      else if (us < them) code = 'L';
    }
    return { code };
  });

  return {
    team_name: rows[0].this_team_name,
    results,
  };
}

function tabsForStatus(status) {
  const isLive = status === 'live';
  const isFinal = status === 'final';
  return {
    list: [
      { key: 'preview', label: 'Preview' },
      { key: 'lineups', label: 'Lineups & Injuries' },
      { key: 'odds',    label: 'Odds & Projections' },
      {
        key: 'live',
        label: 'Live',
        dot: isLive ? 'live' : 'muted',
      },
      { key: 'recap',   label: 'Recap', hidden: !isFinal },
    ],
    defaultTab: isFinal ? 'recap' : isLive ? 'live' : 'preview',
  };
}

function SiteHeader() {
  return (
    <header className="site-header">
      <div className="brand-row">
        <Wordmark sizeClassName="text-[22px]" />
      </div>
      <div className="nav">
        <a href="/">Home</a>
        <a href="#">Bracket</a>
        <a href="#">Rankings</a>
        <a href="#">Reads</a>
      </div>
      <div className="header-cta">
        <a href="#" className="signin">Sign In</a>
        <button type="button" className="member-btn">Become a Member</button>
      </div>
    </header>
  );
}

function SiteFooter() {
  return (
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
  );
}

export default async function MatchPage({ params }) {
  const { slug } = await params;
  const match = await getMatchBySlug(slug);
  if (!match) notFound();

  const [watchScore, broadcasters, preview, homeForm, awayForm] = await Promise.all([
    getWatchScore(match.id),
    getBroadcasters(match.id, 'US'),
    getPreview(match.id),
    getFormForTeam(match.home_team_id),
    getFormForTeam(match.away_team_id),
  ]);

  const tabs = tabsForStatus(match.status);
  const isLive = match.status === 'live';
  const fixtureApiId = match.external_ids?.api_sports
    ? Number(match.external_ids.api_sports)
    : null;

  return (
    <>
      <SiteHeader />

      <main className="match-page">
        <div className="breadcrumb">
          <a href="/">Home</a>
          <span className="sep">/</span>
          <a href="#">FIFA World Cup 2026</a>
          <span className="sep">/</span>
          <span className="current">{match.home_name} vs {match.away_name}</span>
        </div>

        <MatchMetaStrip match={match} />
        <TeamsHeader match={match} />

        <MatchTabBar tabs={tabs.list} defaultTab={tabs.defaultTab} />

        {/* PREVIEW PANEL */}
        <div
          data-tab-panel="preview"
          className={`tab-panel${tabs.defaultTab === 'preview' ? ' active' : ''}`}
        >
          <div className="preview-twocol">
            <div className="preview-twocol-left">
              <PreviewLeft preview={preview} match={match} />
            </div>
            <div className="preview-twocol-right">
              <WatchScoreVertical score={watchScore} />
              <WinProbability probability={null} homeName={match.home_name} awayName={match.away_name} />
              <EdgePick pick={null} />
              <WhereToWatch broadcasters={broadcasters} />
            </div>
          </div>

          <PowerRankingsCompare home={null} away={null} />
          <FormSection home={homeForm} away={awayForm} />
        </div>

        {/* LINEUPS PANEL */}
        <div
          data-tab-panel="lineups"
          className={`tab-panel${tabs.defaultTab === 'lineups' ? ' active' : ''}`}
        >
          <div className="tab-stub">Lineups & injuries publish ~60 minutes before kickoff.</div>
        </div>

        {/* ODDS PANEL */}
        <div
          data-tab-panel="odds"
          className={`tab-panel${tabs.defaultTab === 'odds' ? ' active' : ''}`}
        >
          <div className="tab-stub">Odds & projections (futures + match props) — wiring next.</div>
        </div>

        {/* LIVE PANEL */}
        <div
          data-tab-panel="live"
          className={`tab-panel${tabs.defaultTab === 'live' ? ' active' : ''}`}
        >
          {isLive ? (
            <LivePoller
              fixtureId={fixtureApiId}
              initialState={{
                status: match.status,
                home_score: match.home_score,
                away_score: match.away_score,
                minute: null,
              }}
            />
          ) : (
            <div className="tab-stub">Live commentary + clock activate at kickoff.</div>
          )}
        </div>

        {/* RECAP PANEL */}
        <div
          data-tab-panel="recap"
          className={`tab-panel${tabs.defaultTab === 'recap' ? ' active' : ''}`}
        >
          <div className="tab-stub">Recap publishes within minutes of full time.</div>
        </div>
      </main>

      <SiteFooter />
    </>
  );
}
