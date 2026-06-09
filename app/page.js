/**
 * Sportsvyn homepage — δ "Bracket Wall" (Stage 2).
 *
 * Stage 2 adds:
 *   · AI Daily Card intro read (editor-gated, falls back to placeholder)
 *   · The Market unit wired to tournament_winner odds (explainer, no picks)
 *   · Editorial empty-state signpost when today's slate has no fixtures
 *   · Layout: bracket-wall moved INTO .home-main grid as left-column
 *     child so the rail's empty-state dead-ink band is eliminated
 *   · Rounding helper display1dp() — predictable .x5 → .x[+1] behavior
 *   · Dropped the "Updated each request" Sportsvyn-Now timestamp chrome
 *
 * AI safety: pending-review intros NEVER surface here. Only status='published'.
 * Market: pulls implied_probability + de-vigs across the current ladder.
 * Picks/recommendations/edges are forbidden — the unit is an explainer.
 */

import { sql } from '@/lib/db';
import SiteHeaderServer from '@/components/SiteHeaderServer';
import SiteFooter from '@/components/SiteFooter';

import {
  readFixturesByPtDay,
  toPtIsoDate,
} from '@/lib/scheduleData';
import { getFeaturedReads, getTodaysReads } from '@/lib/articles';
import {
  GROUP_LETTERS,
  getGroupTeams,
  getGroupMatchdayProgress,
  getGroupStageProgress,
} from '@/lib/bracket';
import { getCurrentLiveMatches } from '@/lib/liveMatches';
import { getWatchScoresForDate } from '@/lib/watchScore';
import { getCurrentEdition, getTopN } from '@/lib/rankings';
import { getCurrentDailyCardIntro } from '@/lib/dailyCardIntro';

import './home.css';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

const WC_LEAGUE_SLUG = 'fifa-wc-2026';
const FRIENDLIES_LEAGUE_SLUG = 'international-friendlies';

// =============================================================================
// helpers (pure)
// =============================================================================

function fmtPtDate(date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short', month: 'short', day: 'numeric',
  }).format(date);
}

function fmtKickoffPt(kickoffAt) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(kickoffAt)) + ' PT';
}

// Rounding helper — Number.toFixed has FP quirks (9.05 → "9.1" in V8
// only because the FP rep of 9.05 happens to round up; other .x5 edges
// fall the other way). Using Number.EPSILON nudge makes half-up
// behavior predictable across all .x5 inputs.
function display1dp(n) {
  if (n == null) return null;
  const num = Number(n);
  if (!Number.isFinite(num)) return null;
  return (Math.round(num * 10 + Number.EPSILON) / 10).toFixed(1);
}

function teamShort(name, abbr) {
  if (abbr && abbr.length > 0) return abbr;
  return name ?? '—';
}

function Flag({ svgPath, size = 'inline' }) {
  const cls = size === 'tiny' ? 'flag-tiny-svg' : 'flag-inline-svg';
  if (!svgPath) return <span className={`${cls} flag-inline-empty`} aria-hidden="true" />;
  return (
    <span
      className={cls}
      role="img"
      aria-hidden="true"
      style={{ backgroundImage: `url(${svgPath})` }}
    />
  );
}

// =============================================================================
// THE MARKET — de-vig'd tournament-winner ladder reader (explainer only)
//
// Reads current tournament_winner odds_markets rows for the WC league.
// De-vigs the implied probabilities so they sum to ~100% (the raw
// implied probs include the bookmaker margin / "vig"; dividing each by
// the sum normalizes them). Returns top N by de-vig.
//
// NO picks. The data feeds an explainer paragraph + a small ladder.
// =============================================================================
async function readTournamentWinnerLadder({ leagueSlug, limit = 5 }) {
  const rows = await sql`
    SELECT om.team_id,
           t.name  AS team_name,
           t.slug  AS team_slug,
           t.flag_svg_path,
           om.implied_probability::float AS implied_prob,
           om.decimal_odds::float        AS decimal_odds,
           om.num_books,
           om.fetched_at
      FROM odds_markets om
      JOIN teams   t  ON t.id  = om.team_id
      JOIN leagues lg ON lg.id = om.league_id
     WHERE lg.slug          = ${leagueSlug}
       AND om.market_type   = 'tournament_winner'
       AND om.is_current    = true
       AND om.team_id IS NOT NULL
       AND om.implied_probability IS NOT NULL
     ORDER BY om.implied_probability DESC
  `;
  if (rows.length === 0) return { rows: [], num_books: 0, fetched_at: null };

  // De-vig: normalize so the implied probabilities sum to 1.
  const sum = rows.reduce((acc, r) => acc + (r.implied_prob ?? 0), 0);
  const devigged = rows.map((r) => ({
    team_id: r.team_id,
    team_name: r.team_name,
    team_slug: r.team_slug,
    flag_svg_path: r.flag_svg_path,
    raw_implied: r.implied_prob,
    devig_implied: sum > 0 ? r.implied_prob / sum : null,
    decimal_odds: r.decimal_odds,
  }));

  // Sort by de-vig (same order as raw since divisor is constant, but
  // explicit) and take the top N.
  devigged.sort((a, b) => (b.devig_implied ?? 0) - (a.devig_implied ?? 0));

  return {
    rows: devigged.slice(0, limit),
    num_books: rows[0].num_books ?? null,
    fetched_at: rows[0].fetched_at ?? null,
    total_teams_priced: rows.length,
  };
}

