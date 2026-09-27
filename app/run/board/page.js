/**
 * /run/board - frame 3 of the mock: league chips, four round columns, the
 * pool bar and the invite link.
 *
 * ?league=<id> picks one of the reader's own; anything else is Everyone.
 */

import Link from 'next/link';
import { auth } from '@/auth';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import { currentRunRound, settledRounds } from '@/lib/run/create';
import { ROUND_COLUMNS, poolSplit } from '@/lib/run/board';
import { runLive, roundView, withMlbMovement } from '@/lib/boards/mlb';
import { boardView } from '@/lib/boards/view';
import YouCard from '@/components/boards/YouCard';
import LiveRefresh from '@/components/scores/LiveRefresh';
import { usedPlayers } from '@/lib/run/pool';
import { roundPips } from '@/lib/run/rules';
import { myLeagues, leagueMemberIds, leagueDetail } from '@/lib/leagues/core';
import { joinHref } from '@/lib/leagues/code';
import { resolveShellMode } from '@/lib/shell/shell';
import { shellSigninHref } from '@/lib/shell/signinHref';
import LeagueChipActions from '@/components/leagues/LeagueChipActions';
import { seriesFor } from '@/lib/mlb/series';
import '../../games/games.css';
import '../run.css';
import '../../boards/board.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'The Run · league board - Sportsvyn' };

