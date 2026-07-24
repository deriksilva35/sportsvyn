// app/scores/page.js — the Scoreboard (ink surface). Unlinked from existing nav;
// renders its own local ink shell. DEV reads only.
import Wordmark from '@/components/gridiron/Wordmark';
import Scoreboard from '@/components/gridiron/Scoreboard';
import { getSlateByDate } from '@/lib/gridiron/readers';
import { getH2hOdds } from '@/lib/gridiron/oddsReader';
import '@/components/gridiron/gridiron.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Scores - Sportsvyn', robots: { index: false, follow: false } };

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
  const date = DATE_RE.test(sp.date ?? '') ? sp.date : todayEtDate();
  const slate = await getSlateByDate(date);
  const games = [...slate.byLeague.nfl, ...slate.byLeague.cfb];
  // One batch odds read for the whole slate (no per-card fan-out); attach to each game.
  const oddsMap = await getH2hOdds(games.map((g) => g.id));
  for (const g of games) g.odds = oddsMap.get(g.id) ?? null;
  const total = slate.byLeague.nfl.length + slate.byLeague.cfb.length;
  const lb = label(date);

  return (
    <div className="gi" data-surface="ink">
      <header className="gi-head">
        <Wordmark />
        <nav className="gi-head-nav">
          <a href="/nfl">TODAY</a>
          <a className="active" href="/scores">SCORES</a>
          <a href="/nfl">NFL</a>
          <a href="/cfb">CFB</a>
          <a href="/world-cup-2026/bracket">SOCCER</a>
        </nav>
        <div className="gi-head-right"><a href="/my">MY SPORTSVYN</a><span className="gi-member">MEMBER</span></div>
      </header>

      <div className="gi-wrap">
        <div className="gi-kicker">
          <span className="k">Scoreboard</span>
          <span className="cnt">{total} games</span>
          <span className="rule" />
        </div>

        <div className="gi-toolbar">
          <div className="gi-datenav">
            <a href={`/scores?date=${shiftDate(date, -1)}`}>‹</a>
            <span className="cur"><b>{lb.wd}</b> {lb.md} {lb.year}</span>
            <a href={`/scores?date=${shiftDate(date, 1)}`}>›</a>
          </div>
        </div>

        <Scoreboard byLeague={slate.byLeague} />
      </div>
    </div>
  );
}
