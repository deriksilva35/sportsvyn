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
import SiteHeaderServer from '@/components/SiteHeaderServer';
import SiteFooter from '@/components/SiteFooter';
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
import LiveHero from '@/components/match/LiveHero';
import MatchBrief from '@/components/match/MatchBrief';
import OddsDetail from '@/components/match/OddsDetail';
import MatchLineups from '@/components/match/MatchLineupsPitch';
import KickoffWatcher from '@/components/match/KickoffWatcher';
import KeyMoments from '@/components/match/KeyMoments';
import MatchStats from '@/components/match/MatchStats';
import LiveWatchScore from '@/components/match/LiveWatchScore';

import './match.css';

export const metadata = {
  robots: { index: false, follow: false },
};

// Force dynamic SSR so AI gloss writes (and new match_events rows) flow
// into the next request without rebuild. The render reads gloss off
// match_events; the gloss column is updated out-of-band by the
// generate-gloss pass, and static-cached responses would never see new
// values until a deploy.
export const dynamic = 'force-dynamic';

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
  // status='published' is the render gate — pending_review (status='preview')
  // rows wait for admin and don't surface here. The analyst-pass row carries
  // both the Watch Score dimensions AND the Preview body; getPreview below
  // reads from the same row when it exists.
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
      AND status = 'published'
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

// Reads the 3 current rows from odds_markets (one per outcome) and shapes
// them for the rail. Returns null when the row count isn't exactly 3 or
// any label is missing — the WinProbability component already hides
// itself on null, so absence stays honest.
//
// Returns implied % (primary, drives the rail bars and big numbers) plus
// American odds (secondary, rendered as a small line under each %).
async function getWinProbability(matchId) {
  const rows = await sql`
    SELECT selection_label,
           implied_probability::float AS pct,
           american_odds
    FROM odds_markets
    WHERE match_id = ${matchId}
      AND market_scope = 'match'
      AND market_type = 'match_winner'
      AND is_current = true
  `;
  if (rows.length !== 3) return null;
  const byLabel = Object.fromEntries(rows.map((r) => [r.selection_label, r]));
  if (!byLabel.home || !byLabel.draw || !byLabel.away) return null;
  return {
    home_pct: byLabel.home.pct,
    draw_pct: byLabel.draw.pct,
    away_pct: byLabel.away.pct,
    home_american: byLabel.home.american_odds,
    draw_american: byLabel.draw.american_odds,
    away_american: byLabel.away.american_odds,
  };
}

// Full odds detail for the Odds & Projections tab. Same is_current rows
// as the rail, plus decimal, num_books, fetched_at for the metadata
// footer. Null when no current rows exist for this match.
async function getOddsDetail(matchId) {
  const rows = await sql`
    SELECT selection_label,
           american_odds,
           decimal_odds::float AS decimal_odds,
           implied_probability::float AS implied_pct,
           num_books,
           fetched_at
    FROM odds_markets
    WHERE match_id = ${matchId}
      AND market_scope = 'match'
      AND market_type = 'match_winner'
      AND is_current = true
  `;
  if (rows.length === 0) return null;
  const byLabel = Object.fromEntries(rows.map((r) => [r.selection_label, r]));
  if (!byLabel.home || !byLabel.draw || !byLabel.away) return null;
  return {
    home: byLabel.home,
    draw: byLabel.draw,
    away: byLabel.away,
    num_books: byLabel.home.num_books,
    fetched_at: byLabel.home.fetched_at,
  };
}