// =============================================================================
// Daily Card sections
// =============================================================================
function DailyCardHeader({ ptDateLabel }) {
  return (
    <div className="dc-header">
      <div className="dc-title-row">
        <div className="dc-title">Today&rsquo;s <span className="accent">Card</span></div>
      </div>
      <div className="dc-header-meta-group">
        <div className="dc-meta">{ptDateLabel}</div>
        <a href="/bracket" className="dc-header-link">Full Bracket →</a>
      </div>
    </div>
  );
}

const PLACEHOLDER_INTRO = "The 2026 World Cup arrives in three days, and the case for every side is already written into the squads we've named. Today's card sets the bracket as it stands. Group draws are settled. Friendlies are finishing. The match feed becomes the column on June 11.";

function DailyCardIntro({ publishedIntro }) {
  // Reads ONLY status='published' rows. Pending review / rejected stay
  // off the homepage. Fallback when nothing is published yet.
  const body = publishedIntro?.body ?? PLACEHOLDER_INTRO;
  return <p className="dc-intro">{body}</p>;
}

function DailyCardByline({ ptDateLabel }) {
  return (
    <div className="dc-author">
      <span>By</span> <span className="author">Derik Silva</span>
      <span className="sep">·</span>
      <span>{ptDateLabel}</span>
    </div>
  );
}

// Designed empty-state signpost — replaces the previous "deflated populated
// section" pattern. Has its own treatment (volt-left bar, italic editorial
// prose, factual next-fixture anchor) so it reads as intentional.
function SlateSignpost({ nextFixture }) {
  // Anchor copy from the next real fixture if we have one; else a static
  // pre-tournament line.
  let anchor;
  if (nextFixture) {
    const home = nextFixture.home?.name ?? '?';
    const away = nextFixture.away?.name ?? '?';
    const date = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      month: 'long', day: 'numeric',
    }).format(new Date(nextFixture.kickoff_at));
    const venue = nextFixture.venue ? `, ${nextFixture.venue}` : '';
    anchor = `The slate opens ${date} — ${home} v ${away}${venue}.`;
  } else {
    anchor = 'The slate opens June 11 — the World Cup’s first match.';
  }
  return (
    <div className="dc-section">
      <div className="dc-slate-signpost">
        <div className="dc-slate-signpost-label">No matches today</div>
        <div className="dc-slate-signpost-anchor">{anchor}</div>
      </div>
    </div>
  );
}

function SlateRow({ fixture, watchScore }) {
  const isLive  = fixture.status === 'live';
  const isFinal = fixture.status === 'final';
  return (
    <a className="dc-match-row" href={`/match/${fixture.slug}`}>
      <div className="dc-match-teams">
        <Flag svgPath={fixture.home?.flag_svg_path} />
        {teamShort(fixture.home?.name, fixture.home?.abbreviation)}
        {' v '}
        <span style={{ marginLeft: '6px', display: 'inline-flex', alignItems: 'center' }}>
          <Flag svgPath={fixture.away?.flag_svg_path} />
          {teamShort(fixture.away?.name, fixture.away?.abbreviation)}
        </span>
        {isLive && <span className="dc-live-tag">· LIVE</span>}
      </div>
      <div className="dc-match-time">
        {isFinal
          ? `FT ${fixture.home_score ?? 0}–${fixture.away_score ?? 0}`
          : isLive
            ? `${fixture.home_score ?? 0}–${fixture.away_score ?? 0}`
            : fmtKickoffPt(fixture.kickoff_at)}
      </div>
      {watchScore != null ? (
        <div className="dc-match-ws">{display1dp(watchScore)}</div>
      ) : (
        <div className="dc-match-ws" aria-hidden="true">&nbsp;</div>
      )}
    </a>
  );
}

