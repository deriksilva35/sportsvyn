/**
 * /october/board - frame 3 of the mock: one October total, today beside it,
 * and the pool bar that shows where the reader's tournament went.
 */

import Link from 'next/link';
import { auth } from '@/auth';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import { currentOctoberDay } from '@/lib/october/create';
import { octoberBoard } from '@/lib/october/board';
import { myLeagues, leagueMemberIds, leagueDetail } from '@/lib/leagues/core';
import { joinHref } from '@/lib/leagues/code';
import LeagueChipActions from '@/components/leagues/LeagueChipActions';
import { resolveShellMode } from '@/lib/shell/shell';
import { shellSigninHref } from '@/lib/shell/signinHref';
import { seriesFor } from '@/lib/mlb/series';
import '../../games/games.css';
import '../october.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'October · standings - Sportsvyn' };

export default async function OctoberBoardPage({ searchParams }) {
  const session = await auth();
  const uid = session?.user?.id ?? null;
  const q = await searchParams;
  const contest = await currentOctoberDay({ now: new Date() }).catch(() => null);
  const season = contest?.season_year ?? new Date().getUTCFullYear();
  const shell = await resolveShellMode().catch(() => null);
  const signinHref = shellSigninHref('/october/board', shell?.isShell ?? false);

  // ?league=<id> PICKS ONE OF THE READER'S OWN, and anything else is Everyone -
  // the same rule /run/board follows. A league id the reader is not in simply
  // does not match, so a guessed id shows Everyone rather than somebody else's
  // board: the filter is built from THEIR memberships, never from the URL.
  const leagues = uid == null ? [] : await myLeagues(Number(uid)).catch(() => []);
  const wanted = q?.league ? String(q.league) : null;
  const picked = leagues.find((l) => String(l.id) === wanted) ?? null;

  const memberIds = picked ? await leagueMemberIds(picked.id).catch(() => []) : null;
  const [rows, series, detail] = await Promise.all([
    octoberBoard(season, { memberIds }).catch(() => []),
    seriesFor(null, season).catch(() => []),
    picked ? leagueDetail(picked.id, Number(uid)).catch(() => null) : Promise.resolve(null),
  ]);

  // WHO IS STILL ALIVE. A club is out when it has lost a series it was in;
  // everyone else is still playing, which is what the pool bar splits on.
  const eliminated = new Set();
  for (const s of series) {
    if (!s.winner) continue;
    for (const t of s.teams) if (t.id !== s.winner) eliminated.add(t.abbreviation);
  }
  const alive = new Set(series.flatMap((s) => s.teams.map((t) => t.abbreviation)).filter((a) => !eliminated.has(a)));

  const me = rows.find((r) => String(r.userId) === String(uid)) ?? null;

  return (
    <div className="gi ocpage" data-surface="ink">
      <GlobalHeaderServer activeNav="games" />
      <div className="oc-wrap">
        {/* THE SAME MISSING SEPARATOR the Run's crumb had - the two boards share
            this markup and shared it. October has no league chips yet, so the
            chips half of that relay does not reach this page. */}
        <div className="oc-crumb">
          <Link href="/october">&#8249; Your five</Link>
          <span className="oc-crumb-sep" aria-hidden="true">·</span>
          <Link href="/mlb/bracket">Bracket &#8250;</Link>
        </div>

        <div className="oc-hd" style={{ borderRadius: '18px 18px 0 0' }}>
          <div className="oc-hd-top">
            <span className="oc-eb">October</span>
            {/* THE LEAGUE'S NAME WHEN ONE IS PICKED, and the Everyone line exactly
                as it was otherwise - "the World Series decides it" is this
                board's own copy and a league filter is no reason to delete it. */}
            <span className="oc-ed">{picked
              ? `${picked.name} · ${rows.length} playing`
              : `${rows.length} playing · the World Series decides it`}</span>
          </div>
          <div className="oc-crow">
            <div className="oc-lbl">you<b>{me ? `${ordinal(me.rank)} · ${me.back} back` : 'not entered'}</b></div>
            <div className="oc-tot"><b>{me?.total ?? 0}</b><span>October</span></div>
          </div>
        </div>

        {/* THE CHIP ROW, the Run's own - one entry, any number of leagues: a
            league filters WHO is on the board, never which card a reader filed.
            See lib/october/board.js. */}
        <div className="oc-lgs">
          {leagues.map((l) => (
            <Link key={l.id} className={`oc-lg${picked && picked.id === l.id ? ' on' : ''}`}
              href={`/october/board?league=${l.id}`}>{l.name}</Link>
          ))}
          <Link className={`oc-lg${picked ? '' : ' on'}`} href="/october/board">Everyone</Link>
          <LeagueChipActions boardHref="/october/board" signedIn={uid != null} signinHref={signinHref} />
        </div>

        <div className="ob-lb">
          {rows.length ? rows.slice(0, 10).map((r) => (
            <div key={r.userId} className={`ob-lr${String(r.userId) === String(uid) ? ' you' : ''}`} data-rank={r.rank}>
              <span className="rk">{r.rank}</span>
              <span>{String(r.userId) === String(uid) ? 'you' : r.handle}{r.house ? <span className="h"> · house</span> : null}</span>
              {/* TODAY'S DELTA, and a DNF says DNF rather than +0.0 - a day
                  you did not field a card is a different fact from a day you
                  played badly. */}
              <span className="d">{r.todayState === 'dnf' ? 'DNF' : r.todayPoints == null ? '—' : `+${r.todayPoints}`}</span>
              <span className="t">{r.total}</span>
            </div>
          )) : <div className="ob-lr"><span className="rk">—</span><span>Nobody has played a day yet.</span><span /><span /></div>}
        </div>

        {/* THE LEAGUE'S OWN CODE, when one is picked - the same share path the Run
            prints and the create sheet hands back (/leagues?join=CODE, which
            exists; /leagues/join/CODE does not). */}
        {detail?.join_code ? (
          <div className="oc-inv">
            Invite<br /><b>{detail.join_code}</b><br />
            <span className="oc-inv-p">{joinHref(detail.join_code)}</span>
          </div>
        ) : null}

        {/* THE BRACKET, NOT "YOUR POOL". This module was the burn made visible -
            "used · gone for October" over a bar splitting a reader's spent
            players from their live ones - and with no burn there is no pool to
            split. What is still true, and still worth a line on a standings
            page, is which clubs are left: that is a fact about the tournament
            rather than about anybody's card. */}
        <div className="ob-pool">
          <div className="oc-eb">The bracket</div>
          <div className="row"><span>clubs still alive</span><b>{alive.size ? [...alive].sort().join(' ') : '—'}</b></div>
          <div className="row"><span>clubs eliminated</span><b>{eliminated.size ? [...eliminated].sort().join(' ') : '—'}</b></div>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}

const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd']; const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
};
