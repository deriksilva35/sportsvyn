/**
 * /survivor - one NFL team a week, never the same one twice. Lose and you're out.
 *
 * THE NATIONAL POOL, P0. One pool per season (migration 118 seeds 2026: starts
 * Week 5, one life, a missed pick is auto-assigned). League pools come with
 * Leagues V1 - the same tables, a league_id on the pool.
 *
 * THE MODEL IS BUILT HERE, ON THE SERVER (lib/survivor/view.js roomModel), from
 * the database's own clock-free facts and one `now`; the room renders it and a
 * tap goes through the server action, whose checks are the rules. Nothing on
 * this page is decided by the browser.
 *
 * SIGN-IN LAW: in the app shell, signed out is the sign-in form (the Weekly's
 * rule); on the web the week's board is public and read-only, with one sign-in
 * where the pick would be (the October card's rule).
 *
 * NEVER A 404 FOR "NOT YET": no pool, or no open week, says so.
 */

import Link from 'next/link';
import { cookies } from 'next/headers';
import { auth } from '@/auth';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import { resolveShellMode, simViewport } from '@/lib/shell/shell';
import { shellSigninHref } from '@/lib/shell/signinHref';
import { requireSignInInShell } from '@/lib/shell/signedOut';
import { currentNationalPool, poolWeek, weekBoard, entryWithPicks, poolCounts } from '@/lib/survivor/read';
import { entriesOpen } from '@/lib/survivor/rules';
import { roomModel, SURVIVOR_SEEN_COOKIE } from '@/lib/survivor/view';
import SurvivorRoom from '@/components/survivor/SurvivorRoom';
import '../daily/daily.css';
import '../weekly/weekly.css';
import './survivor.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Survivor - Sportsvyn',
  description: 'One NFL team a week. Never the same one twice. Lose and you are out.',
};

export async function generateViewport() {
  return simViewport(await resolveShellMode());
}

function Shell({ children }) {
  return (
    <div className="daily-shell">
      <GlobalHeaderServer activeNav="daily" />
      <div className="weekly survivor" data-surface="ink">
        <main className="daily-main">{children}</main>
      </div>
    </div>
  );
}

function NotOpen({ line }) {
  return (
    <Shell>
      <Link className="appcrumb" href="/games">&larr; Games</Link>
      <section className="hero">
        <div className="hero-eyebrow">Survivor &middot; NFL</div>
        <div className="hero-q">One team a week.<br />Never twice.</div>
        <p className="muted">{line}</p>
      </section>
    </Shell>
  );
}

export default async function SurvivorPage() {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const isShell = await resolveShellMode();
  requireSignInInShell({ isShell, userId, dest: '/survivor' });
  const now = new Date();

  // 118 unapplied, or no pool seeded: a sentence, never a 500.
  const pool = await currentNationalPool().catch(() => null);
  if (!pool) return <NotOpen line="Survivor opens with its first week." />;
  const { week, weeks } = await poolWeek(pool, now).catch(() => ({ week: null, weeks: [] }));
  if (week == null) return <NotOpen line={`The ${pool.season_year} pool is over.`} />;

  const uid = userId == null ? null : Number(userId);
  const [board, mine, counts, jar] = await Promise.all([
    weekBoard(pool, week).catch(() => ({ games: [], rows: [] })),
    uid == null ? { entry: null, picks: [] } : entryWithPicks(pool.id, uid).catch(() => ({ entry: null, picks: [] })),
    poolCounts(pool.id).catch(() => ({ entries: 0, alive: 0 })),
    cookies(),
  ]);
  const start = weeks.find((w) => w.week === pool.start_week);
  const open = uid == null ? true : entriesOpen(pool, start?.first_kickoff ?? null, now);
  const model = roomModel({
    rows: board.rows, picks: mine.picks, entry: mine.entry, week,
    entriesOpen: open, now, startWeek: pool.start_week,
  });

  return (
    <Shell>
      <SurvivorRoom
        poolId={pool.id}
        week={week}
        model={model}
        alive={counts.entries ? counts.alive : null}
        entries={counts.entries || null}
        lives={pool.lives}
        livesLeft={mine.entry ? Number(mine.entry.lives_left) : null}
        firstVisit={!jar.get(SURVIVOR_SEEN_COOKIE)?.value && !mine.entry}
        signedIn={uid != null}
        signinHref={shellSigninHref('/survivor', isShell)}
      />
    </Shell>
  );
}
