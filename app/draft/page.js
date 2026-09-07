/**
 * /draft - The Draft, ranked.
 *
 * THE WEEKLY'S PAGE WITH A ROOM BEHIND IT. Same shell, same stylesheet, same
 * module grammar, same tiers, same state-machine shape - adaptation, not
 * construction. The one structural divergence: this page never renders the
 * draft itself. The sim's room at /sim/draft/[id] IS the surface, per the
 * ruling, so `drafting` is a link into it rather than a second room built here.
 *
 * FIVE STATES: rules -> drafting -> waiting -> locked -> settled.
 */

import { auth } from '@/auth';
import Wordmark from '@/components/gridiron/Wordmark';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import { resolveShellMode, simViewport } from '@/lib/shell/shell';
import { shellSigninHref } from '@/lib/shell/signinHref';
import { requireSignInInShell } from '@/lib/shell/signedOut';
import { liveEntryRows, liveScoredBoard } from '@/lib/weekly/live';
import { weekStatLines } from '@/lib/weekly/pool';
import { draftState, draftSettledView, seatOptions } from '@/lib/draft/view';
import { draftState as readDraftState, fieldBestRoster } from '@/lib/draft/entry';
import { DRAFT_CONFIG, DRAFT_ROUNDS, nextDraftContest } from '@/lib/draft/contest';
import SeatSelect from '@/components/draft/SeatSelect';
import DraftGrade from '@/components/draft/DraftGrade';
import StandaloneDate from '@/components/StandaloneDate';
import { DraftPreOpenLine } from '@/components/games/preOpenLine';
import { draftFieldLeaderboard, draftSeatTable } from '@/lib/games/leaderboard';
import { userHasHandle } from '@/lib/onboarding';
import { sql } from '@/lib/db';
import '../daily/daily.css';
import './draft.css';
import '@/components/games/grade.css';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'The Draft - Sportsvyn',
  description: 'Eight rounds against the room. Best ball, one week.',
};

export async function generateViewport() {
  return simViewport(await resolveShellMode());
}

// ONE TIME ZONE PER SCREEN (relay 3b item 2). Every clock on this page goes
// through <StandaloneDate> - ET before hydration, the viewer's own zone
// after. The etStamp() this replaced formatted server-side with " ET"
// pinned on, so the seat-select header said "rooms lock ... PDT" while the
// waiting card's "Locks" row said ET, three hours apart on one screen.
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
          <span className="tag">The <b>Draft</b></span>
        </header>
        <main className="daily-main">{children}</main>
      </div>
    </div>
  );
}

/** HOW IT WORKS, carrying the Tuesday promise like every other game's rules. */
function Rules({ contest }) {
  return (
    <section className="mod">
      <h2 className="eyebrow">How it works</h2>
      <div>
        <div className="row"><span>The room</span><span className="r">{DRAFT_CONFIG.teamsCount} teams, snake</span></div>
        <div className="row"><span>Your roster</span><span className="r">QB &middot; 2 RB &middot; 3 WR &middot; TE &middot; FLEX</span></div>
        <div className="row"><span>The clock</span><span className="r">{DRAFT_CONFIG.clockSeconds}s per pick</span></div>
        <div className="row"><span>Scoring</span><span className="r">Best ball, PPR, drop worst</span></div>
        <div className="row"><span>Drafts until</span><span className="r"><Stamp iso={contest?.locks_at} fallback="First kickoff" /></span></div>
        <div className="row"><span>Results</span><span className="r">Tuesday morning</span></div>
      </div>
      <p className="muted">
        Best ball means you never set a lineup: your best six score automatically from
        what your players actually did. Every pick counts, so there is no bench to hide
        a miss on. One ranked draft a week - results land <b>Tuesday morning</b>,
        and a settled week does not move again.
      </p>
    </section>
  );
}