export default async function RunBoardPage({ searchParams }) {
  const q = await searchParams;
  const session = await auth();
  const uid = session?.user?.id ?? null;
  const contest = await currentRunRound({ now: new Date() }).catch(() => null);
  const season = contest?.season_year ?? new Date().getUTCFullYear();
  const round = contest?.board?.round ?? null;

  const shell = await resolveShellMode().catch(() => null);
  const signinHref = shellSigninHref('/run/board', shell?.isShell ?? false);
  const leagues = uid == null ? [] : await myLeagues(Number(uid)).catch(() => []);
  const wanted = q?.league ? String(q.league) : null;
  const picked = leagues.find((l) => String(l.id) === wanted) ?? null;

  const [memberIds, rows, used, series, done, detail] = await Promise.all([
    picked ? leagueMemberIds(picked.id).catch(() => []) : Promise.resolve(null),
    Promise.resolve(null),
    uid == null ? Promise.resolve(new Map()) : usedPlayers(Number(uid), season).catch(() => new Map()),
    seriesFor(null, season).catch(() => []),
    settledRounds(season).catch(() => []),
    picked ? leagueDetail(picked.id, Number(uid)).catch(() => null) : Promise.resolve(null),
  ]);
  // WHICH TOURNAMENT THIS BOARD IS ABOUT, the same way October's board says it.
  // runBoard has always scoped by meta.preview; this page never told it which, so
  // it always read the POSTSEASON - and the morning somebody files a nine into a
  // preview round, that board would have shown nothing. A no-op today (PROD holds
  // four preview rounds and zero entries), and correct the day it is not.
  const preview = contest?.meta?.preview === true;
  // LIVE, NOT SETTLED-ONLY (lib/boards/mlb.js): the round in play scores every
  // entry through scoreRoster on read, settled rounds keep the settle's score,
  // and movement is where each entrant stood ten minutes ago.
  const now = new Date();
  const liveBoard = await runLive(season, { memberIds, preview, now }).catch(() => ({ rows: [], liveContestId: null, liveRound: null }));
  const board = await withMlbMovement(liveBoard, now).catch(() => liveBoard.rows);
  void rows;
  // THE PER-ROUND VIEW: ?round=<wild_card|division|championship|world_series>
  // ranks one round's column on its own; anything else is the overall standing.
  const roundPick = ROUND_COLUMNS.some((c) => c.round === q?.round) ? q.round : null;
  const table = roundPick ? roundView(board, roundPick) : board;
  const view = boardView(table, uid, { top: 12 });

  const eliminated = new Set();
  for (const s of series) {
    if (!s.winner) continue;
    for (const t of s.teams) if (t.id !== s.winner) eliminated.add(t.abbreviation);
  }
  const alive = [...new Set(series.flatMap((s) => s.teams.map((t) => t.abbreviation)))]
    .filter((a) => !eliminated.has(a));
  const split = poolSplit({ used, aliveClubs: alive, deadClubs: [...eliminated], poolSize: used.size + alive.length * 26 });
  // THE READER IS FOUND IN THE WHOLE STANDING. runBoard used to return fifty
  // rows and this looked inside them, so 51st and below read "not entered".
  const me = board.find((r) => String(r.userId) === String(uid)) ?? null;
  const liveRound = liveBoard.liveRound;
  const pips = roundPips(round, done);

  return (
    <div className="gi rnpage" data-surface="ink">
      <GlobalHeaderServer activeNav="games" />
      <div className="rn-wrap">
        {/* THE SEPARATOR WAS MISSING. Two adjacent anchors with no rule between
            them served as "‹ Your nine Bracket ›" - one phrase, unreadable. */}
        <div className="rn-crumb">
          <Link href="/run">&#8249; Your nine</Link>
          <span className="rn-crumb-sep" aria-hidden="true">·</span>
          <Link href="/mlb/bracket">Bracket &#8250;</Link>
        </div>

        <div className="rn-hd" style={{ borderRadius: '18px 18px 0 0' }}>
          <div className="rn-hd-top">
            <span className="rn-eb">The Run</span>
            <span className="rn-ed">{picked ? picked.name : 'Everyone'} · {board.length} playing</span>
          </div>
          <YouCard
            me={me} count={board.length} name={me?.name} label="You" sideTitle="Total"
            sub={me && liveRound && me.rounds?.[liveRound]?.kind === 'live'
              ? `${ROUND_COLUMNS.find((c) => c.round === liveRound)?.short ?? 'this round'} ${me.rounds[liveRound].points} · live`
              : me ? `${ordinal(me.rank)} · ${Math.round(((board[0]?.points ?? 0) - me.points) * 10) / 10} back` : null}
            live={liveBoard.liveContestId != null} signedIn={uid != null} signinHref={signinHref}
            homeHref="/run" joinWord="Set your nine"
          />
          {liveBoard.liveContestId != null ? <LiveRefresh everyMs={60_000} /> : null}
          <div className="rn-rounds">
            {pips.map((r) => (
              <span key={r.round} className={`rn-rd ${r.state}`} data-round={r.round}><i /><b>{r.label}</b></span>
            ))}
          </div>
        </div>

        <div className="rn-lgs">
          {leagues.map((l) => (
            <Link key={l.id} className={`rn-lg${picked && picked.id === l.id ? ' on' : ''}`}
              href={`/run/board?league=${l.id}`}>{l.name}</Link>
          ))}
          <Link className={`rn-lg${picked ? '' : ' on'}`} href="/run/board">Everyone</Link>
          {/* JOIN AND CREATE, HERE. Both writes belong on the board the reader is
              looking at - see components/leagues/LeagueChipActions.js for why
              "create one from /leagues" was not an instruction an app can give. */}
          {/* THE SIGN-IN HREF IS THE HOUSE ONE. /signin reads ?callbackUrl=, not
              ?next=, and shellSigninHref also carries the shell marker through
              the Apple round trip - see lib/shell/signinHref.js. app/run/page.js
              builds it the same way for the roster's own sign-in line. */}
          <LeagueChipActions boardHref="/run/board" signedIn={uid != null}
            signinHref={signinHref} />
        </div>

        {/* ONE ROUND AT A TIME, or the whole run. A chip per round opens that
            round's column as its own ranked board. */}
        <div className="rn-lgs rb-rounds" aria-label="Rounds">
          <Link className={`rn-lg${roundPick ? '' : ' on'}`} href={`/run/board${picked ? `?league=${picked.id}` : ''}`}>Overall</Link>
          {ROUND_COLUMNS.map((c) => (
            <Link key={c.round} className={`rn-lg${roundPick === c.round ? ' on' : ''}${liveRound === c.round ? ' live' : ''}`}
              href={`/run/board?round=${c.round}${picked ? `&league=${picked.id}` : ''}`}>{c.short}{liveRound === c.round ? ' · live' : ''}</Link>
          ))}
        </div>

        <div className="rb-lb">
          <div className="rb-lr hd2">
            <span /><span>player</span>
            {ROUND_COLUMNS.map((c) => <span key={c.round} className="r">{c.short}</span>)}
            <span className="r">{roundPick ? ROUND_COLUMNS.find((c) => c.round === roundPick)?.short : 'total'}</span>
          </div>
          {table.length ? [...view.head, ...(view.gap ? [null] : []), ...view.around].map((r, i) => (r == null
            ? <div key={`gap-${i}`} className="rb-lr rb-gap" aria-hidden="true"><span /><span>· · ·</span></div>
            : (
            <div key={r.userId} className={`rb-lr${String(r.userId) === String(uid) ? ' you' : ''}`} data-rank={r.rank}>
              <span className="rk">{r.rank}</span>
              <span>{String(r.userId) === String(uid) ? 'you' : r.handle}{r.house ? <span className="h"> · house</span> : null}</span>
              {ROUND_COLUMNS.map((c) => {
                const cell = r.rounds[c.round];
                return (
                  <span key={c.round} className={`r${cell?.kind === 'set' ? ' set' : ''}${cell?.kind === 'live' ? ' live' : ''}${roundPick === c.round ? ' on' : ''}`}>
                    {cell == null ? '–' : cell.kind === 'dnf' ? 'DNF' : cell.kind === 'set' ? 'set' : cell.points}
                  </span>
                );
              })}
              <span className="t">{r.points}</span>
            </div>
          ))) : (
            <div className="rb-lr"><span className="rk">—</span><span>Nobody has set a nine yet.</span>
              {ROUND_COLUMNS.map((c) => <span key={c.round} />)}<span /></div>
          )}
        </div>

        <div className="rb-pool">
          <div className="rn-eb">Your pool{round ? ` for the ${pips.find((p) => p.round === round)?.label} round` : ''}</div>
          <div className="row"><span>used · gone for October</span><b>{split.used}</b></div>
          <div className="row"><span>clubs alive</span><b>{split.aliveClubs.length ? split.aliveClubs.join(' ') : '—'}</b></div>
          <div className="row"><span>clubs eliminated</span><b>{split.deadClubs.length ? split.deadClubs.join(' ') : '—'}</b></div>
          <div className="rb-bar">
            <i className="g" style={{ width: `${split.pct.used}%` }} />
            <i className="a" style={{ width: `${split.pct.alive}%` }} />
          </div>
        </div>

        <div className="rn-ft">
          {/* THE SHARE LINK IS A PATH THAT EXISTS. This printed
              sportsvyn.com/leagues/join/<code>, which 404s - there is no
              /leagues/join route and app/leagues/[id] cannot match two segments.
              joinHref() is the one that works, and it is the same one the create
              sheet hands back. The no-league case no longer sends anybody to the
              web: the chips above do it. */}
          <div className="rn-pace">
            {detail?.join_code
              ? <>Invite<br /><b>{detail.join_code}</b><br /><span className="rn-inv">{joinHref(detail.join_code)}</span></>
              : <>Play with friends<br /><b>Join or create one above</b></>}
          </div>
          <Link className="rn-lock" href="/run">Set your nine</Link>
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
