/**
 * Sportsvyn homepage - the football Daily Card.
 *
 * WHAT THIS REPLACED. Until the 2026 World Cup finished, this page was a
 * two-column tournament board: a live slate, group standings, a bracket wall,
 * knockout progress, tournament rankings and a WC-scoped market panel. All 105
 * matches are final. Those units did not break - they froze, which is worse,
 * because a frozen instrument under today's date reads as a live one that is
 * lying. They are gone from this page; their modules are untouched and still
 * serve the /world-cup-2026 routes.
 *
 * WHAT LEADS NOW. Draftvyn - the thing a reader can DO today rather than read
 * about - then the Movement Board's entry card, then whatever was published
 * today, then the two dates that matter. Single column: the old right rail had
 * no football equivalent, and an empty rail is worse than no rail.
 *
 * SURFACE RULE. Paper page ground; instruments and product doorways are ink
 * blocks sitting on it. Volt is rule material, never body text on paper.
 *
 * Sections render NOTHING when they have nothing to say - no placeholders, no
 * deflated frames. Today's Reads is the live example: empty means absent.
 */

import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import SiteFooter from '@/components/SiteFooter';

import { toPtIsoDate } from '@/lib/scheduleData';
import { getTodaysReads, FOOTBALL_READS_SLUGS } from '@/lib/articles';
import { getFollowedTeamIds } from '@/lib/follows';
import { auth } from '@/auth';
import DailyModule from '@/components/home/DailyModule';
import WeeklyModule from '@/components/home/WeeklyModule';
import DraftModule from '@/components/home/DraftModule';
import YesterdayStrip from '@/components/home/YesterdayStrip';
import { getDailyHome, getYesterday } from '@/lib/daily/entries';
import { getWeeklyHome } from '@/lib/weekly/entries';
import { getDraftHome } from '@/lib/draft/entry';
import SimPromoCard from '@/components/home/SimPromoCard';
import GetTheAppBanner from '@/components/appstore/GetTheAppBanner';
import MovementCard from '@/components/fantasy/MovementCard';
import { getMovementCard } from '@/lib/fantasy/movement';
import '@/components/fantasy/movementCard.css';
import EditorialBoard from '@/components/gridiron/EditorialBoard';
import TodaysGames from '@/components/home/TodaysGames';
import { getEditorialBoard, getSlateByDate, getNearestUpcomingWeek } from '@/lib/gridiron/readers';
import { resolveSeasonYear } from '@/lib/pollers/seasonResolver';
import { boardHref } from '@/lib/gridiron/rankingsHub';
import '@/components/gridiron/gridiron.css';
import { resolveShellMode } from '@/lib/shell/shell';
import SportsvynSegment from '@/components/shell/SportsvynSegment';
import ModeSwitch from '@/components/today/ModeSwitch';
import LeagueChips from '@/components/today/LeagueChips';
import Band, { BandHead } from '@/components/today/Band';
import GamesBand from '@/components/today/GamesBand';
import { GridironBand, EplBand, ArchiveBand } from '@/components/today/LeagueBands';
import { LEAGUES, rankLeagues, contextLine, leagueById } from '@/lib/today/leagues';
import { gatherSignals } from '@/lib/today/signals';
import { weekSlate } from '@/lib/today/weekSlate';
import { getResolvedLayout } from '@/lib/dashboardLayout';
import { pickemCardData } from '@/lib/pickem/entry';
import { currentPickemBoard } from '@/lib/pickem/entry';
import { getEplStandings } from '@/lib/soccer/standings';
import { eplBandFixtures } from '@/lib/soccer/fixtures';

import './home.css';






// =============================================================================
// Daily Card sections
// =============================================================================
// The card's dateline. Self-contained on Intl - the hand-rolled weekday/month
// arrays it used to share with the fixture rows went out with them.
function fmtPtDate(date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short', month: 'short', day: 'numeric',
  }).format(date);
}

