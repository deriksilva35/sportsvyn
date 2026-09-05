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
import { draftState, draftSettledView, seatOptions } from '@/lib/draft/view';
import { draftState as readDraftState } from '@/lib/draft/entry';
import { DRAFT_CONFIG, DRAFT_ROUNDS, nextDraftContest } from '@/lib/draft/contest';
import { tierClass } from '@/lib/daily/reveal';
import SeatSelect from '@/components/draft/SeatSelect';
import StandaloneDate from '@/components/StandaloneDate';
import '../daily/daily.css';
import './draft.css';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'The Draft - Sportsvyn',
  description: 'Eight rounds against the room. Best ball, one week.',
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
        <div className="row"><span>Drafts until</span><span className="r">{etStamp(contest?.locks_at) ?? 'First kickoff'}</span></div>
        <div className="row"><span>Results</span><span className="r">Tuesday morning</span></div>
      </div>
      <p className="muted">
        Best ball means you never set a lineup: your best six score automatically from
        what your players actually did. Every pick counts, so there is no bench to hide
        a miss on. One ranked draft a week &mdash; results land <b>Tuesday morning</b>,
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

  // ---- NO BOARD: the full pitch, per the /weekly ruling -------------------
  if (state === 'none') {
    const upcoming = await nextDraftContest().catch(() => null);
    return (
      <Shell>
        <section className="hero">
          <div className="hero-eyebrow">The Draft &middot; ranked</div>
          <div className="hero-q">Eight rounds.<br />No bench.</div>
          <p className="hero-line">
            Draft against the room &middot; <b>best ball</b> &middot; results Tuesday morning
          </p>
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

  // ---- SIGNED OUT: the pitch ----------------------------------------------
  if (userId == null) {
    return (
      <Shell>
        <section className="hero">
          <div className="hero-eyebrow">The Draft &middot; ranked</div>
          <div className="hero-q">Eight rounds.<br />No bench.</div>
          <p className="hero-line">
            {DRAFT_CONFIG.teamsCount} teams &middot; <b>{DRAFT_CONFIG.clockSeconds}s</b> a pick
            &middot; best ball &middot; results Tuesday morning
          </p>
          <a className="btn--volt" href={shellSigninHref('/draft', isShell)}>Take a seat</a>
        </section>
        <Rules contest={contest} />
      </Shell>
    );
  }

  // ---- SETTLED -------------------------------------------------------------
  if (state === 'settled') {
    const v = draftSettledView({ contest, entry, board: contest.board });
    return (
      <Shell>
        <section className="hero">
          <div className="hero-eyebrow">The Draft &middot; final</div>
          <div className="hero-q">{v.season} &middot; Week {v.week}</div>
          {v.you ? (
            <p className="hero-line">
              Your best six scored <b>{v.you.score}</b>
              {v.you.pct != null && <> &middot; {v.you.pct}% of perfect</>}
            </p>
          ) : (
            <p className="hero-line">
              {v.dnf ? 'No complete roster was in at kickoff.' : 'You sat this one out.'}
            </p>
          )}
        </section>

        {v.you && (
          <section className="mod mod--entered">
            <h2 className="eyebrow">Your draft <span className="ctx">&mdash; started six in bold</span></h2>
            <div className="score-row">
              <div className="score-big">{v.you.score}</div>
              <div className="score-meta">
                {v.you.tier && <span className={`tierbadge ${tierClass(v.you.tier)}`}>{v.you.tier}</span>}
                <span className="muted">perfect was {v.perfect}</span>
              </div>
            </div>
            <div>
              {/* THE BENCH IS SHOWN, and in best ball it is the interesting
                  part: those are the points your draft did not need. */}
              {v.roster.map((r) => (
                <div className={`row${r.started ? ' row--started' : ''}`} key={r.ffc ?? r.id}>
                  <span>
                    <span className="slot-tag">R{r.round}</span>{' '}
                    {r.name}<span className="muted"> · {r.pos}</span>
                  </span>
                  <span className="r">{r.points ?? '—'}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="mod">
          {/* THE CEILING IS A REAL ROOM'S ROSTER, NOT A DREAM TEAM (relay D1).
              Every Draft entrant gets a different eight, so unlike the
              Weekly there is no shared pool to build a theoretical lineup
              from - the ceiling is whoever's real roster scored highest,
              named by seat rather than shown as a picks list. */}
          <h2 className="eyebrow">The week&rsquo;s best roster <span className="ctx">&mdash; {v.perfect}</span></h2>
          <div className="row">
            <span className="muted">
              {v.ceilingSeat != null ? `Seat ${v.ceilingSeat} drafted it` : 'From one of this week’s rooms'}
            </span>
          </div>
        </section>
        <p className="muted">
          Settled from final box scores. A settled week is final &mdash; later stat
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
          <h2 className="eyebrow">Week {contest.week} <span className="ctx">&mdash; locked</span></h2>
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
            you are in the room &mdash; pick up where you left off.
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
          <h2 className="eyebrow">Week {contest.week} <span className="ctx">&mdash; drafted</span></h2>
          <p className="mod-lede">
            {roster.length} picks in. There is nothing else to do &mdash; best ball sets
            your lineup for you.
          </p>
          <div>
            {roster.map((r) => (
              <div className="row" key={r.ffc ?? r.id}>
                <span><span className="slot-tag">R{r.round}</span> {r.name}</span>
                <span className="r r--mut">{r.pos}</span>
              </div>
            ))}
            <div className="row"><span>Locks</span><span className="r">{etStamp(contest.locks_at)}</span></div>
            <div className="row"><span>Results</span><span className="r r--mut">Tuesday morning</span></div>
          </div>
          {draft?.id && (
            <a className="ghost" href={`/sim/draft/${draft.id}`}>See the full draft board &rarr;</a>
          )}
        </section>
      </Shell>
    );
  }

  // ---- RULES: the seat-select front door ----------------------------------
  return (
    <Shell>
      <section className="hero">
        <div className="hero-eyebrow">The Draft &middot; Week {contest.week}</div>
        <div className="hero-q">Eight rounds.<br />No bench.</div>
        <p className="hero-line">
          Best ball &middot; locks {etStamp(contest.locks_at)} &middot; results Tuesday morning
        </p>
      </section>
      <SeatSelect
        seats={seatOptions(DRAFT_CONFIG.teamsCount)}
        teamsCount={DRAFT_CONFIG.teamsCount}
        rounds={DRAFT_ROUNDS}
        clockSeconds={DRAFT_CONFIG.clockSeconds}
      />
      <Rules contest={contest} />
    </Shell>
  );
}