// Latest brief for this match. The match_briefs table is indexed on
// (match_id, generated_at DESC); we just take row 0. validation_status
// is included for visibility but doesn't gate render — the fallback
// template still produces a complete brief.
async function getBrief(matchId) {
  const rows = await sql`
    SELECT headline, paragraph_1, paragraph_2, paragraph_3,
           validation_status, generated_at, published_at
    FROM match_briefs
    WHERE match_id = ${matchId}
    ORDER BY generated_at DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

// Newest-first event feed for the Key Moments timeline. is_current=true
// filter ensures VAR-cancelled goals never surface (the disallowed-goal
// row gets flipped to is_current=false by syncMatchEvents). LIMIT 50 is
// well above any realistic match's event count.
async function getKeyMoments(matchId) {
  const rows = await sql`
    SELECT id, minute, minute_extra, event_type, detail, team_side,
           player_name, assist_name, gloss
    FROM match_events
    WHERE match_id = ${matchId} AND is_current = true
    ORDER BY minute DESC, minute_extra DESC NULLS LAST, id DESC
    LIMIT 50
  `;
  return rows;
}

// Current home + away match statistics. Returns null when either side's
// is_current row is missing — MatchStats renders the graceful stub when
// the prop is null, so pre-kickoff (no stats yet) shows that path.
async function getMatchStatistics(matchId) {
  const rows = await sql`
    SELECT team_side, stats
    FROM match_statistics
    WHERE match_id = ${matchId} AND is_current = true
  `;
  if (rows.length !== 2) return null;
  const bySide = Object.fromEntries(rows.map((r) => [r.team_side, r.stats]));
  if (!bySide.home || !bySide.away) return null;
  return { home: bySide.home, away: bySide.away };
}

// Current home + away lineups for the match. Returns null when either
// side's is_current row is missing — MatchLineups falls back to the
// graceful stub on null, so partial states (one side published, one not)
// never render half-empty.
async function getLineups(matchId) {
  const rows = await sql`
    SELECT team_side, formation, players, fetched_at
    FROM match_lineups
    WHERE match_id = ${matchId} AND is_current = true
  `;
  if (rows.length !== 2) return null;
  const bySide = Object.fromEntries(rows.map((r) => [r.team_side, r]));
  if (!bySide.home || !bySide.away) return null;
  return {
    home: bySide.home,
    away: bySide.away,
    fetched_at: bySide.home.fetched_at,
  };
}

async function getPreview(matchId) {
  // Prefer the analyst-pass row (score_type='watch') when it carries a body
  // — that's the single row produced by the pre-match analyst pass, used
  // for BOTH the Watch Score rail AND the editorial Preview left column.
  // Falls back to a human-authored preview (score_type IS NULL) if one was
  // written separately. status='published' filter applies to both — pending
  // admin review (status='preview') keeps the stub on the page.
  const rows = await sql`
    SELECT title, subtitle, body, author, published_at, updated_at, edited_at,
           score_type
    FROM articles
    WHERE match_id = ${matchId}
      AND type = 'preview'
      AND status = 'published'
      AND body IS NOT NULL
    ORDER BY (score_type = 'watch') DESC, updated_at DESC
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
      // Odds tab pulses red during live too — mirrors the locked v4 mock.
      { key: 'odds',    label: 'Odds & Projections', dot: isLive ? 'live' : undefined },
      {
        key: 'live',
        label: 'Live',
        // Dot renders ONLY while status='live'. A 'muted' dot on a
        // postponed/scheduled/cancelled tab reads as "live but inactive"
        // and was the source of the "VS + dead LIVE dot" report.
        dot: isLive ? 'live' : undefined,
      },
      { key: 'recap',   label: 'Recap', hidden: !isFinal },
    ],
    defaultTab: isFinal ? 'recap' : isLive ? 'live' : 'preview',
  };
}