function SlateSection({ fixtures, watchScoreByMatchId, nextFixture }) {
  if (fixtures.length === 0) {
    return <SlateSignpost nextFixture={nextFixture} />;
  }
  return (
    <div className="dc-section">
      <div className="dc-section-label">
        Today&rsquo;s Slate · {fixtures.length} {fixtures.length === 1 ? 'Match' : 'Matches'}
      </div>
      {fixtures.map((f) => (
        <SlateRow key={f.id} fixture={f} watchScore={watchScoreByMatchId.get(f.id) ?? null} />
      ))}
    </div>
  );
}

function TournamentProgress({ groupProgress }) {
  const played = groupProgress.final_group;
  const matchdaysPlayed = groupProgress.total_matchdays_played;
  return (
    <div className="dc-section">
      <div className="dc-section-label-row">
        <div className="dc-section-label">Tournament Progress</div>
        <a href="/bracket" className="dc-section-link">Full Bracket →</a>
      </div>
      <div className="dc-bracket-strip">
        <div className={`dc-bracket-round${played === 0 ? '' : ' active'}`}>
          <div className="dc-bracket-round-label">Group Stage</div>
          <div className="dc-bracket-round-count">{matchdaysPlayed}</div>
          <div className="dc-bracket-round-meta">of 3 matchdays</div>
        </div>
        <div className="dc-bracket-round">
          <div className="dc-bracket-round-label">R32</div>
          <div className="dc-bracket-round-count">0</div>
          <div className="dc-bracket-round-meta">begins Jun 28</div>
        </div>
        <div className="dc-bracket-round">
          <div className="dc-bracket-round-label">R16</div>
          <div className="dc-bracket-round-count">0</div>
          <div className="dc-bracket-round-meta">begins Jul 4</div>
        </div>
        <div className="dc-bracket-round">
          <div className="dc-bracket-round-label">Final</div>
          <div className="dc-bracket-round-count">—</div>
          <div className="dc-bracket-round-meta">Jul 19 · MetLife</div>
        </div>
      </div>
    </div>
  );
}

function TodaysReadsSection({ reads }) {
  if (!reads || reads.length === 0) return null;
  return (
    <div className="dc-section">
      <div className="dc-section-label">
        Today&rsquo;s Reads · {reads.length} {reads.length === 1 ? 'Piece' : 'Pieces'}
      </div>
      {reads.filter((r) => r.match_slug).map((r) => (
        <a key={r.slug} className="dc-read-row" href={`/match/${r.match_slug}`}>
          <div>
            <div className="dr-kicker">{r.kicker}</div>
            <div className="dr-headline">{r.title}</div>
          </div>
          <div className="dr-read-time">{r.read_time_min} min</div>
        </a>
      ))}
    </div>
  );
}

// =============================================================================
// THE MARKET — explainer unit (replaces the Stage-1 shell)
// =============================================================================
// Need ~half a credible field priced before the ladder reads as a market.
const MARKET_MIN_FIELD = 8;

