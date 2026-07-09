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
  readScheduleGoals,
  toPtIsoDate,
} from '@/lib/scheduleData';
import { getFeaturedReads, getTodaysReads } from '@/lib/articles';
import {
  GROUP_LETTERS,
  getGroupTeams,
  getGroupStandings,
  getGroupMatchdayProgress,
  getGroupStageProgress,
  getKnockoutRoundProgress,
} from '@/lib/bracket';
import { getCurrentLiveMatches } from '@/lib/liveMatches';
import { getWatchScoresForDate } from '@/lib/watchScore';
import { getCurrentEdition, getTopN, getPlayerTopN } from '@/lib/rankings';
import { getCurrentDailyCardIntro } from '@/lib/dailyCardIntro';
import { getFollowedTeamIds } from '@/lib/follows';
import { getMarketPanelData } from '@/lib/dashboard';
import { auth } from '@/auth';
import FixtureCard, { bucketOf } from '@/components/match/FixtureCard';
import KickoffTime from '@/components/match/KickoffTime';

import './home.css';

// PT-day arithmetic on YYYY-MM-DD strings (no timezone drift).
// Mirrors ScheduleClient's helpers so the homepage's 3-day window
// shares the same date semantics as /schedule.
function addPtDays(ptDateStr, n) {
  const [y, m, d] = ptDateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
const PT_WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const PT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function ptDayLabel(ptDateStr) {
  const [y, m, d] = ptDateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return {
    weekday: PT_WEEKDAYS[dt.getUTCDay()],
    monthDay: `${PT_MONTHS[dt.getUTCMonth()]} ${dt.getUTCDate()}`,
  };
}

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

const WC_LEAGUE_SLUG = 'fifa-wc-2026';

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

// NOTE: the tournament-winner (futures) ladder reader was retired here — the
// data provider has no outright/tournament-winner market, so the ladder was
// permanently starved. The Market unit now reads the tagged board instead (see
// MarketUnit + getMarketPanelData). lib/teams.js still has a market_scope=
// 'futures' team-page block; that is a separate hygiene item, left untouched.

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
        <a href="/world-cup-2026/bracket" className="dc-header-link">Full Bracket →</a>
      </div>
    </div>
  );
}

// Evergreen fallback — shown when no daily_card_intros row is published
// for today. No date references, no countdowns; ages without rotting.
// The published-row path (getCurrentDailyCardIntro) overrides this when
// an editor approves a daily intro for the day.
const PLACEHOLDER_INTRO = "Today’s card reads the tournament as it stands — what’s settled, what’s still open, and what’s worth your attention next.";

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