export default async function DraftPage({ searchParams }) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const isShell = await resolveShellMode();
  // Signed out in the container: the sign-in form, not this page's hero.
  requireSignInInShell({ isShell, userId, dest: '/draft' });

  // A missing contests table must ghost, not 500 - the lobby's posture.
  const st = await readDraftState(userId).catch(() => ({ contest: null, entry: null, draft: null }));
  const { contest, entry, draft } = st;
  const state = draftState({ contest, entry, draft });
  const hasHandle = await userHasHandle(userId, sql);

  // ---- NO BOARD: the full pitch, per the /weekly ruling -------------------
  if (state === 'none') {
    const upcoming = await nextDraftContest().catch(() => null);
    return (
      <Shell>
        <section className="hero">
          <div className="hero-eyebrow">The Draft &middot; ranked</div>
          <div className="hero-q">Eight rounds.<br />No bench.</div>
          <DraftPreOpenLine />
          <div className="wk-soon">
            {upcoming ? (
              <>
                Opens <StandaloneDate iso={upcoming.opens_at} /><br />
                Locks <StandaloneDate iso={upcoming.locks_at} />
              </>
            ) : 'No room scheduled yet'}
          </div>
        </section>
        <Rules contest={null} />
      </Shell>
    );
  }

  // ---- SETTLED -------------------------------------------------------------
  if (state === 'settled') {
    const v = draftSettledView({ contest, entry, board: contest.board });
    const seat = draft?.pick_position ?? null;
    const room = entry?.meta?.room ?? null;
    const fieldBest = contest.perfect?.entry_id != null
      ? await fieldBestRoster(contest.perfect.entry_id, contest.board).catch(() => null)
      : null;
    const leaderboard = await draftFieldLeaderboard(contest.id, userId != null ? Number(userId) : null, { limit: 5 });
    const seatTable = await draftSeatTable(contest.id, DRAFT_CONFIG.teamsCount);
    const next = await nextDraftContest().catch(() => null);
    const statLines = await weekStatLines(
      contest.season_year, contest.week,
      [...(v.roster ?? []), ...(fieldBest?.roster ?? [])].map((p) => p.id),
    ).catch(() => new Map());
    return (
      <Shell>
        <DraftGrade
          v={v} seat={seat} room={room} fieldBest={fieldBest} settledAtIso={contest.settled_at} statLines={statLines}
          leaderboard={leaderboard} seatTable={seatTable} next={next}
          userId={userId != null ? Number(userId) : null}
        />
        {!v.you && (
          <p className="muted" style={{ margin: '0 12px 12px' }}>
            {v.dnf ? 'No complete roster was in at kickoff.' : 'You sat this one out.'}
          </p>
        )}
        <p className="muted" style={{ margin: '0 12px 12px' }}>
          Settled from final box scores. A settled week is final - later stat
          corrections do not move it.
        </p>
      </Shell>
    );
  }

  // ---- LOCKED --------------------------------------------------------------
  if (state === 'locked') {
    const roster = entry?.meta?.roster ?? [];
    // LIVE BEST-6 (v0.2 live totals): best ball over LIVE scores - the best
    // six AS OF NOW, which can differ from the final six; the label carries
    // it. Same read the Weekly's window uses; drop-worst waits for settle.
    const live = roster.length
      ? await (async () => {
        const { scored, playedIds } = await liveScoredBoard(contest);
        return liveEntryRows({ roster, scored, playedIds });
      })().catch(() => null)
      : null;
    const liveIds = new Set((live?.rows ?? []).map((r) => r.id).filter(Boolean));
    return (
      <Shell>
        <section className="mod mod--entered">
          <h2 className="eyebrow">Week {contest.week} <span className="ctx">- locked</span></h2>
          {roster.length ? (
            <>
              <p className="mod-lede">
                Your {roster.length} picks are in. Best ball scores your best six once
                every game is final.
              </p>
              {live && (
                <div className="score-row">
                  <div className="score-big">{live.total}</div>
                  <div className="score-meta">
                    <span className="muted">
                      live best six &middot; {live.playedCount} of {live.slots} played &middot; before drop-worst
                    </span>
                  </div>
                </div>
              )}
              <div>
                {roster.map((r) => (
                  <div className={`row${liveIds.size && !liveIds.has(r.id) ? ' row--dropped' : ''}`} key={r.ffc ?? r.id}>
                    <span><span className="slot-tag">R{r.round}</span> {r.name}</span>
                    <span className="r r--mut">{r.pos}</span>
                  </div>
                ))}
                <div className="row"><span>Results</span><span className="r r--mut">Tuesday morning &middot; drop-worst applies at settle</span></div>
              </div>
            </>
          ) : (
            <p className="mod-lede">
              This week locked before your room finished, so there is no roster to
              score. The next rooms open Tuesday morning.
            </p>
          )}
        </section>
      </Shell>
    );
  }

  // ---- DRAFTING: the room is live -----------------------------------------
  if (state === 'drafting') {
    return (
      <Shell>
        <section className="mod mod--entered">
          <h2 className="eyebrow">Your room is open</h2>
          <p className="mod-lede">
            You are drafting from pick {draft?.pick_position}. The clock only runs while
            you are in the room - pick up where you left off.
          </p>
          <a className="btn btn--volt" href={`/sim/draft/${draft.id}`}>Back to the room &rarr;</a>
        </section>
        <Rules contest={contest} />
      </Shell>
    );
  }

  // ---- WAITING: drafted, not yet locked -----------------------------------
  if (state === 'waiting') {
    const roster = entry?.meta?.roster ?? [];
    return (
      <Shell>
        <section className="mod mod--entered">
          <h2 className="eyebrow">Week {contest.week} <span className="ctx">- drafted</span></h2>
          <p className="mod-lede">
            {roster.length} picks in. There is nothing else to do - best ball sets
            your lineup for you.
          </p>
          <div>
            {roster.map((r) => (
              <div className="row" key={r.ffc ?? r.id}>
                <span><span className="slot-tag">R{r.round}</span> {r.name}</span>
                <span className="r r--mut">{r.pos}</span>
              </div>
            ))}
            <div className="row"><span>Locks</span><span className="r"><Stamp iso={contest.locks_at} /></span></div>
            <div className="row"><span>Results</span><span className="r r--mut">Tuesday morning</span></div>
          </div>
          {draft?.id && (
            <a className="ghost" href={`/sim/draft/${draft.id}`}>See the full draft board &rarr;</a>
          )}
          {/* A WAY OUT (relay 3b item 3). This card is where a drafted-and-
              waiting player lands, and until now the only link on it went
              DEEPER - back into the draft board they had already finished.
              Nothing pointed at the rest of the week, so /draft was a
              dead end for the whole stretch between drafting and lock. */}
          <a className="btn btn--volt" href="/games">Back to games &rarr;</a>
        </section>
      </Shell>
    );
  }

  // ---- RULES: the seat-select front door (relay 2a item 7) -----------------
  const reminderAt = new Date(new Date(contest.locks_at).getTime() - 3_600_000);
  return (
    <Shell>
      <header className="hdr">
        <span className="ed">The Draft &middot; Week {contest.week} &middot; ranked</span>
        <span className="clock">rooms lock <StandaloneDate iso={contest.locks_at} /></span>
      </header>
      <div className="yr">
        <h1>Week {contest.week}</h1>
        <div className="sub">
          Eight rounds. No bench. Same pool as The Weekly, drafted against a room of
          eleven. Your best six of eight count.
        </div>
      </div>
      <div className="warn">
        Pick a seat and it is your franchise for the week. Walk away and the seat
        drafts for itself at lock.
      </div>
      <div className="prog">
        <div className="rrow">
          {Array.from({ length: DRAFT_ROUNDS }, (_, i) => (
            <div key={i} className="pip">
              <span className="em">{i + 1}</span>
              <span className="dot">R{i + 1}</span>
            </div>
          ))}
        </div>
        <div className="cap">
          <span>0 of {DRAFT_ROUNDS} picked</span>
          <span>{DRAFT_CONFIG.clockSeconds}s a pick &middot; {DRAFT_CONFIG.teamsCount} seats &middot; PPR</span>
        </div>
      </div>

      <SeatSelect
        seats={seatOptions(DRAFT_CONFIG.teamsCount)}
        teamsCount={DRAFT_CONFIG.teamsCount}
        rounds={DRAFT_ROUNDS}
        clockSeconds={DRAFT_CONFIG.clockSeconds}
        signedIn={userId != null}
        signinHref={shellSigninHref('/draft', isShell)}
        hasHandle={hasHandle}
      />

      {/* THE MOCK'S OWN TEXT, VERBATIM (item 7's own instruction). ONCE OPEN,
          THIS IS WHAT 'HOW IT WORKS' BECOMES (2a-polish item 1) - never the
          pitch's rules table above the board. */}
      <div className="perf">
        <b>How you are graded</b>
        <p>
          Two ways, both at settle. Your room: where your eight finish against the
          eleven bots you drafted with. The field: your points against everyone who
          drafted this week, and the best draft in the field is shown beside yours.
          There is no solver ceiling here - the best eight in the pool cannot sit on
          one roster, and the room reacts to what you take.
        </p>
      </div>
      <div className="mathline">
        Alerts: rooms open <Stamp iso={contest.opens_at} /> &middot; one hour to lock <Stamp iso={reminderAt.toISOString()} />
        {contest.settles_at && <> &middot; graded <Stamp iso={contest.settles_at} /></>}. All on.
      </div>
    </Shell>
  );
}
