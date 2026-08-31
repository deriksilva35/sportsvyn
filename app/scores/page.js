// app/scores/page.js — the Scoreboard (ink surface). Reads whatever
// DATABASE_URL points at - on Vercel that is PROD. (An earlier note here
// claimed this page read development data; it predated the env split and was
// stale the day it deployed.)
//
// v0.3: this page is ALSO the Draftvyn app's SPORTSVYN tab. One implementation
// - the shell gets a viewport, a sign-in gate and the LIVE SCORES / FANTASY
// segment; the web gets the same page without them, public and indexable.
import { auth } from '@/auth';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import SportsvynSegment from '@/components/shell/SportsvynSegment';
import { resolveShellMode, simViewport } from '@/lib/shell/shell';
import { requireSignInInShell } from '@/lib/shell/signedOut';
import Scoreboard from '@/components/gridiron/Scoreboard';
import Link from 'next/link';
import DateRail from '@/components/gridiron/DateRail';
import { getSlateByDate, resolveScoresDate, scoresDateRange, priorDateHasLive } from '@/lib/gridiron/readers';
import { loadRecordChips } from '@/lib/gridiron/recordsLoader';
import { parseScoresParams, defaultScoresDate } from '@/lib/gridiron/scoresNav';
import { getH2hOdds } from '@/lib/gridiron/oddsReader';
import '@/components/gridiron/gridiron.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Scores - Sportsvyn' };

// Shell mode opts into viewport-fit:cover so the safe-area insets resolve;
// the web keeps the root viewport. Same contract as every /sim page.
export async function generateViewport({ searchParams }) {
  return simViewport(await resolveShellMode((await searchParams) ?? {}));
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Today's calendar day in ET (the football day). Server-rendered under
// force-dynamic, so this is the real current date.
function todayEtDate() {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).reduce((a, x) => (a[x.type] = x.value, a), {});
  return `${p.year}-${p.month}-${p.day}`;
}

function shiftDate(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + days * 86400000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}
function label(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const wd = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][t.getUTCDay()];
  const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][t.getUTCMonth()];
  return { wd, md: `${mo} ${d}`, year: y };
}

/**
 * THE BOARD, once, worn two ways.
 *
 * /scores is the NETWORK surface: three codes at once, under the global
 * header, with the league chips that let a reader move between them.
 * /nfl/scores and /cfb/scores are the SAME component with `pinned` set - the
 * league header above it, the league chips gone. Inside a league the league
 * never disappears, and a chip row offering EPL from under an NFL title would
 * be a way out of the place the reader is standing in.
 *
 * PINNED IS ONE PROP, not a fork. Everything below reads `sport`, which the
 * pin simply decides instead of the URL.
 */
export async function ScoresView({ sp, pinned = null, leagueHeader = null }) {

  const isShell = await resolveShellMode(sp);
  // In the container, signed out means the sign-in form - same law as every
  // tab. The web branch of this page stays public; the guard is shell-only.
  const session = await auth();
  requireSignInInShell({ isShell, userId: session?.user?.id ?? null, dest: '/scores' });
  // Explicit ?date= navigation is respected, always and untouched. The
  // no-param default walks the SPORTS-DAY law first (defaultScoresDate: roll
  // back before 06:00 ET or while a prior-date game is still live), then
  // resolves to a day that actually has a slate.
  const date = DATE_RE.test(sp.date ?? '') ? sp.date : await (async () => {
    const priorHasLive = await priorDateHasLive(todayEtDate()).catch(() => false);
    return resolveScoresDate(defaultScoresDate(new Date(), { priorHasLive }));
  })();
  // FILTERS ARE URL STATE NOW (fix B). They were component state inside
  // Scoreboard, so ANY navigation - date change, back button - reset them to
  // ALL. A filter that survives navigation has to live in the URL, and once
  // it does, every link on the page carries it via scoresHref.
  const parsed = parseScoresParams(sp);
  const sport = pinned ?? parsed.sport;
  const { live } = parsed;
  // RECORDS FOR EVERY CARD ON THE SLATE, one read for all three leagues,
  // through the loader the league landings share - see recordsLoader.js.
  const [slate, range, records] = await Promise.all([
    getSlateByDate(date), scoresDateRange(), loadRecordChips(),
  ]);
  const games = [...slate.byLeague.nfl, ...slate.byLeague.cfb];
  // One batch odds read for the whole slate (no per-card fan-out); attach to each game.
  const oddsMap = await getH2hOdds(games.map((g) => g.id));
  for (const g of games) g.odds = oddsMap.get(g.id) ?? null;
  const total = slate.byLeague.nfl.length + slate.byLeague.cfb.length;
  const lb = label(date);

  return (
    <div className="gi" data-surface="ink">
      {/* THE WORDMARK BAND RENDERS ON EVERY ROUTE. It was gated on the pin,
          which meant the league wearings of this board had no global header at
          all - no wordmark, no way out to the rest of the site. The league
          header goes UNDER it, not instead of it. */}
      <GlobalHeaderServer activeNav="scores" />
      {leagueHeader ?? null}
      {isShell && <SportsvynSegment />}

      <div className="gi-wrap">
        <div className="gi-kicker">
          <span className="k">Scoreboard</span>
          <span className="cnt">{total} games</span>
          <span className="rule" />
          {/* WEB CROSS-NAV to the board's sibling surface. Web only: in the
              shell the segment above owns this hop, and two controls for one
              hop is one too many. */}
          {/* TWO DISTINCT BOARDS, TWO LABELLED DOORS. The Movement Board is
              ADP - what drafters are doing. The Market is prices - what books
              are doing. The names are confusable enough that one unlabelled
              link was sending readers to the wrong one, so both are named. */}
          {!isShell && !pinned && <Link className="gi-cross" href="/market">The Market &rarr;</Link>}
          {!isShell && !pinned && <Link className="gi-cross" href="/nfl/fantasy">Movement Board &rarr;</Link>}
        </div>

        <div className="gi-toolbar">
          <DateRail
            date={date}
            label={lb}
            prev={shiftDate(date, -1)}
            next={shiftDate(date, 1)}
            min={range.min}
            max={range.max}
            sport={sport}
            live={live}
          />
        </div>

        <Scoreboard byLeague={slate.byLeague} date={date} sport={sport} live={live} records={records} pinned={Boolean(pinned)} />
      </div>
    </div>
  );
}


export default async function ScoresPage({ searchParams }) {
  return ScoresView({ sp: (await searchParams) ?? {} });
}
