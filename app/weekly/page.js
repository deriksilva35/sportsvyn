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

import { auth } from '@/auth';
import Wordmark from '@/components/gridiron/Wordmark';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import { resolveShellMode, simViewport } from '@/lib/shell/shell';
import { shellSigninHref } from '@/lib/shell/signinHref';
import { requireSignInInShell } from '@/lib/shell/signedOut';
import { currentContest, nextContest, getEntry } from '@/lib/weekly/entries';
import StandaloneDate from '@/components/StandaloneDate';
import { weeklyState, settledView, lineupRows } from '@/lib/weekly/view';
import { liveEntryRows, liveScoredBoard } from '@/lib/weekly/live';
import { tierClass } from '@/lib/daily/reveal';
import WeeklyRoom from '@/components/weekly/WeeklyRoom';
import '../daily/daily.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'The Weekly - Sportsvyn',
  description: 'One board. Six slots. Open until the first kickoff.',
};

export async function generateViewport() {
  return simViewport(await resolveShellMode());
}

const ET = { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
const etStamp = (iso) => {
  const d = new Date(iso ?? NaN);
  return Number.isFinite(d.getTime()) ? `${d.toLocaleString('en-US', ET)} ET` : null;
};

function Shell({ children }) {
  return (
    <div className="daily-shell">
      <GlobalHeaderServer activeNav="daily" />
      <div className="weekly" data-surface="ink">
        <header className="daily-head">
          <Wordmark href="/" />
          <span className="tag">The <b>Weekly</b></span>
        </header>
        <main className="daily-main">{children}</main>
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
      <p className="hero-line">
        One board of this week&rsquo;s actives &middot; edit until{' '}
        <b>first kickoff</b> &middot; results Tuesday morning
      </p>
      {action}
    </section>
  );
}

function Rules({ contest }) {
  return (
    <section className="mod">
      <h2 className="eyebrow">How it works</h2>
      <div>
        <div className="row"><span>The board</span><span className="r">This week&rsquo;s actives</span></div>
        <div className="row"><span>Your lineup</span><span className="r">QB &middot; RB &middot; WR &middot; TE &middot; 2 FLEX</span></div>
        <div className="row"><span>Edit until</span><span className="r">{etStamp(contest?.locks_at) ?? 'First kickoff'}</span></div>
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

  const board = contest.board ?? [];

  // ---- SIGNED OUT: the pitch ----------------------------------------------
  if (userId == null) {
    return (
      <Shell>
        <Pitch action={(
          <a className="btn--volt" href={shellSigninHref('/weekly', isShell)}>
            Build this week&rsquo;s lineup
          </a>
        )} />
        <Rules contest={contest} />
      </Shell>
    );
  }

  // ---- SETTLED: the reveal -------------------------------------------------
  // The Daily's reveal with the answer-hero swapped for the week's own
  // identity. The Daily's hero answers "when are you?" because that is its
  // whole question; the Weekly already told you the week, so the hero is the
  // score itself. Every module below the hero is the Daily's, unchanged.
  if (state === 'settled') {
    const v = settledView({ contest, entry, board });
    return (
      <Shell>
        {/* Plain .hero, same as the Daily's reveal at app/daily/[date]/page.js:63.
            A modifier here would have been a divergence with no reason behind it. */}
        <section className="hero">
          <div className="hero-eyebrow">The Weekly &middot; final</div>
          <div className="hero-q">{v.season} &middot; Week {v.week}</div>
          {v.you ? (
            <p className="hero-line">
              You scored <b>{v.you.score}</b>
              {v.you.pct != null && <> &middot; {v.you.pct}% of perfect</>}
            </p>
          ) : (
            <p className="hero-line">
              {v.dnf ? 'No complete lineup was in at kickoff.' : 'You sat this one out.'}
            </p>
          )}
        </section>

        {v.you && (
          <section className="mod mod--entered">
            <h2 className="eyebrow">Your six <span className="ctx">- worst pick dropped</span></h2>
            <div className="score-row">
              <div className="score-big">{v.you.score}</div>
              <div className="score-meta">
                {v.you.tier && <span className={`tierbadge ${tierClass(v.you.tier)}`}>{v.you.tier}</span>}
                <span className="muted">perfect was {v.perfect}</span>
              </div>
            </div>
            <div>
              {v.you.picks.map((p) => (
                <div className={`row${p.dropped ? ' row--dropped' : ''}`} key={p.slot}>
                  <span>
                    <span className="slot-tag">{p.slot === 'FLEX2' ? 'FLEX' : p.slot}</span>{' '}
                    {p.name ?? <span className="muted">empty</span>}
                    {p.team && <span className="muted"> · {p.team}</span>}
                  </span>
                  <span className="r">
                    {p.points ?? '-'}
                    {p.dropped && <span className="r--mut"> dropped</span>}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="mod">
          <h2 className="eyebrow">The perfect lineup <span className="ctx">- {v.perfect}</span></h2>
          <div>
            {v.perfectPicks.map((p) => (
              <div className="row" key={p.slot ?? p.id}>
                <span>
                  <span className="slot-tag">{p.slot === 'FLEX2' ? 'FLEX' : p.slot}</span>{' '}
                  {p.name}{p.team && <span className="muted"> · {p.team}</span>}
                </span>
                <span className="r">{p.points}</span>
              </div>
            ))}
          </div>
        </section>

        <p className="muted">
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
                {(live?.rows ?? lineupRows(entry.lineup, board)).map((p) => (
                  <div className="row" key={p.slot}>
                    <span>
                      <span className="slot-tag">{p.slot === 'FLEX2' ? 'FLEX' : p.slot}</span>{' '}
                      {p.name ?? <span className="muted">empty</span>}
                      {p.team && <span className="muted"> · {p.team}</span>}
                    </span>
                    <span className={`r${p.played ? '' : ' r--mut'}`}>
                      {p.id == null ? '' : p.played ? p.points : '-'}
                    </span>
                  </div>
                ))}
                <div className="row"><span>Results</span><span className="r r--mut">Tuesday morning &middot; drop-worst applies at settle</span></div>
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
  return (
    <Shell>
      <WeeklyRoom
        contest={{ id: contest.id, locks_at: contest.locks_at, week: contest.week }}
        board={board}
        initialLineup={entry?.lineup ?? {}}
        locksAtLabel={etStamp(contest.locks_at)}
      />
      <Rules contest={contest} />
    </Shell>
  );
}