function MarketUnit({ ladder }) {
  // Thin field → fall back to the shell (a 1- or 2-team ladder isn't a ladder).
  if (!ladder || ladder.rows.length < MARKET_MIN_FIELD) {
    return (
      <div className="dc-section">
        <div className="dc-section-label">The Market</div>
        <div className="dc-market">
          <div className="dc-market-label">Market Explainer</div>
          <div className="dc-market-body">
            The bookmakers&rsquo; consensus reads the tournament before a ball
            is kicked. Once odds publish for the 2026 field, this unit will
            translate the live market into a plain-English read of where
            the money sits.
          </div>
          <div className="dc-market-footnote">Coming this week · explain don&rsquo;t pick</div>
        </div>
      </div>
    );
  }

  // De-vigged top side anchors the headline sentence.
  const leader = ladder.rows[0];
  const leaderPct = (leader.devig_implied * 100).toFixed(1);

  return (
    <div className="dc-section">
      <div className="dc-section-label">The Market</div>
      <div className="dc-market">
        <div className="dc-market-label">Market Explainer</div>
        <p className="dc-market-body">
          The bookmakers read {leader.team_name} as the favorite, with the
          de-vigged market giving them roughly {leaderPct}% implied
          probability to lift the trophy. Below them, the top of the
          ladder runs:
        </p>
        <ol className="dc-market-ladder">
          {ladder.rows.map((r, i) => (
            <li key={r.team_id}>
              <span className="dcml-pos">{i + 1}</span>
              <Flag svgPath={r.flag_svg_path} size="tiny" />
              <span className="dcml-name">{r.team_name}</span>
              <span className="dcml-pct">{(r.devig_implied * 100).toFixed(1)}%</span>
            </li>
          ))}
        </ol>
        <div className="dc-market-footnote">
          Devig &middot; {ladder.total_teams_priced} teams priced
          {ladder.num_books ? ` · ${ladder.num_books} books` : ''}
          {' · '}
          {/* TODO Stage 2.5: /methodology page lives here once written. */}
          <a href="/methodology" className="dc-market-method">how we read the market →</a>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Right-rail blocks
// =============================================================================
function LiveOrNextBlock({ liveMatches, nextFixture }) {
  if (liveMatches.length > 0) {
    const m = liveMatches[0];
    return (
      <a className="sidebar-block live" href={`/match/${m.slug}`}>
        <div className="sb-label">Live</div>
        <div className="sb-title">
          <Flag svgPath={m.home_flag_svg} />
          {teamShort(m.home_name, m.home_abbr)} {m.home_score ?? 0} — {m.away_score ?? 0}{' '}
          {teamShort(m.away_name, m.away_abbr)}
        </div>
        <div className="sb-meta">In progress</div>
      </a>
    );
  }
  if (!nextFixture) {
    return (
      <div className="sidebar-block">
        <div className="sb-label">Next Up</div>
        <div className="sb-title">No upcoming match scheduled</div>
        <div className="sb-meta">Check back as the slate fills</div>
      </div>
    );
  }
  return (
    <a className="sidebar-block" href={`/match/${nextFixture.slug}`}>
      <div className="sb-label">Next Up</div>
      <div className="sb-title">
        <Flag svgPath={nextFixture.home?.flag_svg_path} />
        {teamShort(nextFixture.home?.name, nextFixture.home?.abbreviation)} v{' '}
        {teamShort(nextFixture.away?.name, nextFixture.away?.abbreviation)}
      </div>
      <div className="sb-meta">{fmtKickoffPt(nextFixture.kickoff_at)}</div>
    </a>
  );
}

function TodaysCardSummaryBlock({ fixtureCount, readCount }) {
  return (
    <div className="sidebar-block">
      <div className="sb-label">Today&rsquo;s Card</div>
      <div className="sb-title">The Pre-tournament Read</div>
      <div className="sb-meta">
        {fixtureCount} {fixtureCount === 1 ? 'match' : 'matches'} ·{' '}
        {readCount} {readCount === 1 ? 'read' : 'reads'}
      </div>
    </div>
  );
}

function FeaturedReadsList({ reads, label = 'Featured Reads' }) {
  if (!reads || reads.length === 0) return null;
  return (
    <div className="sidebar-list">
      <div className="sl-label">{label}</div>
      {reads.map((r) => (
        <a key={r.slug} className="fr-item" href={`/article/${r.slug}`}>
          <div className="fr-kicker">{r.kicker} · {r.read_time_min} min</div>
          <div className="fr-headline">{r.title}</div>
        </a>
      ))}
    </div>
  );
}

function moveClass(label) {
  if (label === 'up')   return 'move-up';
  if (label === 'down') return 'move-down';
  return 'move-flat';
}
function moveGlyph(label) {
  if (label === 'up')   return '▲';
  if (label === 'down') return '▼';
  if (label === 'new')  return '★';
  return '—';
}

function PowerRankingsList({ topRows }) {
  if (!topRows || topRows.length === 0) {
    return (
      <div className="sidebar-list">
        <div className="sl-label">Power Rankings · Top 5</div>
        <div className="sl-empty">Coming this week</div>
      </div>
    );
  }
  return (
    <div className="sidebar-list">
      <div className="sl-label">Power Rankings · Top 5</div>
      {topRows.map((r) => (
        <a key={r.team_id} className="sl-item" href={`/team/${r.team_slug}`}>
          <span className="pos">{r.rank}</span>
          <span className="name">{r.team_name}</span>
          <span className="val">
            <span className={moveClass(r.movement_label)}>{moveGlyph(r.movement_label)}</span>{' '}
            {display1dp(r.score)}
          </span>
        </a>
      ))}
    </div>
  );
}

function WatchScoresTodayList({ rows }) {
  if (!rows || rows.length === 0) return null;
  return (
    <div className="sidebar-list">
      <div className="sl-label">Watch Scores · Today</div>
      {rows.map((r, i) => (
        <a key={r.match_id} className="sl-item" href={`/match/${r.slug}`}>
          <span className="pos">{i + 1}</span>
          <span className="name">
            <Flag svgPath={r.home_flag_svg} size="tiny" />
            {teamShort(r.home_name, r.home_abbr)} v {teamShort(r.away_name, r.away_abbr)}
          </span>
          <span className="val volt">{display1dp(r.composite) ?? '—'}</span>
        </a>
      ))}
    </div>
  );
}

// =============================================================================
// Below-fold bracket wall (group stage at launch, lives INSIDE .home-main now)
// =============================================================================
function HomeGroupCard({ letter, teams, matchdaysComplete }) {
  return (
    <div className="home-group-card">
      <div className="home-group-card-header">
        <div className="home-group-card-label">{letter}</div>
        <div className="home-group-card-meta">{matchdaysComplete} of 3</div>
      </div>
      {teams.map((t) => (
        <div key={t.id} className="home-group-card-row">
          <Flag svgPath={t.flag_svg_path} />
          <span>{t.name}</span>
        </div>
      ))}
    </div>
  );
}

function BracketWallGroupStage({ groupTeams, matchdayMap }) {
  return (
    <section className="bracket-wall-section">
      <div className="bracket-wall-inner">
        <div className="bw-header">
          <div className="bw-title-row">
            <div className="bw-title">The <span className="accent">Bracket</span></div>
            <div className="bw-stage">Group Stage · 12 Groups</div>
          </div>
          <a href="/bracket" className="bw-link">Full Bracket Page →</a>
        </div>
        <div className="home-groups-grid">
          {GROUP_LETTERS.map((letter) => (
            <HomeGroupCard
              key={letter}
              letter={letter}
              teams={groupTeams.get(letter) ?? []}
              matchdaysComplete={matchdayMap.get(letter) ?? 0}
            />
          ))}
        </div>
        {/* TODO Stage 2.5+: swap to knockout-tree mirror once R32 draw lands. */}
      </div>
    </section>
  );
}

function MoreFromSportsvyn({ reads }) {
  if (!reads || reads.length === 0) return null;
  return (
    <section className="more-from-section">
      <div className="more-from-inner">
        <div className="more-from-title">More from Sportsvyn</div>
        <FeaturedReadsList reads={reads} label="Recent Reads" />
      </div>
    </section>
  );
}

function SubscribeBand() {
  return (
    <div className="subscribe-band">
      <div className="sb-text">
        The World Cup is free to read.
        <em>Founding membership $99/year — unlocks the rest of the year.</em>
      </div>
      <a href="/signin" className="sb-button">Become a Founding Member</a>
    </div>
  );
}

// =============================================================================
// MAIN PAGE
// =============================================================================
export default async function HomePage() {
  const now = new Date();
  const ptDay = toPtIsoDate(now);
  const ptDateLabel = fmtPtDate(now);

  // Parallel reads — every helper returns [] / null on absence.
  const [
    todaysFixtures,
    todaysFixturesFriendlies,
    todaysReads,
    featuredReads,
    moreReads,
    liveMatches,
    watchScoresToday,
    groupTeams,
    matchdayMap,
    groupProgress,
    rankingTop5,
    publishedIntro,
    marketLadder,
  ] = await Promise.all([
    readFixturesByPtDay({ leagueSlug: WC_LEAGUE_SLUG, ptStart: ptDay, ptEnd: ptDay }),
    readFixturesByPtDay({ leagueSlug: FRIENDLIES_LEAGUE_SLUG, ptStart: ptDay, ptEnd: ptDay }),
    getTodaysReads({ ptDay, limit: 4 }),
    Promise.resolve([]),  // Featured Reads — hidden until real long-form ships
    Promise.resolve([]),  // Recent Reads   — same; previews already live on /match/[slug]
    getCurrentLiveMatches(),
    getWatchScoresForDate(ptDay),
    getGroupTeams(),
    getGroupMatchdayProgress(),
    getGroupStageProgress(),
    getTopN({ listSlug: 'team-power', leagueSlug: WC_LEAGUE_SLUG, limit: 5 }),
    getCurrentDailyCardIntro(ptDay),
    readTournamentWinnerLadder({ leagueSlug: WC_LEAGUE_SLUG, limit: 5 }),
  ]);

  const slate = todaysFixtures.length > 0 ? todaysFixtures : todaysFixturesFriendlies;

  const watchScoreByMatchId = new Map();
  for (const r of watchScoresToday) watchScoreByMatchId.set(r.match_id, r.composite);

  // Next-fixture lookup for the slate-empty signpost + Sportsvyn-Now
  // Next-Up block. Pulled separately so the signpost has it even when
  // the slate has no rows.
  const nextRows = await sql`
    SELECT m.id, m.slug, m.kickoff_at, m.status, m.venue,
           h.id AS home_id, h.name AS home_name, h.abbreviation AS home_abbreviation, h.flag_svg_path AS home_flag_svg,
           a.id AS away_id, a.name AS away_name, a.abbreviation AS away_abbreviation, a.flag_svg_path AS away_flag_svg
      FROM matches m
      JOIN teams h ON h.id = m.home_team_id
      JOIN teams a ON a.id = m.away_team_id
      JOIN leagues lg ON lg.id = m.league_id
     WHERE lg.slug = ${WC_LEAGUE_SLUG}
       AND m.kickoff_at > now()
     ORDER BY m.kickoff_at
     LIMIT 1
  `;
  const nextFixture = nextRows[0]
    ? {
        slug: nextRows[0].slug,
        kickoff_at: nextRows[0].kickoff_at,
        status: nextRows[0].status,
        venue: nextRows[0].venue,
        home: { name: nextRows[0].home_name, abbreviation: nextRows[0].home_abbreviation, flag_svg_path: nextRows[0].home_flag_svg },
        away: { name: nextRows[0].away_name, abbreviation: nextRows[0].away_abbreviation, flag_svg_path: nextRows[0].away_flag_svg },
      }
    : null;

  const topFeatured = featuredReads;
  const belowFeatured = moreReads.slice(3, 6);
  const showMoreRail = belowFeatured.length > 0;
  const showRankings = rankingTop5.length > 0;
  const readCount = todaysReads.length;

  return (
    <>
      <SiteHeaderServer activeNav="home" />

      <main className="home-main">
        {/* LEFT COLUMN — Daily Card + Bracket Wall, stacked.
            Bracket Wall lives INSIDE the grid now so a short Daily Card
            doesn't leave dead ink beside the sticky rail. */}
        <div className="home-main-left">
          <article className="daily-card">
            <DailyCardHeader ptDateLabel={ptDateLabel} />
            <DailyCardIntro publishedIntro={publishedIntro} />
            <DailyCardByline ptDateLabel={ptDateLabel} />

            <SlateSection
              fixtures={slate}
              watchScoreByMatchId={watchScoreByMatchId}
              nextFixture={nextFixture}
            />

            <TournamentProgress groupProgress={groupProgress} />

            <TodaysReadsSection reads={todaysReads} />

            <MarketUnit ladder={marketLadder} />
          </article>

          <BracketWallGroupStage groupTeams={groupTeams} matchdayMap={matchdayMap} />
        </div>

        {/* RIGHT COLUMN — Sportsvyn Now rail */}
        <aside className="right-rail">
          <div className="sidebar-zone-header">
            <span>Sportsvyn Now</span>
          </div>

          <LiveOrNextBlock liveMatches={liveMatches} nextFixture={nextFixture} />
          <TodaysCardSummaryBlock fixtureCount={slate.length} readCount={readCount} />
          <FeaturedReadsList reads={topFeatured} label="Featured Reads" />
          <PowerRankingsList topRows={showRankings ? rankingTop5 : []} />
          <WatchScoresTodayList rows={watchScoresToday.slice(0, 3)} />
        </aside>
      </main>

      {showMoreRail && <MoreFromSportsvyn reads={belowFeatured} />}

      <SubscribeBand />

      <SiteFooter />
    </>
  );
}
