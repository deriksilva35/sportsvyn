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
import { getSlateByDate, resolveScoresDate, scoresDateRange } from '@/lib/gridiron/readers';
import { parseScoresParams } from '@/lib/gridiron/scoresNav';
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

export default async function ScoresPage({ searchParams }) {
  const sp = (await searchParams) ?? {};
  const isShell = await resolveShellMode(sp);
  // In the container, signed out means the sign-in form - same law as every
  // tab. The web branch of this page stays public; the guard is shell-only.
  const session = await auth();
  requireSignInInShell({ isShell, userId: session?.user?.id ?? null, dest: '/scores' });
  // Explicit ?date= navigation is respected; the no-param default resolves to
  // today (if it has games) or the nearest day with a real slate.
  const date = DATE_RE.test(sp.date ?? '') ? sp.date : await resolveScoresDate(todayEtDate());
  // FILTERS ARE URL STATE NOW (fix B). They were component state inside
  // Scoreboard, so ANY navigation - date change, back button - reset them to
  // ALL. A filter that survives navigation has to live in the URL, and once
  // it does, every link on the page carries it via scoresHref.
  const { sport, live } = parseScoresParams(sp);
  const [slate, range] = await Promise.all([getSlateByDate(date), scoresDateRange()]);
  const games = [...slate.byLeague.nfl, ...slate.byLeague.cfb];
  // One batch odds read for the whole slate (no per-card fan-out); attach to each game.
  const oddsMap = await getH2hOdds(games.map((g) => g.id));
  for (const g of games) g.odds = oddsMap.get(g.id) ?? null;
  const total = slate.byLeague.nfl.length + slate.byLeague.cfb.length;
  const lb = label(date);

  return (
    <div className="gi" data-surface="ink">
      <GlobalHeaderServer activeNav="scores" />
      {isShell && <SportsvynSegment />}

      <div className="gi-wrap">
        <div className="gi-kicker">
          <span className="k">Scoreboard</span>
          <span className="cnt">{total} games</span>
          <span className="rule" />
          {/* WEB CROSS-NAV to the board's sibling surface. Web only: in the
              shell the segment above owns this hop, and two controls for one
              hop is one too many. */}
          {!isShell && <Link className="gi-cross" href="/nfl/fantasy">Movement Board &rarr;</Link>}
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

        <Scoreboard byLeague={slate.byLeague} date={date} sport={sport} live={live} />
      </div>
    </div>
  );
}
