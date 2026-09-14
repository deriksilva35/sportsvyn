/**
 * /weekly - The Weekly.
 *
 * THE DAILY'S PAGE WITH A LONGER CLOCK. Same shell, same header, same module
 * grammar, same tiers. The scope law for this build was ADAPT, DON'T CONSTRUCT,
 * so the state machine below is deliberately the Daily's shape with the middles
 * swapped: rules -> building -> locked -> settled, where the Daily runs
 * rules -> playing -> entered -> revealed.
 *
 * THE BOARD IS RENDERED HERE, and that is the one structural divergence from
 * the Daily worth naming. The Daily withholds its board until POST /start
 * stamps a clock, because opening the page must not start the round. The
 * Weekly has no round to start: the board is public from Tuesday, everyone
 * sees the same one from Tuesday until kickoff, and there is nothing to hide.
 * ships with the page instead of arriving from an endpoint.
 *
 * SETTLED IS FINAL. The reveal below reads the settled contest row; it does
 * not recompute. See lib/weekly/settle.js.
 */

import Link from 'next/link';
import { auth } from '@/auth';
import Wordmark from '@/components/gridiron/Wordmark';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import { resolveShellMode, simViewport } from '@/lib/shell/shell';
import { shellSigninHref } from '@/lib/shell/signinHref';
import { requireSignInInShell } from '@/lib/shell/signedOut';
import { currentContest, nextContest, getEntry } from '@/lib/weekly/entries';
import { slateBounds, teamKickoffs, rowKickoff, lockPhase } from '@/lib/contests/slateBounds';
import StandaloneDate from '@/components/StandaloneDate';
import StandaloneTime from '@/components/StandaloneTime';
import { weeklyState, settledView, lineupRows, SLOT_LABEL, SLOT_EMOJI } from '@/lib/weekly/view';
import { liveEntryRows, liveScoredBoard, liveBoard } from '@/lib/weekly/live';
import { slotStates } from '@/lib/weekly/slotState';
import { weekTeamGames } from '@/lib/gridiron/todayV2';
import { weekStatLines } from '@/lib/weekly/pool';
import WeeklyRoom from '@/components/weekly/WeeklyRoom';
import WeeklyGrade from '@/components/weekly/WeeklyGrade';
import { WeeklyPreOpenLine } from '@/components/games/preOpenLine';
import { scoreLeaderboard } from '@/lib/games/leaderboard';
import { userHasHandle } from '@/lib/onboarding';
import { sql } from '@/lib/db';
import '../daily/daily.css';
import '@/components/games/grade.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'The Weekly - Sportsvyn',
  description: 'One board. Six slots. Open until the first kickoff.',
};

export async function generateViewport() {
  return simViewport(await resolveShellMode());
}

// ONE TIME ZONE PER SCREEN (relay 3b item 2). Every clock on this page now
// goes through <StandaloneDate>: ET before hydration, the viewer's own zone
// after. The local etStamp() this replaced formatted server-side and pinned
// " ET" onto the string, so the page rendered its hero lock in PDT and the
// rules table's "Edit until" in ET - the same instant, stated twice, three
// hours apart. A null iso still has to render something, hence Stamp.
const Stamp = ({ iso, fallback = null }) => (
  iso && Number.isFinite(new Date(iso).getTime()) ? <StandaloneDate iso={iso} /> : fallback
);

function Shell({ children }) {
  return (
    <div className="daily-shell">
      <GlobalHeaderServer activeNav="daily" />
      <div className="weekly" data-surface="ink">
        <header className="daily-head">
          <Wordmark href="/" />
          <span className="tag">The <b>Weekly</b></span>
        </header>
        <main className="daily-main">
          {/* The back crumb Pick'em already carries (app/pickem/[sport]/page.js):
              same component, same class, first child of <main> - so all three
              games walk back to the lobby the same way, signed in or out.
              Inside Shell, which every return path on this page goes through. */}
          <Link className="appcrumb" href="/games">&larr; Games</Link>
          {children}
        </main>
      </div>
    </div>
  );
}

/**
 * HOW IT WORKS, and it carries the Tuesday promise.
 *
 * The "results Tuesday morning" line is a launch condition, not decoration:
 * four games settle off Monday-night finals and the honest answer to "when do
 * I find out" is Tuesday, not Monday night. Saying so before anyone enters is
 * the difference between a schedule and an excuse. It appears on both the
 * signed-out pitch and the signed-in rules, because those are two different
 * readers and only one of them ever sees the other surface.
 */
/**
 * THE PITCH HERO. Shared by the signed-out reader and the pre-board state,
 * because they are the same reader with the same question - "what is this?" -
 * and only the last line differs. `action` is whatever belongs where the button
 * goes: a real CTA when there is a board, an honest date when there is not.
 */