export default async function MatchPage({ params }) {
  const { slug } = await params;
  const match = await getMatchBySlug(slug);
  if (!match) notFound();

  const [watchScore, broadcasters, preview, homeForm, awayForm, winProbability, brief, oddsDetail, lineups, keyMoments, matchStatistics] = await Promise.all([
    getWatchScore(match.id),
    getBroadcasters(match.id, 'US'),
    getPreview(match.id),
    getFormForTeam(match.home_team_id),
    getFormForTeam(match.away_team_id),
    getWinProbability(match.id),
    getBrief(match.id),
    getOddsDetail(match.id),
    getLineups(match.id),
    getKeyMoments(match.id),
    getMatchStatistics(match.id),
  ]);

  const tabs = tabsForStatus(match.status);
  const isLive = match.status === 'live';
  const isFinal = match.status === 'final';

  // Win-prob bar retires at full-time. The frozen pre-kickoff consensus
  // ("MEX 75%" on a 5-1 final) reads oddly at status='final' — recap
  // owns full-time. Same retirement applies in scheduled + live where
  // the bar IS meaningful (pre-kickoff market signal + frozen-at-kickoff
  // honesty during live). Matches the live-XI retirement decision: both
  // surfaces hide at final.
  // Gate centralized here so both consumers (LiveHero's winprob-banner
  // + the Preview tab's WinProbability rail) drop on the same condition
  // without each component having to know the rule.
  const visibleWinProb = isFinal ? null : winProbability;

  // Favored side for the teams-header treatment: highest implied % between
  // home and away (draw doesn't count). Null when no odds — never guess a
  // favorite without market data. Also nulls at final (visibleWinProb is
  // null there) — the actual result is known by then, "favored" highlight
  // is editorial baggage.
  let favoredSide = null;
  if (visibleWinProb) {
    if (visibleWinProb.home_pct > visibleWinProb.away_pct) favoredSide = 'home';
    else if (visibleWinProb.away_pct > visibleWinProb.home_pct) favoredSide = 'away';
  }
  const fixtureApiId = match.external_ids?.api_sports
    ? Number(match.external_ids.api_sports)
    : null;

  return (
    <>
      <SiteHeaderServer />

      <main className="match-page">
        <div className="breadcrumb">
          <a href="/">Home</a>
          <span className="sep">/</span>
          <a href="/world-cup-2026/bracket">FIFA World Cup 2026</a>
          <span className="sep">/</span>
          <span className="current">{match.home_name} vs {match.away_name}</span>
        </div>

        <KickoffWatcher
          slug={match.slug}
          initialStatus={match.status}
          kickoffAt={match.kickoff_at}
        />

        <MatchMetaStrip match={match} />
        {/* LiveHero renders for both 'live' AND 'final' — at final it shows
            the final score with leading-side volt + "Final" label (no live
            pulse, no minute clock). Polling is guarded off inside LiveHero
            for terminal states so a final match doesn't keep calling
            /api/sync/fixture. Scheduled state still falls back to
            TeamsHeader (no score exists yet, "vs" is correct). */}
        {(isLive || isFinal) ? (
          <LiveHero
            fixtureId={fixtureApiId}
            initialState={{
              status: match.status,
              status_short: isFinal ? 'FT' : null,
              home_score: match.home_score,
              away_score: match.away_score,
              minute: null,
            }}
            homeName={match.home_name}
            awayName={match.away_name}
            homeFlagSvg={match.home_flag_svg}
            awayFlagSvg={match.away_flag_svg}
            homeAbbr={match.home_abbreviation}
            awayAbbr={match.away_abbreviation}
            winProbability={visibleWinProb}
          />
        ) : (
          <TeamsHeader match={match} favoredSide={favoredSide} />
        )}

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
              <WinProbability probability={visibleWinProb} homeName={match.home_name} awayName={match.away_name} />
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
          <MatchLineups
            lineups={lineups}
            homeName={match.home_name}
            awayName={match.away_name}
          />
        </div>

        {/* ODDS PANEL */}
        <div
          data-tab-panel="odds"
          className={`tab-panel${tabs.defaultTab === 'odds' ? ' active' : ''}`}
        >
          <OddsDetail
            odds={oddsDetail}
            homeName={match.home_name}
            awayName={match.away_name}
          />
        </div>

        {/* LIVE PANEL — score + minute + winprob live in the LiveHero
            banner above. This panel holds the Key Moments timeline,
            which renders during live AND after FT (the timeline is a
            forensic record of the match — useful in recap too). */}
        <div
          data-tab-panel="live"
          className={`tab-panel${tabs.defaultTab === 'live' ? ' active' : ''}`}
        >
          {/* KeyMoments renders in all three states (scheduled / live /
              final) — its lifecycle scaffold synthesizes KICK-OFF/HT/FT
              markers from match.status so the LIVE tab is never a dead
              empty panel post-kickoff, and the pre-kickoff "no key
              moments yet" stub is owned by the component itself.
              MatchStats (right rail) only renders for live + final. */}
          {isLive || isFinal ? (
            <div className="live-layout">
              <div className="live-main">
                <KeyMoments
                  events={keyMoments}
                  match={{
                    status: match.status,
                    home_score: match.home_score,
                    away_score: match.away_score,
                  }}
                  homeAbbr={match.home_abbreviation}
                  awayAbbr={match.away_abbreviation}
                  homeFlag={match.home_flag_svg}
                  homeFlagColor={match.home_flag_color}
                  awayFlag={match.away_flag_svg}
                  awayFlagColor={match.away_flag_color}
                />
              </div>
              <div className="live-right">
                {/* Three-card rail: live watch score (new) → match stats
                    (existing, wrapped in rail-card chrome) → broadcasters
                    (existing). The wrapped components have their own
                    border/bg neutralized via the .rail-card > .live-stats /
                    .watch-block / .slot-empty CSS reset in match.css so
                    each card reads as a single visual shell. */}
                <div className="rail">
                  <LiveWatchScore match={match} />
                  <div className="rail-card">
                    <MatchStats stats={matchStatistics} minute={null} />
                  </div>
                  <div className="rail-card">
                    <WhereToWatch broadcasters={broadcasters} />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <KeyMoments
              events={keyMoments}
              match={{
                status: match.status,
                home_score: match.home_score,
                away_score: match.away_score,
              }}
              homeAbbr={match.home_abbreviation}
              awayAbbr={match.away_abbreviation}
              homeFlag={match.home_flag_svg}
              homeFlagColor={match.home_flag_color}
              awayFlag={match.away_flag_svg}
              awayFlagColor={match.away_flag_color}
            />
          )}
        </div>

        {/* RECAP PANEL */}
        <div
          data-tab-panel="recap"
          className={`tab-panel${tabs.defaultTab === 'recap' ? ' active' : ''}`}
        >
          <MatchBrief brief={brief} />
        </div>
      </main>

      <SiteFooter />
    </>
  );
}