function SlateRow({ fixture, watchScore, followedSet }) {
  const isLive  = fixture.status === 'live';
  const isFinal = fixture.status === 'final';
  // fixture.home.id / fixture.away.id ride in from readFixturesByPtDay
  // (lib/scheduleData.js projects { id, name, abbreviation, flag_svg_path,
  // flag_color }) — no SQL change. We wrap each team-name text node in
  // its own span so the tint is scoped to the name only and the flag,
  // 'v' separator, and live tag stay paper-warm.
  const homeFollowed = followedSet?.has(fixture.home?.id);
  const awayFollowed = followedSet?.has(fixture.away?.id);
  return (
    <a className="dc-match-row" href={`/match/${fixture.slug}`}>
      <div className="dc-match-teams">
        <Flag svgPath={fixture.home?.flag_svg_path} />
        <span className={homeFollowed ? 'team-name-followed' : undefined}>
          {teamShort(fixture.home?.name, fixture.home?.abbreviation)}
        </span>
        {' v '}
        <span style={{ marginLeft: '6px', display: 'inline-flex', alignItems: 'center' }}>
          <Flag svgPath={fixture.away?.flag_svg_path} />
          <span className={awayFollowed ? 'team-name-followed' : undefined}>
            {teamShort(fixture.away?.name, fixture.away?.abbreviation)}
          </span>
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

function SlateSection({ fixtures, watchScoreByMatchId, nextFixture, followedSet }) {
  if (fixtures.length === 0) {
    return <SlateSignpost nextFixture={nextFixture} />;
  }
  return (
    <div className="dc-section">
      <div className="dc-section-label">
        Today&rsquo;s Slate · {fixtures.length} {fixtures.length === 1 ? 'Match' : 'Matches'}
      </div>
      {fixtures.map((f) => (
        <SlateRow
          key={f.id}
          fixture={f}
          watchScore={watchScoreByMatchId.get(f.id) ?? null}
          followedSet={followedSet}
        />
      ))}
    </div>
  );
}

// Knockout tiles, in bracket order. Counts come from getKnockoutRoundProgress
// (real per-stage completed/total), NOT the old hardcoded zeros; QF + SF are
// added (the prior strip jumped R16 -> Final).
const KO_PROGRESS_TILES = [
  { stage: 'round_of_32', label: 'R32' },
  { stage: 'round_of_16', label: 'R16' },
  { stage: 'quarter',     label: 'QF' },
  { stage: 'semi',        label: 'SF' },
  { stage: 'final',       label: 'Final' },
];

function TournamentProgress({ groupProgress, koProgress = {} }) {
  const matchdaysPlayed = groupProgress.min_matchdays_complete;
  const groupComplete = matchdaysPlayed >= 3;
  return (
    <div className="dc-section">
      <div className="dc-section-label-row">
        <div className="dc-section-label">Tournament Progress</div>
        <a href="/world-cup-2026/bracket" className="dc-section-link">Full Bracket →</a>
      </div>
      <div className="dc-bracket-strip">
        <div className={`dc-bracket-round${matchdaysPlayed > 0 ? ' active' : ''}`}>
          <div className="dc-bracket-round-label">Group Stage</div>
          <div className="dc-bracket-round-count">{groupComplete ? '3' : matchdaysPlayed}</div>
          <div className="dc-bracket-round-meta">of 3 matchdays</div>
        </div>
        {KO_PROGRESS_TILES.map(({ stage, label }) => {
          const p = koProgress[stage] ?? { total: 0, final: 0, live: 0 };
          const started = p.final > 0 || p.live > 0;
          return (
            <div key={stage} className={`dc-bracket-round${started ? ' active' : ''}`}>
              <div className="dc-bracket-round-label">{label}</div>
              <div className="dc-bracket-round-count">{p.total > 0 ? p.final : '—'}</div>
              <div className="dc-bracket-round-meta">{p.total > 0 ? `of ${p.total}` : 'pending'}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TodaysReadsSection({ reads, followedSet }) {
  if (!reads || reads.length === 0) return null;
  return (
    <div className="dc-section">
      <div className="dc-section-label">
        Today&rsquo;s Reads · {reads.length} {reads.length === 1 ? 'Piece' : 'Pieces'}
      </div>
      {reads.map((r) => {
        // Preview rows live on /match/[slug] (the body renders inside
        // the match Preview tab). Essays/edge/etc. live at /article/[slug].
        // match_slug distinguishes the two; null means the article isn't
        // attached to a match, so the article reader is the right route.
        const href = r.match_slug ? `/match/${r.match_slug}` : `/article/${r.slug}`;
        // Volt-title tint on followed-team previews. home_team_id /
        // away_team_id ride in from getTodaysReads via the matches
        // join and are null for non-preview rows (no match_id), so the
        // null-guard silently skips essays/edges/profiles. Same primitive
        // as the team-name tint shipped in f1da5a5; the followedSet is
        // the homepage's existing Set computed once via getFollowedTeamIds.
        const teamFollowed =
          (r.home_team_id != null && followedSet?.has(r.home_team_id)) ||
          (r.away_team_id != null && followedSet?.has(r.away_team_id));
        const headlineClass = teamFollowed ? 'dr-headline team-name-followed' : 'dr-headline';
        return (
          <a key={r.slug} className="dc-read-row" href={href}>
            <div>
              <div className="dr-kicker">{r.kicker}</div>
              <div className={headlineClass}>{r.title}</div>
            </div>
            <div className="dr-read-time">{r.read_time_min} min</div>
          </a>
        );
      })}
    </div>
  );
}

// =============================================================================
// THE MARKET — tagged-reads unit (reads the board, no futures)
// =============================================================================
// Front-door slice of the /market board: up to 3 generous/rich reads. WIDE rows
// (disclosures) never appear here — the front door shows value, not disagreement.

// Dedupe key: totals collapse over/under of the SAME line into one read (a
// mirror pair — one side generous, the other rich by the same magnitude), so we
// key by match + line and keep the generous side. 1X2 selections stay distinct.
function marketReadKey(r) {
  if (r.market_type === 'total') {
    const line = (r.selection_label.match(/([\d.]+)\s*goals/) || [])[1] ?? r.selection_label;
    return `t:${r.match_id}:${line}`;
  }
  return `m:${r.match_id}:${r.selection_label}`;
}

function topMarketReads(rows) {
  const seen = new Map();
  for (const r of rows) {
    if (r.tag !== 'generous' && r.tag !== 'rich') continue; // wide never shows here
    const key = marketReadKey(r);
    const existing = seen.get(key);
    // Keep the generous side of a mirror pair; otherwise first-seen.
    if (!existing || (r.tag === 'generous' && existing.tag !== 'generous')) seen.set(key, r);
  }
  return [...seen.values()]
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
    .slice(0, 3);
}

function MarketUnit({ data }) {
  const reads = topMarketReads(data?.rows ?? []);
  const ledger = data?.ledger ?? null;

  const footnote = (
    <div className="dc-market-footnote">
      De-vigged consensus read against our model. No picks, no books.{' '}
      <a href="/market" className="dc-market-method">Full board →</a>
    </div>
  );

  if (reads.length === 0) {
    return (
      <div className="dc-section">
        <div className="dc-section-label">The Market</div>
        <div className="dc-market">
          <p className="dc-mkt-empty">The board is quiet — no reads right now.</p>
          {footnote}
        </div>
      </div>
    );
  }

  return (
    <div className="dc-section">
      <div className="dc-section-label">The Market</div>
      <div className="dc-market">
        <ul className="dc-mkt-reads">
          {reads.map((r) => (
            <li className="dc-mkt-read" key={r.key}>
              <span className={`dc-mkt-tag ${r.tag === 'generous' ? 'gen' : 'rich'}`}>
                {r.tag === 'generous' ? 'Generous' : 'Rich'}
              </span>
              <span className="dc-mkt-main">
                <span className="dc-mkt-sel">{r.selection_label}</span>
                <span className="dc-mkt-sub">{r.home_abbr} v {r.away_abbr} · {fmtPtDate(new Date(r.kickoff_at)).replace(',', '')}</span>
              </span>
              <span className="dc-mkt-nums">
                {r.market_pct.toFixed(0)}%<span className="dc-mkt-arrow">→</span>{r.model_pct.toFixed(0)}%
                <span className="dc-mkt-gap">{`${r.gap >= 0 ? '+' : ''}${r.gap.toFixed(1)}`}</span>
              </span>
            </li>
          ))}
        </ul>
        {ledger && (
          <div className="dc-mkt-ledger">
            The ledger: {ledger.tagged} tagged, {ledger.landed} landed, prices implied {ledger.implied_expectation_pct}%
          </div>
        )}
        {footnote}
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
        <Flag svgPath={nextFixture.away?.flag_svg_path} />
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

function PowerRankingsList({ topRows, followedSet }) {
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
          <span className={`name${followedSet?.has(r.team_id) ? ' team-name-followed' : ''}`}>{r.team_name}</span>
          <span className="val">
            <span className={moveClass(r.movement_label)}>{moveGlyph(r.movement_label)}</span>{' '}
            {display1dp(r.score)}
          </span>
        </a>
      ))}
      <a className="sl-more" href="/world-cup-2026/rankings/power">View full rankings →</a>
    </div>
  );
}

function PlayerRankingsList({ topRows }) {
  if (!topRows || topRows.length === 0) {
    return (
      <div className="sidebar-list">
        <div className="sl-label">Tournament MVP · Top 5</div>
        <div className="sl-empty">Coming this week</div>
      </div>
    );
  }
  return (
    <div className="sidebar-list">
      <div className="sl-label">Tournament MVP · Top 5</div>
      {topRows.map((r) => (
        <a key={r.player_id} className="sl-item" href={`/player/${r.player_slug}`}>
          <span className="pos">{r.rank}</span>
          <span className="name">
            <Flag svgPath={r.team_flag_svg_path} size="tiny" />
            {r.player_name}
          </span>
          <span className="val">
            <span className={moveClass(r.movement_label)}>{moveGlyph(r.movement_label)}</span>{' '}
            {display1dp(r.score)}
          </span>
        </a>
      ))}
      <a className="sl-more" href="/world-cup-2026/rankings/players">View full rankings →</a>
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
function HomeGroupCard({ letter, teams, matchdaysComplete, followedSet }) {
  return (
    <div className="home-group-card">
      <div className="home-group-card-header">
        <div className="home-group-card-label">{letter}</div>
        <div className="home-group-card-meta">{matchdaysComplete} of 3</div>
      </div>
      {teams.map((t) => {
        const followed = followedSet?.has(t.team_id);
        return (
          <div key={t.team_id} className="home-group-card-row">
            <Flag svgPath={t.flag_svg_path} />
            {t.slug ? (
              <a
                href={`/team/${t.slug}`}
                className={`team-link${followed ? ' team-name-followed' : ''}`}
              >
                {t.name}
              </a>
            ) : (
              <span className={followed ? 'team-name-followed' : undefined}>{t.name}</span>
            )}
            <span className="home-group-card-pts">{t.points}</span>
          </div>
        );
      })}
    </div>
  );
}

function BracketWallGroupStage({ groupStandings, matchdayMap, followedSet }) {
  return (
    <section className="bracket-wall-section">
      <div className="bracket-wall-inner">
        <div className="bw-header">
          <div className="bw-title-row">
            <div className="bw-title">The <span className="accent">Bracket</span></div>
            <div className="bw-stage">Group Stage · 12 Groups</div>
          </div>
          <a href="/world-cup-2026/bracket" className="bw-link">Full Bracket Page →</a>
        </div>
        <div className="home-groups-grid">
          {GROUP_LETTERS.map((letter) => (
            <HomeGroupCard
              key={letter}
              letter={letter}
              teams={groupStandings.get(letter) ?? []}
              matchdaysComplete={matchdayMap.get(letter) ?? 0}
              followedSet={followedSet}
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
// SIDEBAR — LIVE & NEXT  (the new home for the 3-day games slate)
//
// Hero slot:
//   · ≥1 live match  → live hero (pulse + LIVE + flags + score + Live
//                        Watch Score number + track bar).
//   · No live match  → "Next Up" hero (the next upcoming WC fixture).
//   · Neither        → no hero, just the toggle (if anything to show).
//
// Toggle below the hero (native <details> — no client JS):
//   collapsed by default, expands to a compact list of the rest of
//   the 3-day window grouped by day. Compact rows = mini-flag + abbr
//   v abbr + kickoff time, linking each to /match/[slug].
//
// "Full schedule →" link footer.
// =============================================================================
async function SidebarGamesUnit({
  liveToday, restToday, day1, day2, nextFixture,
  ptDay, ptDay1, ptDay2,
}) {
  const hasLive = liveToday.length > 0;

  // Days that have matches end up in the toggle. Live matches are
  // already in the hero so they're not duplicated below.
  const groups = [];
  if (restToday.length) {
    const lbl = ptDayLabel(ptDay);
    groups.push({ id: 'today', label: `Today · ${lbl.weekday} · ${lbl.monthDay}`, list: restToday });
  }
  if (day1.length) {
    const lbl = ptDayLabel(ptDay1);
    groups.push({ id: 'day1', label: `${lbl.weekday} · ${lbl.monthDay}`, list: day1 });
  }
  if (day2.length) {
    const lbl = ptDayLabel(ptDay2);
    groups.push({ id: 'day2', label: `${lbl.weekday} · ${lbl.monthDay}`, list: day2 });
  }
  const totalMore = groups.reduce((acc, g) => acc + g.list.length, 0);

  // If literally nothing in the 3-day window AND no nextFixture, the
  // unit collapses to just the Full-schedule link. Defensive empty state.
  const hasAnything = hasLive || nextFixture || totalMore > 0;

  return (
    <section className="sg-card" aria-label="Live and next games">
      {hasLive
        ? <SidebarLiveHero match={liveToday[0]} />
        : nextFixture
          ? <SidebarNextUpHero next={nextFixture} />
          : <div className="sg-quiet">No matches in the next three days.</div>
      }

      {totalMore > 0 && (
        <details className="sg-toggle">
          <summary>
            <span className="sg-toggle-show">Show {totalMore} more {totalMore === 1 ? 'game' : 'games'}</span>
            <span className="sg-toggle-hide">Hide games</span>
            <span className="sg-toggle-caret" aria-hidden="true">▾</span>
          </summary>
          <div className="sg-list">
            {groups.map((g) => (
              <div key={g.id} className="sg-day">
                <div className="sg-day-label">{g.label}</div>
                {g.list.map((f) => <SgCompactRow key={f.id} f={f} />)}
              </div>
            ))}
          </div>
        </details>
      )}

      {hasAnything && <a className="sg-full" href="/schedule">Full schedule →</a>}
    </section>
  );
}

// Live hero — reads the most recent composite_score from
// match_watch_score_history (same source the match page's
// LiveWatchScore reads). composite is null when no ticks have landed
// yet (first ~30 seconds of kickoff); the track bar hides until one
// tick lands rather than rendering a fake zero.
async function SidebarLiveHero({ match }) {
  const rows = await sql`
    SELECT composite_score::float AS composite
      FROM match_watch_score_history
     WHERE match_id = ${match.id}
     ORDER BY recorded_at DESC, id DESC
     LIMIT 1
  `;
  const ws = rows[0]?.composite ?? null;
  return (
    <a className="sg-hero sg-hero-live" href={`/match/${match.slug}`}>
      <div className="sg-hero-status">
        <span className="sg-pulse" aria-hidden="true" />
        <span className="sg-live-word">LIVE</span>
      </div>
      <div className="sg-hero-teams">
        <div className="sg-hero-row">
          <Flag svgPath={match.home.flag_svg_path} />
          <span className="sg-hero-name">{match.home.name}</span>
          <span className="sg-hero-score">{match.home_score ?? 0}</span>
        </div>
        <div className="sg-hero-row">
          <Flag svgPath={match.away.flag_svg_path} />
          <span className="sg-hero-name">{match.away.name}</span>
          <span className="sg-hero-score">{match.away_score ?? 0}</span>
        </div>
      </div>
      {ws != null && (
        <div className="sg-ws">
          <div className="sg-ws-head">
            <span className="sg-ws-label">Live Watch Score</span>
            <span className="sg-ws-value">{ws.toFixed(1)}</span>
          </div>
          <div className="sg-ws-track" aria-hidden="true">
            <span
              className="sg-ws-fill"
              style={{ width: `${Math.max(0, Math.min(100, ws * 10))}%` }}
            />
          </div>
        </div>
      )}
    </a>
  );
}

// Next-up hero — pre-tournament / between-games state. Reuses the
// nextFixture already pulled by HomePage for the existing sidebar copy.
function SidebarNextUpHero({ next }) {
  return (
    <a className="sg-hero sg-hero-next" href={`/match/${next.slug}`}>
      <div className="sg-hero-label">Next Up</div>
      <div className="sg-hero-teams">
        <div className="sg-hero-row">
          <Flag svgPath={next.home.flag_svg_path} />
          <span className="sg-hero-name">{next.home.name}</span>
        </div>
        <div className="sg-hero-row">
          <Flag svgPath={next.away.flag_svg_path} />
          <span className="sg-hero-name">{next.away.name}</span>
        </div>
      </div>
      <div className="sg-hero-meta">
        <KickoffTime kickoffAt={next.kickoff_at} />
        {next.venue && <span className="sg-hero-venue"> · {next.venue}</span>}
      </div>
    </a>
  );
}

// Compact row — mini flag + abbr v abbr + time. Links to /match/<slug>.
function SgCompactRow({ f }) {
  return (
    <a className="sg-row" href={`/match/${f.slug}`}>
      <Flag svgPath={f.home.flag_svg_path} size="tiny" />
      <span className="sg-abbr">{f.home.abbreviation ?? f.home.name}</span>
      <span className="sg-vs">v</span>
      <Flag svgPath={f.away.flag_svg_path} size="tiny" />
      <span className="sg-abbr">{f.away.abbreviation ?? f.away.name}</span>
      <span className="sg-row-time"><KickoffTime kickoffAt={f.kickoff_at} /></span>
    </a>
  );
}

// =============================================================================
// GAMES BAND — top-of-homepage fixture sections (games-first on launch)
//
// LIVE NOW   → renders only if there are status='live' matches today
// TODAY      → always renders; empty-state copy when zero matches
// DAY+1      → labelled day section if it has matches
// DAY+2      → labelled day section if it has matches
// Full schedule → link to /schedule for the rest of the tournament
// =============================================================================
function HomeGamesBand({ liveToday, restToday, day1, day2, ptDay, ptDay1, ptDay2 }) {
  const todayLbl = ptDayLabel(ptDay);
  const day1Lbl  = ptDayLabel(ptDay1);
  const day2Lbl  = ptDayLabel(ptDay2);

  // Each subsection renders only when it has matches. No empty-TODAY
  // row inside the daily card — the editorial intro already frames the
  // pre-tournament moment. If literally nothing falls in the 3-day
  // window (off-day during a tournament break, or a data-load failure),
  // a single quiet line stands in.
  const hasAnything = liveToday.length + restToday.length + day1.length + day2.length > 0;
  if (!hasAnything) {
    return (
      <section className="home-games-band" aria-label="Today's games">
        <div className="home-games-quiet">No matches in the next three days.</div>
        <a className="home-games-full" href="/schedule">Full schedule →</a>
      </section>
    );
  }

  return (
    <section className="home-games-band" aria-label="Today's games">
      {liveToday.length > 0 && (
        <GamesSection
          headline="Live Now"
          modifier="live"
          count={liveToday.length}
          fixtures={liveToday}
        />
      )}
      {restToday.length > 0 && (
        <GamesSection
          headline="Today"
          sub={`${todayLbl.weekday} · ${todayLbl.monthDay}`}
          count={restToday.length}
          fixtures={restToday}
        />
      )}
      {day1.length > 0 && (
        <GamesSection
          headline={day1Lbl.weekday}
          sub={day1Lbl.monthDay}
          count={day1.length}
          fixtures={day1}
        />
      )}
      {day2.length > 0 && (
        <GamesSection
          headline={day2Lbl.weekday}
          sub={day2Lbl.monthDay}
          count={day2.length}
          fixtures={day2}
        />
      )}
      <a className="home-games-full" href="/schedule">Full schedule →</a>
    </section>
  );
}

function GamesSection({ headline, sub, modifier, count, fixtures }) {
  return (
    <div className="home-games-section">
      <div className="home-games-head">
        <span className={`home-games-headline ${modifier ?? ''}`.trim()}>{headline}</span>
        {sub && <span className="home-games-sub">{sub}</span>}
        <span className="home-games-rule" aria-hidden="true" />
        <span className="home-games-count">{count} {count === 1 ? 'match' : 'matches'}</span>
      </div>
      <div className="home-games-feed">{fixtures.map((f) => <FixtureCard key={f.id} f={f} />)}</div>
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

  // Games-band date window: today + 2 calendar days PT. Same reader
  // /schedule uses; widened from today-only so the new homepage games
  // sections (TODAY + DAY+1 + DAY+2) all draw from one round-trip.
  const ptDay1 = addPtDays(ptDay, 1);
  const ptDay2 = addPtDays(ptDay, 2);

  // Session resolved server-side; followedSet feeds the volt-name tint
  // on HomeGroupCard team-links, SlateRow home/away team names, and
  // PowerRankingsList rows. getFollowedTeamIds returns an empty Set for
  // null userId, so the logged-out render path naturally writes no
  // .team-name-followed class anywhere.
  const session = await auth();
  const userId = session?.user?.id ?? null;

  // Parallel reads — every helper returns [] / null on absence.
  const [
    fixtures3Day,
    todaysReads,
    featuredReads,
    moreReads,
    liveMatches,
    watchScoresToday,
    groupStandings,
    matchdayMap,
    groupProgress,
    koProgress,
    rankingTop5,
    playerTop5,
    publishedIntro,
    marketData,
    followedSet,
  ] = await Promise.all([
    readFixturesByPtDay({ leagueSlug: WC_LEAGUE_SLUG, ptStart: ptDay, ptEnd: ptDay2 }),
    getTodaysReads({ ptDay, limit: 4 }),
    Promise.resolve([]),  // Featured Reads — hidden until real long-form ships
    Promise.resolve([]),  // Recent Reads   — same; previews already live on /match/[slug]
    getCurrentLiveMatches(),
    getWatchScoresForDate(ptDay),
    getGroupStandings(),  // ordered standings rows (incl. points/wins/draws/losses/gf/ga/gd)
    getGroupMatchdayProgress(),
    getGroupStageProgress(),
    getKnockoutRoundProgress(),
    getTopN({ listSlug: 'team-power', leagueSlug: WC_LEAGUE_SLUG, limit: 5 }),
    getPlayerTopN({ listSlug: 'player-power', leagueSlug: WC_LEAGUE_SLUG, limit: 5 }),
    getCurrentDailyCardIntro(ptDay),
    getMarketPanelData(),
    getFollowedTeamIds(userId),
  ]);

  // Attach goals once (same pattern /schedule uses) — only fires the
  // goal-events query if any of the 3 days has fixtures.
  const fixtureIds = fixtures3Day.map((f) => f.id);
  const goalsByMatch = fixtureIds.length > 0 ? await readScheduleGoals(fixtureIds) : new Map();
  const fixtures3DayWithGoals = fixtures3Day.map((f) => ({
    ...f,
    goals: goalsByMatch.get(f.id) ?? { home: [], away: [] },
  }));

  // Partition for the new games-band sections.
  const todaysFixtures = fixtures3DayWithGoals.filter((f) => f.pt_day === ptDay);
  const day1Fixtures   = fixtures3DayWithGoals.filter((f) => f.pt_day === ptDay1);
  const day2Fixtures   = fixtures3DayWithGoals.filter((f) => f.pt_day === ptDay2);
  // LIVE NOW = today's matches whose status is currently 'live'. TODAY's
  // section excludes those (no duplication) — every other status (scheduled
  // / final / cancelled) shows in TODAY in kickoff order.
  const liveTodayFixtures = todaysFixtures.filter((f) => bucketOf(f.status) === 'live');
  const restTodayFixtures = todaysFixtures.filter((f) => bucketOf(f.status) !== 'live');

  // Existing daily-card slate stays today-only; the variable name keeps
  // the editorial helpers below unchanged.
  const slate = todaysFixtures;

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
        {/*
          DOM source order: Today's Card → sidebar (Live & Next +
          Power Rankings) → Bracket Wall. On mobile the .home-main
          grid collapses to 1 column and that's the natural stack —
          games come right after the card, bracket sits below them.

          On desktop the explicit grid-placement in home.css pins:
            daily-card     → column 1, row 1
            right-rail     → column 2, row 1 / span 2  (top-aligned)
            bracket-wall   → column 1, row 2           (below card)
          so the approved 2/3 + 1/3 layout is preserved. No CSS
          `order:` hacks — DOM order matches visual order on mobile
          and the desktop just re-pins via grid placement.
        */}
        <article className="daily-card">
          <DailyCardHeader ptDateLabel={ptDateLabel} />
          <DailyCardIntro publishedIntro={publishedIntro} />
          <DailyCardByline ptDateLabel={ptDateLabel} />

          {/* The 3-day games block lives in the sidebar (Live & Next).
              Today's slate stays IN the card: the immediate "what's
              happening today, what's already final" reads as the lead
              after the intro/byline, ahead of the structural progress
              strip. SlateSection renders SlateSignpost when the day
              has zero fixtures, so this slot never collapses ugly. */}
          <SlateSection
            fixtures={todaysFixtures}
            watchScoreByMatchId={watchScoreByMatchId}
            nextFixture={nextFixture}
            followedSet={followedSet}
          />

          <TournamentProgress groupProgress={groupProgress} koProgress={koProgress} />

          <TodaysReadsSection reads={todaysReads} followedSet={followedSet} />

          <MarketUnit data={marketData} />
        </article>

        {/* SIDEBAR — right column on desktop, slots between Today's
            Card and Bracket Wall on mobile (which is the point of the
            DOM-order fix). Live & Next leads (live hero or next-up
            hero, plus a collapsible list of the rest of the 3-day
            window). Power Rankings sits below. POT rankings land here
            later as a third unit. */}
        <aside className="right-rail">
          <SidebarGamesUnit
            liveToday={liveTodayFixtures}
            restToday={restTodayFixtures}
            day1={day1Fixtures}
            day2={day2Fixtures}
            nextFixture={nextFixture}
            ptDay={ptDay}
            ptDay1={ptDay1}
            ptDay2={ptDay2}
          />
          <PowerRankingsList topRows={showRankings ? rankingTop5 : []} followedSet={followedSet} />
          <PlayerRankingsList topRows={playerTop5} />
          <FeaturedReadsList reads={topFeatured} label="Featured Reads" />
          <WatchScoresTodayList rows={watchScoresToday.slice(0, 3)} />
        </aside>

        {/* Bracket Wall — last in source order on the grid. On mobile
            it sits at the bottom of the stack (after the sidebar). On
            desktop the explicit grid placement in home.css pins it to
            column 1, row 2 (right below Today's Card). */}
        <BracketWallGroupStage groupStandings={groupStandings} matchdayMap={matchdayMap} followedSet={followedSet} />
      </main>

      {showMoreRail && <MoreFromSportsvyn reads={belowFeatured} />}

      <SubscribeBand />

      <SiteFooter />
    </>
  );
}