function Pitch({ action }) {
  return (
    <section className="hero">
      <div className="hero-eyebrow">The Weekly &middot; same board for everyone</div>
      <div className="hero-q">Six slots.<br />No clock.</div>
      <WeeklyPreOpenLine />
      {action}
    </section>
  );
}

function Rules({ contest, firstKickoff = null }) {
  return (
    <section className="mod">
      <h2 className="eyebrow">How it works</h2>
      <div>
        <div className="row"><span>The board</span><span className="r">This week&rsquo;s actives</span></div>
        <div className="row"><span>Your lineup</span><span className="r">QB &middot; RB &middot; WR &middot; TE &middot; 2 FLEX</span></div>
        <div className="row"><span>First kickoff</span><span className="r"><Stamp iso={firstKickoff ?? contest?.locks_at} fallback="First kickoff" /></span></div>
        <div className="row"><span>Each slot</span><span className="r">locks at its player&rsquo;s kickoff</span></div>
        <div className="row"><span>Scoring</span><span className="r">PPR, worst pick dropped</span></div>
        <div className="row"><span>Results</span><span className="r">Tuesday morning</span></div>
      </div>
      <p className="muted">
        Every change saves - there is no submit. Whatever is in your six slots at
        the first kickoff is your entry. Scores settle once the last game is final,
        which is why results land <b>Tuesday morning</b> rather than Monday night, and
        a settled week does not move again.
      </p>
    </section>
  );
}

