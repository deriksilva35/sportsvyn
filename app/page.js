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
import SimPromoCard from '@/components/home/SimPromoCard';
import GetTheAppBanner from '@/components/appstore/GetTheAppBanner';
import MovementCard from '@/components/fantasy/MovementCard';
import { getMovementCard } from '@/lib/fantasy/movement';
import '@/components/fantasy/movementCard.css';
import EditorialBoard from '@/components/gridiron/EditorialBoard';
import TodaysGames from '@/components/home/TodaysGames';
import { getEditorialBoard, getSlateByDate } from '@/lib/gridiron/readers';
import { boardHref } from '@/lib/gridiron/rankingsHub';
import '@/components/gridiron/gridiron.css';
import { resolveShellMode } from '@/lib/shell/shell';

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


// Two dates, stated once. Deliberately STATIC - a countdown would be a second
// thing to be wrong every day, and the reader can subtract. Volt is the rule
// material only; the text is paper-on-ink, never volt on paper.
const SEASON_DATES = [
  { label: 'CFB Week 0', date: 'Aug 29' },
  { label: 'NFL Week 1', date: 'Sep 10' },
];

function SeasonStrip() {
  return (
    <div className="dc-season" data-surface="ink">
      {SEASON_DATES.map((d) => (
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
const HOME_BOARDS = [
  { key: 'nfl', title: 'NFL Power Rankings · Top 5', href: boardHref('nfl', 'power') },
  { key: 'cfb', title: 'The Sportsvyn 25 · Top 5', href: boardHref('cfb', 'top25') },
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
        <EditorialBoard key={b.key} title={b.title} board={b.board} preview href={b.href} />
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
  if (shell) {
    return (
      <div className="subscribe-band">
        <div className="sb-text">
          The Daily Card is free to read.
          <em>The rest of the year is part of the Sportsvyn membership.</em>
        </div>
      </div>
    );
  }
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

  const [todaysReads, followedSet, movement, nflBoard, cfbBoard, slate] = await Promise.all([
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
  ]);


  return (
    <>
      <GlobalHeaderServer activeNav="home" />

      {/* TWO COLUMNS AGAIN. The football homepage ran full width because the
          World Cup rail's units - live scores, group standings, tournament
          rankings - had no football equivalent, and an empty rail is worse than
          no rail. All three now exist: a gridiron slate, an NFL power board and
          the Sportsvyn 25. The rail comes back because it has something to say.

          DOM ORDER IS THE MOBILE STACK: card, then sidebar. Below 1024px the
          grid collapses and the sidebar falls under the card rather than above
          it, which keeps the Daily Card the first thing on a phone. */}
      <main className="home-main home-main--football">
        <article className="daily-card">
          <DailyCardHeader ptDateLabel={ptDateLabel} />
          <DailyCardByline ptDateLabel={ptDateLabel} />

          {/* Draftvyn leads. It is the alive product: the thing a reader can
              do right now, in about ten minutes, rather than read about. The
              promo card sells the sim and the banner offers the same thing as
              an app, so they sit adjacent as one unit. Both are ink blocks on
              the paper card, per the Surface Rule. */}
          <SimPromoCard />
          <GetTheAppBanner shell={isShell} />

          {/* The Movement Board's own entry card, same wiring as /nfl: one
              getMovementCard read, sliced from the same board, carrying its
              own FFC attribution. Null on a pool failure rather than an empty
              frame. */}
          {movement ? <MovementCard card={movement} /> : null}

          {/* Renders nothing at all when there are no reads for the day - no
              placeholder, no deflated section. */}
          <TodaysReadsSection reads={todaysReads} followedSet={followedSet} />

          <SeasonStrip />
        </article>

        <aside className="right-rail home-rail">
          {/* Absent entirely on an empty day - TodaysGames returns null and the
              rail closes up. No frame, no "no games today". */}
          <TodaysGames slate={slate} label={etLabel} />
          <RailBoards boards={{ nfl: nflBoard, cfb: cfbBoard }} />
        </aside>
      </main>

      <SubscribeBand shell={isShell} />

      <SiteFooter />
    </>
  );
}