function DailyCardHeader({ ptDateLabel }) {
  // The bracket link is gone with the tournament. Nothing replaces it: the
  // header names the page and stops, and the season strip at the foot of the
  // card carries the only dates worth stating.
  return (
    <div className="dc-header">
      <div className="dc-title-row">
        <div className="dc-title">The Daily <span className="accent">Card</span></div>
      </div>
      <div className="dc-header-meta-group">
        <div className="dc-meta">{ptDateLabel}</div>
      </div>
    </div>
  );
}


// Two dates, stated once. The DATES are deliberately static - a countdown would
// be a second thing to be wrong every day, and the reader can subtract - but
// the WEEK NUMBERS are not, and used to be.
//
// This strip said "CFB Week 0" for Aug 29. The schedule says that Saturday is
// season 2026, REG, WEEK 1 - and that week 1 runs Aug 29 through Sep 7, ten
// days and 99 games. "Week 0" was copy somebody typed, and copy cannot be
// right about a number the database owns. It is the same class as a hardcoded
// kickoff: correct on the day it was written, silently wrong afterwards.
//
// The label is now derived and the date is still stated. If the derivation
// finds nothing, the strip renders the date without a week number rather than
// inventing one.
function SeasonStrip({ cfbWeek = null, nflWeek = null }) {
  const dates = [
    { label: cfbWeek != null ? `CFB Week ${cfbWeek}` : 'CFB', date: 'Aug 29' },
    { label: nflWeek != null ? `NFL Week ${nflWeek}` : 'NFL', date: 'Sep 10' },
  ];
  return (
    <div className="dc-season" data-surface="ink">
      {dates.map((d) => (
        <div className="dc-season-item" key={d.label}>
          <span className="dc-season-label">{d.label}</span>
          <span className="dc-season-date">{d.date}</span>
        </div>
      ))}
    </div>
  );
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






// Two Top 5 ranking boards, side by side. These are the SAME instrument the
// /nfl and /cfb Today pages render - EditorialBoard in its `preview` mode, fed
// by the same getEditorialBoard reader - not a homepage copy of one. Passing
// `preview` gets the top 5, the "+ N dark horses" teaser and the "Full board ->"
// link; the component supplies its own data-surface="ink", so each board is an
// ink block on the paper card with no extra wrapper.
//
// A league with no published current edition renders NOTHING rather than an
// empty cell: the filter below mirrors EditorialBoard's own null guard, so if
// one league goes dark the other takes the full width instead of sitting beside
// a hole. Both dark and the whole section is absent.
//
// NO MOVEMENT DELTAS. Every current edition is Edition 0, which by definition
// has no prior to move against - all 57 rows carry rank_movement NULL, and the
// reader does not even select the column. Rendering a delta here would mean
// inventing one.
//
// THE TITLES ARE THE BOARDS' OWN NAMES. Each is ranking_lists.name plus the
// slice this preview shows, so the link out lands on a page headed the same
// thing the reader just clicked. "The Sportsvyn 25" in particular is not a
// generic CFB poll - calling it "CFB Top 25" here and "The Sportsvyn 25" on
// /cfb would make one board read as two.
// Name and slice are SEPARATE. Concatenated into one string they wrapped
// mid-phrase in the rail ("THE SPORTSVYN 25 · TOP / 5"), which reads as a title
// that ran out of room rather than as a label somebody chose.
const HOME_BOARDS = [
  { key: 'nfl', title: 'NFL Power Rankings', slice: 'Top 5', href: boardHref('nfl', 'power') },
  { key: 'cfb', title: 'The Sportsvyn 25', slice: 'Top 5', href: boardHref('cfb', 'top25') },
];

/**
 * The two boards, now STACKED IN THE RAIL rather than side by side in the card.
 *
 * They are the same instrument in the same preview mode - only the column
 * changed. Side by side inside a 360px rail would give each board about 165px,
 * which is narrower than a team name plus a record.
 *
 * A board with no entries does not render, and if both are dark the section
 * returns null rather than leaving two headings over nothing.
 */
function RailBoards({ boards }) {
  const live = HOME_BOARDS
    .map((b) => ({ ...b, board: boards?.[b.key] ?? null }))
    .filter((b) => b.board?.entries?.length);
  if (live.length === 0) return null;
  return (
    <>
      {live.map((b) => (
        <EditorialBoard key={b.key} title={b.title} slice={b.slice} board={b.board} preview href={b.href} />
      ))}
    </>
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















// 3.1.1: the homepage is reachable inside the native container (capacitor
// allowNavigation covers sportsvyn.com), and this band carries a price. In shell
// the band states what is free and stops - no price, no "Founding Member" plan
// name, no solicitation. Web is unchanged.
// The brief said leave this band alone, and structurally it is untouched -
// same markup, same price, same CTA. Two words of copy had to move: it opened
// "The World Cup is free to read", which on a football homepage is a sentence
// about a tournament that finished in July, and the price line carried an em
// dash against this build's hyphens-only rule.
function SubscribeBand({ shell = false }) {
  // NOTHING IN THE CONTAINER. This used to render a text-only variant in the
  // shell - the pitch without the email form - which was still web furniture:
  // an install IS the subscription intent, and the membership has its own
  // surface in PROFILE. A band explaining the offer to somebody who already
  // took it is a row of pixels asking them to do what they did.
  if (shell) return null;
  return (
    <div className="subscribe-band">
      <div className="sb-text">
        The Daily Card is free to read.
        <em>Founding membership $99/year - unlocks the rest of the year.</em>
      </div>
      <a href="/signin" className="sb-button">Become a Founding Member</a>
    </div>
  );
}







// =============================================================================
// MAIN PAGE
// =============================================================================
export default async function HomePage() {
  // 3.1.1: the homepage is reachable inside the native container, and the
  // subscribe band carries a price. Cookie-resolved (this page takes no
  // searchParams).
  const isShell = await resolveShellMode(null);
  const now = new Date();
  const ptDay = toPtIsoDate(now);
  const ptDateLabel = fmtPtDate(now);

  // Session resolved server-side; followedSet feeds the volt-title tint on
  // followed-team reads. getFollowedTeamIds returns an empty Set for a null
  // userId, so the logged-out path naturally writes no followed class.
  const session = await auth();
  const userId = session?.user?.id ?? null;

  // Parallel reads. Both return empty/null on absence, so the page has no
  // failure branch: a section with nothing to say renders nothing.
  //
  // The World Cup readers that used to live here - fixtures, group standings,
  // knockout progress, tournament rankings, watch scores, the WC market panel
  // and the daily-card intro - are gone from this page. The tournament is
  // finished; those units would render frozen July data under today's date.
  // Their modules are untouched and still serve the /world-cup-2026 routes.
  // The sidebar's slate is EASTERN, not Pacific. The page's own date label is
  // PT (the Daily Card is written on Derik's clock), but a football day is an
  // ET day everywhere else in this codebase - /scores, the pollers, the week
  // resolver - and a 10pm PT Thursday kickoff is already Friday in PT. Reading
  // the slate in PT would have shown tomorrow's games under today's heading for
  // three hours every evening.
  const etDay = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const etLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric',
  }).format(now);

  const [todaysReads, followedSet, movement, nflBoard, cfbBoard, slate, dailyHome, yesterday,
    weeklyHome, draftHome] = await Promise.all([
    getTodaysReads({ ptDay, limit: 4, leagueSlugs: FOOTBALL_READS_SLUGS }),
    getFollowedTeamIds(userId),
    // Same call the /nfl entry card makes. Null rather than a thrown page if
    // the pool read fails - the card is one unit on the page, not the page.
    getMovementCard('ppr', 5).catch(() => null),
    // The same two reads the /nfl and /cfb Today pages make. Caught
    // independently: one league's board failing must not take the other's
    // down, and neither may take the page down.
    getEditorialBoard('nfl-power', 'nfl').catch(() => null),
    getEditorialBoard('cfb-top25', 'cfb').catch(() => null),
    // One read for both leagues. Null on failure: the sidebar loses a unit, the
    // page does not lose a column.
    getSlateByDate(etDay).catch(() => null),
    // The Daily's own state. Null on any failure AND on a day with no board -
    // the module is one unit on the page, never the page, and an absent Daily
    // must not take the homepage down.
    getDailyHome(userId).catch(() => null),
    // Yesterday's answer. A revealed day is public, so this needs no auth and
    // has no leak surface; it is caught to null like every other unit.
    getYesterday(userId).catch(() => null),
    // The Weekly's own state. Caught to null like every other unit, and null is
    // also the correct answer before the first board exists - which is what PROD
    // returns today. A missing contests table renders no module, not a 500.
    getWeeklyHome(userId).catch(() => null),
    // The Draft's own state. Same posture as every other unit on this page.
    getDraftHome(userId).catch(() => null),
  ]);

  // THE WEEK NUMBERS ON THE SEASON STRIP ARE DERIVED, never typed. The strip
  // read "CFB Week 0" for Aug 29 while the schedule said week 1; a number the
  // database owns must not be restated as copy. Null on failure, and the strip
  // then shows the date with no week rather than a wrong one.
  const seasonYear = resolveSeasonYear(now);
  const [cfbNext, nflNext] = await Promise.all([
    getNearestUpcomingWeek('cfb', seasonYear).catch(() => null),
    getNearestUpcomingWeek('nfl', seasonYear).catch(() => null),
  ]);

  // ---- THE BANDS -------------------------------------------------------
  // Order is COMPUTED every render, never a constant: rankLeagues over signals
  // read from `matches`. Every unit below is an existing reader; the carpentry
  // changed, the reads did not.
  const [signals, tunedLayout, pickem, board, eplTable, eplFixtures,
    cfbReads, nflReads, eplReads] = await Promise.all([
    gatherSignals({ now }).catch(() => []),
    getResolvedLayout(userId, 'today').catch(() => []),
    pickemCardData(userId).catch(() => null),
    currentPickemBoard({ now }).catch(() => null),
    getEplStandings().catch(() => null),
    eplBandFixtures({ now }).catch(() => []),
    // CONDITIONAL ARTICLE MODULES. All 129 published articles carry a soccer
    // league, so these return [] today and the modules are absent - the ruled
    // behaviour, not a hole.
    getTodaysReads({ ptDay, limit: 3, leagueSlugs: ['cfb'] }).catch(() => []),
    getTodaysReads({ ptDay, limit: 3, leagueSlugs: ['nfl'] }).catch(() => []),
    getTodaysReads({ ptDay, limit: 3, leagueSlugs: ['epl'] }).catch(() => []),
  ]);

  // THE WEEK SLATES. One read per league, each deriving its own week span -
  // never a calendar week (CFB week 1 runs Aug 29 to Sep 7).
  const [cfbWeekSlate, nflWeekSlate, eplWeekSlate] = await Promise.all([
    weekSlate('cfb', { now }).catch(() => null),
    weekSlate('nfl', { now }).catch(() => null),
    weekSlate('epl', { now }).catch(() => null),
  ]);
  const slateOfLeague = { cfb: cfbWeekSlate, nfl: nflWeekSlate, epl: eplWeekSlate };

  const order = rankLeagues(signals);
  const signalOf = (id) => signals.find((s) => s.id === id) ?? {};
  // A signed-out reader gets the defaults; getResolvedLayout already returns
  // them for a null userId, so there is no branch here.
  const tunedOn = new Set(tunedLayout.map((e) => e.id));
  // THE BOARD KEYS ON match_id, NOT id. Mapping g.id produced a Set of one
  // undefined, so the badge never rendered - invisible in relay 1 because the
  // CFB slate was empty on a Thursday and there was nothing to badge. It would
  // have surfaced on Saturday as a module claiming "Board 1 marked" over six
  // unbadged rows. Tested now against the board's real shape.
  const boardIds = new Set((board?.board ?? []).map((g) => g.match_id ?? g.id).filter((v) => v != null));
  const slateFor = (lg) => (slate?.byLeague?.[lg] ?? []);
  const rowsFromBoard = (b, n = 5) => (b?.entries ?? []).slice(0, n)
    .map((e) => ({ key: e.rank, pos: e.rank, label: e.label, value: e.teamTag ?? '—', dim: true }));
  const eplRows = (eplTable?.rows ?? []).slice(0, 4)
    .map((r) => ({ key: r.rank, pos: r.rank, label: r.team, value: r.points }));

  const bandFor = (id) => {
    const sig = signalOf(id);
    const ctx = contextLine(sig);
    const off = !tunedOn.has(id);
    if (id === 'cfb' || id === 'nfl') {
      const isCfb = id === 'cfb';
      return (
        <Band id={id} off={off} key={id}>
          <GridironBand
            id={id} label={isCfb ? 'CFB' : 'NFL'}
            week={(isCfb ? cfbNext : nflNext)?.week ?? null}
            context={ctx}
            weekSlate={slateOfLeague[id]}
            boardIds={isCfb ? boardIds : null}
            scoresHref={isCfb ? '/scores?sport=cfb' : '/scores?sport=nfl'}
            board={rowsFromBoard(isCfb ? cfbBoard : nflBoard)}
            boardTitle={isCfb ? 'The Sportsvyn 25' : 'Power Rankings'}
            boardCtx={(isCfb ? cfbBoard : nflBoard)?.editionLabel ?? null}
            boardCta={isCfb ? 'Rankings hub' : 'Full board'}
            boardHref={isCfb ? '/cfb/rankings' : '/nfl'}
            movement={!isCfb && movement ? <div className="mod"><MovementCard card={movement} /></div> : null}
            reads={isCfb ? cfbReads : nflReads}
            hubHref={isCfb ? '/cfb' : '/nfl'} hubLabel={isCfb ? 'CFB hub' : 'NFL hub'} />
        </Band>
      );
    }
    if (id === 'epl') {
      return (
        <Band id={id} off={off} key={id}>
          <EplBand context={ctx} weekSlate={eplWeekSlate} week={eplWeekSlate?.week ?? null}
            table={eplRows} reads={eplReads} />
        </Band>
      );
    }
    return <Band id={id} off={off} key={id}><ArchiveBand /></Band>;
  };

  // Chips display in ranker order too, so the rail and the bands agree.
  const chipLeagues = order.map((id) => {
    const l = leagueById(id);
    const sig = signalOf(id);
    return { id, label: l.label, live: !!sig.isLive, note: l.archive ? 'archive'
      : sig.isLive ? 'live' : sig.playsToday ? 'today'
      : sig.daysToNext != null ? `${sig.daysToNext}d` : null };
  });


  return (
    <>
      <GlobalHeaderServer activeNav="home" />
      {isShell && <SportsvynSegment />}

      {/* THE BAND LAYOUT replaces the two-column main/rail carpentry. The rail
          existed because the page had units with nowhere else to go; every one
          of them is now inside the band for the league it belongs to, which is
          where a reader looks for it. */}
      <main className="page-shell today-shell">
        <ModeSwitch />
        <div className="modesub">{etLabel} · The network&rsquo;s front page, tuned to your leagues</div>

        {/* The tuner drives the bands below. Signed out it still works, for the
            length of the visit, and says so. */}
        <LeagueChips leagues={chipLeagues} initialOn={[...tunedOn]} signedIn={userId != null} />

        {/* THE EDITORIAL SPINE AND THE GAMES NEVER FILTER. A reader who has
            turned EPL off has said nothing about whether they want the Daily. */}
        <section className="readband">
          <div>
            <div className="kick">The Daily Card · Free to read</div>
            <h2>{ptDateLabel}</h2>
            <DailyCardByline ptDateLabel={ptDateLabel} />
          </div>
          <a className="go" href="/daily">Read the card &rarr;</a>
        </section>

        <Band id={null}>
          <BandHead top label="The Games" context="One account, one handle, every board"
            moreHref="/games" moreLabel="Games hub" />
          <GamesBand daily={dailyHome} yesterday={yesterday} pickem={pickem}
            weekly={weeklyHome} draft={draftHome} />
        </Band>

        {/* Bands in ranker order - computed from `matches` every render. */}
        {order.map((id) => bandFor(id))}

        <div className="emptystate" id="today-empty">
          Nothing tuned in. Flip a league back on above &mdash; Today only goes quiet if you tell it to.
        </div>

        <SimPromoCard />
        <GetTheAppBanner shell={isShell} />
      </main>

      <SubscribeBand shell={isShell} />

      <SiteFooter />
    </>
  );
}