export default async function WeeklyPage({ searchParams }) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const isShell = await resolveShellMode();
  // Signed out in the container: the sign-in form, not this page's hero.
  requireSignInInShell({ isShell, userId, dest: '/weekly' });

  // A missing contests table (067 unapplied) must ghost, not 500 - same posture
  // as the lobby's card reads.
  const contest = await currentContest().catch(() => null);
  const entry = contest && userId != null
    ? await getEntry(contest.id, Number(userId)).catch(() => null)
    : null;
  const state = weeklyState({ contest, entry });
  const hasHandle = await userHasHandle(userId, sql);

  // ---- NO BOARD ------------------------------------------------------------
  //
  // THE FULL PITCH, NOT A SENTENCE. This state shipped as one line of text on a
  // black screen, and it is the state a stranger following a link before the
  // season is MOST likely to land in - the one moment the page has to explain
  // itself, spent saying "not yet". A reader who arrives pre-board should leave
  // knowing what the game is and when to come back, which costs nothing but the
  // markup that already exists two branches down.
  //
  // The waiting line sits exactly where the CTA sits in every other state, so
  // the eye lands on the answer to "can I play" in the same place either way.
  // Same treatment will apply to /pickem and /draft before their first boards.
  if (state === 'none') {
    const upcoming = await nextContest().catch(() => null);
    return (
      <Shell>
        <Pitch action={(
          <div className="wk-soon">
            {upcoming ? (
              <>
                Opens <StandaloneDate iso={upcoming.opens_at} /><br />
                Locks <StandaloneDate iso={upcoming.locks_at} />
              </>
            ) : 'No board scheduled yet'}
          </div>
        )} />
        <Rules contest={null} />
      </Shell>
    );
  }

  // ROLLING LOCK: every pool row carries the kickoff of its team's game this
  // week (R3; a bye locks at the window close). The kickoffs are the lock;
  // the room prints them through StandaloneTime, in the viewer's zone.
  const [bounds, kickoffs] = await Promise.all([slateBounds(contest), teamKickoffs(contest)]);
  const board = (contest.board ?? []).map((p) => ({ ...p, kickoff_at: rowKickoff(p, kickoffs, contest.locks_at) }));
  const firstKickoff = bounds?.firstKickoff ?? null;

  // ---- SETTLED: the reveal -------------------------------------------------
  // The Daily's reveal with the answer-hero swapped for the week's own
  // identity. The Daily's hero answers "when are you?" because that is its
  // whole question; the Weekly already told you the week, so the hero is the
  // score itself. Every module below the hero is the Daily's, unchanged.
  if (state === 'settled') {
    const v = settledView({ contest, entry, board });
    const leaderboard = await scoreLeaderboard(contest.id, userId != null ? Number(userId) : null, { limit: 5, game: 'weekly' });
    const next = await nextContest().catch(() => null);
    // The ~12 players actually on the card - yours and the ceiling's -
    // never the whole week. Caught: a missing stat line costs a row its
    // detail, never the page.
    const statLines = await weekStatLines(
      contest.season_year, contest.week,
      [...(v.you?.picks ?? []), ...v.perfectPicks].map((p) => p.id),
    ).catch(() => new Map());
    return (
      <Shell>
        <WeeklyGrade
          v={v} board={board} settledAtIso={contest.settled_at} statLines={statLines}
          leaderboard={leaderboard} next={next} userId={userId != null ? Number(userId) : null}
        />
        {!v.you && (
          <p className="muted" style={{ margin: '0 12px 12px' }}>
            {v.dnf ? 'No complete lineup was in at kickoff.' : 'You sat this one out.'}
          </p>
        )}
        <p className="muted" style={{ margin: '0 12px 12px' }}>
          Settled from final box scores. A settled week is final - later stat
          corrections do not move it.
        </p>
      </Shell>
    );
  }

  // ---- LOCKED: in flight ---------------------------------------------------
  // THE WINDOW HAS NUMBERS NOW (v0.2 live totals): the same poolWithScores the
  // settle uses, read mid-flight. The total is ALL SIX, before drop-worst -
  // live is a sum, not a verdict (see lib/weekly/live.js for why dropping a
  // player who has not kicked off would read as the site benching him).
  if (state === 'locked') {
    const filled = entry ? Object.values(entry.lineup ?? {}).filter(Boolean).length : 0;
    const live = entry
      ? await (async () => {
        const { scored, playedIds } = await liveScoredBoard(contest);
        return liveEntryRows({ lineup: entry.lineup ?? {}, scored, playedIds });
      })().catch(() => null)
      : null;
    // THE GAME BESIDE THE NUMBER, here as in the room above it. Without it a
    // locked row printed "-" for a man who has not kicked off and his real
    // number for one who had, with nothing to say which was which.
    const games = await weekTeamGames({ week: contest.week, seasonYear: contest.season_year }).catch(() => new Map());
    const view = live ? slotStates({ rows: live.rows, gamesByTeam: games }) : null;
    return (
      <Shell>
        <section className="mod mod--entered">
          <h2 className="eyebrow">
            Week {contest.week} <span className="ctx">- locked</span>
          </h2>
          {entry ? (
            <>
              <p className="mod-lede">
                Your lineup is in. {filled} of 6 slots filled.
              </p>
              {live && (
                <div className="score-row">
                  <div className="score-big">{live.total}</div>
                  <div className="score-meta">
                    <span className="muted">
                      live &middot; {live.playedCount} of {live.slots} played &middot; before drop-worst
                    </span>
                  </div>
                </div>
              )}
              {/* lineupRows walked SLOTS for order; the live rows walk the same
                  SLOTS, so the order law holds and points ride along. */}
              <div>
                {view
                  ? view.rows.map(({ row: p, state: st }) => (
                    <div className="row" key={p.slot} data-game={st.kind}>
                      <span>
                        <span className="slot-tag">{p.slot === 'FLEX2' ? 'FLEX' : p.slot}</span>{' '}
                        {p.name ?? <span className="muted">empty</span>}
                        {p.team && <span className="muted"> · {p.team}</span>}
                        {st.label && <span className="muted"> · {st.label}</span>}
                      </span>
                      {/* A NUMBER, OR THE KICKOFF - never a dash standing in
                          for both "has not played" and "we do not know". */}
                      <span className={`r${st.started ? '' : ' r--mut'}`}>
                        {st.started ? st.points
                          : st.kickoffAt ? <StandaloneTime iso={st.kickoffAt} />
                            : st.kind === 'bye' ? 'bye' : ''}
                      </span>
                    </div>
                  ))
                  : lineupRows(entry.lineup, board).map((p) => (
                    <div className="row" key={p.slot}>
                      <span>
                        <span className="slot-tag">{p.slot === 'FLEX2' ? 'FLEX' : p.slot}</span>{' '}
                        {p.name ?? <span className="muted">empty</span>}
                        {p.team && <span className="muted"> · {p.team}</span>}
                      </span>
                      <span className="r r--mut">-</span>
                    </div>
                  ))}
                <div className="row"><span>Results</span><span className="r r--mut r--wrap">Tuesday morning &middot; drop-worst applies at settle</span></div>
              </div>
            </>
          ) : (
            <p className="mod-lede">
              This week locked at first kickoff and you did not have a lineup in.
              The next board opens Tuesday morning.
            </p>
          )}
        </section>
      </Shell>
    );
  }

  // ---- RULES / BUILDING ----------------------------------------------------
  // Both states render the builder; the rules module sits below it for a
  // first-time reader rather than gating the board behind a START. There is no
  // clock to start, so there is nothing for a gate to protect.
  // ROLLING LOCK (R4): the hour-out reminder keys on the FIRST kickoff; the
  // header names the first kickoff until it passes, then the window close.
  const { beforeFirst } = lockPhase({ firstKickoff, locksAt: contest.locks_at });
  const reminderAt = new Date(new Date(firstKickoff ?? contest.locks_at).getTime() - 3_600_000);

  // ---- THE LIVE LAYER ------------------------------------------------------
  // ROLLING LOCK MEANS THE ROOM IS OPEN WHILE GAMES ARE ON. The contest's own
  // locks_at is the LAST kickoff of the week, so from Thursday night to Monday
  // night this branch is what a reader with a full lineup is looking at - and
  // until now it showed six names and a lock time while four of them were
  // playing. Same pair the Today tab's hero reads: liveEntryRows for the
  // numbers, the week's slate for what each player's game is doing.
  //
  // NULL UNTIL SOMETHING HAS HAPPENED. Before the first kickoff there is no
  // live layer at all and the room renders exactly as it always has.
  const live = await (async () => {
    if (!entry) return null;
    const [{ scored, playedIds }, games] = await Promise.all([
      liveScoredBoard(contest),
      weekTeamGames({ week: contest.week, seasonYear: contest.season_year }),
    ]);
    const mine = liveEntryRows({ lineup: entry.lineup ?? {}, scored, playedIds });
    const gamesByTeam = Object.fromEntries(games);
    const view = slotStates({ rows: mine.rows, gamesByTeam: games });
    if (view.startedCount === 0) return null;
    // THE RANK IS THE ONE THE TODAY TAB ALREADY PRINTS for this same contest -
    // an aggregate over entries, never a lineup. liveBoard selects no lineup
    // column at all, which is the leak law's shape for this window.
    const board2 = await liveBoard(contest, { limit: 100000 }).catch(() => []);
    const me = board2.find((r) => r.userId === Number(userId)) ?? null;
    return {
      byId: Object.fromEntries(mine.rows.filter((r) => r.id != null)
        .map((r) => [r.id, { points: r.points, played: r.played }])),
      games: gamesByTeam,
      total: view.total,
      startedCount: view.startedCount,
      slots: view.slots,
      rank: me ? me.rank : null,
      of: board2.length,
    };
  })().catch(() => null);
  return (
    <Shell>
      {/* THE HEADER AND PROGRESS (relay 2a item 6) - the mock's .hdr/.yr/
          .prog/.needline, sitting above the unchanged builder. */}
      <header className="hdr">
        <span className="ed">The Weekly &middot; Week {contest.week}</span>
        <span className="clock">{beforeFirst ? 'first kickoff ' : 'locks '}<StandaloneDate iso={beforeFirst ? firstKickoff : contest.locks_at} /></span>
      </header>
      <div className="yr">
        <h1>Week {contest.week}</h1>
        <div className="sub">
          Six slots. No clock. Any six from the full pool, full PPR, and whatever is
          saved at first kickoff is your entry.
        </div>
      </div>
      <div className="warn">
        Same board for everyone. You are graded against the best six this pool
        could have made.
      </div>
      {/* THE COUNTERS LIVE IN WeeklyRoom NOW (relay 3 item 1). They were
          here, computed from entry.lineup - the server's copy, frozen at
          page load - while the six rows below were driven by WeeklyRoom's
          own client state. A pick updated the rows and left the pips, the
          caption and the needline behind. One source now, and it is the
          one that changes when you tap. */}
      <WeeklyRoom
        contest={{ id: contest.id, locks_at: contest.locks_at, week: contest.week }}
        board={board}
        initialLineup={entry?.lineup ?? {}}
        initialConfirmedAt={entry?.meta?.confirmed_at ?? null}
        locksAt={contest.locks_at}
        firstKickoff={firstKickoff}
        signedIn={userId != null}
        signinHref={shellSigninHref('/weekly', isShell)}
        hasHandle={hasHandle}
        live={live}
      />

      {/* ONCE OPEN, THIS IS WHAT 'HOW IT WORKS' BECOMES (2a-polish item 1) -
          the mock's own .perf box under the board, never the pitch's rules
          table above it. Same reader, same question, but they are looking at
          the board now rather than wondering whether to. */}
      <div className="perf">
        <b>The best six this pool allows</b>
        <p>
          Revealed Tuesday morning when Week {contest.week} settles. Your grade is
          your six as a percentage of it. Raw points never cross weeks - a
          bye-heavy week has a lower ceiling and the percentage knows that.
        </p>
      </div>

      <div className="mathline">
        Alerts: opens <Stamp iso={contest.opens_at} /> &middot; one hour before first kickoff <Stamp iso={reminderAt.toISOString()} />
        {contest.settles_at && <> &middot; graded <Stamp iso={contest.settles_at} /></>}. All on.
      </div>
    </Shell>
  );
}
