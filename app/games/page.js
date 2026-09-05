/**
 * /games — the arcade's front door, and the app's Games tab through the shell.
 *
 * ONE SURFACE, TWO DOORS. The homepage is the publication's door and keeps the
 * Daily module and yesterday strip; this is the arcade's. Per app mock v0.2 the
 * same lobby renders as the native Games tab, so it is built once here rather
 * than twice.
 *
 * PANES ARE URL PARAMS, NOT AN ISLAND. ?pane=leaderboards renders server-side
 * complete, which buys three things a client island would not: no hydration and
 * no layout shift, a shareable link to any pane, and - the reason that decided
 * it - each pane's payload can be fetched and leak-tested independently. The
 * cost is a navigation per tab, which on four static panes is the right trade.
 *
 * THE STANDINGS LAW APPLIES TO EVERY NUMBER HERE. See lib/games/read.js: every
 * figure comes from a revealed day or a settled contest, with the single
 * exception of the viewer's own state in the game they are playing.
 */

import { auth } from '@/auth';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import { resolveShellMode, simViewport } from '@/lib/shell/shell';
import { requireSignInInShell } from '@/lib/shell/signedOut';
import { gamesLobby } from '@/lib/games/read';
import { myLeagues } from '@/lib/leagues/core';
import { normalizePane } from '@/lib/games/lobby';
import PaneTabs from '@/components/games/PaneTabs';
import { Hook, MetaChips, Pulse } from '@/components/games/chrome';
import SeasonBoard from '@/components/games/SeasonBoard';
import { tierClass } from '@/lib/daily/reveal';
import './games.css';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'The Games - Sportsvyn',
  description: 'Game day, every day. One account. One handle. Every board.',
};

export async function generateViewport() {
  return simViewport(await resolveShellMode());
}

// The emoji icons retired with the legibility pass: the mock's ghost
// numeral (gnum) carries the card's identity now, and the words do the
// selling.

export default async function GamesPage({ searchParams }) {
  const sp = (await searchParams) ?? {};
  const pane = normalizePane(sp.pane);
  const session = await auth();
  const userId = session?.user?.id ?? null;
  // GAMES WAS THE ODD ONE: no signed-out branch at all, so a stranger in the
  // container got the lobby - four cards, none of them playable. Same rule.
  requireSignInInShell({ isShell: await resolveShellMode(), userId, dest: '/games' });
  const v = await gamesLobby(userId).catch(() => null);
  // YOUR LEAGUES (v0.2 door): the member's leagues on the lobby, or the
  // create/join CTA when none. Caught to [] like every lobby read.
  const leagues = userId == null ? [] : await myLeagues(Number(userId)).catch(() => []);

  return (
    <>
      <GlobalHeaderServer activeNav="games" />
      <main className="lob" data-surface="ink">

        <header className="lob-head">
          <h1 className="lob-title">Game day, every day.</h1>
          <p className="lob-sub">One account. One handle. Every board.</p>
        </header>

        {/* A CLIENT SWITCHER OVER SERVER PANES. The panes remain URL params and
            remain server-rendered - that is what makes each one's payload
            independently leak-testable, and it is not negotiable. What changed
            is that these are next/link soft navigations rather than <a> tags,
            so the outgoing pane stays painted until the incoming one arrives
            instead of the browser tearing the document down between them. */}
        <PaneTabs pane={pane} />

        {!v && (
          <section className="mod">
            <p className="muted">The lobby is having a moment. Try again shortly.</p>
          </section>
        )}

        {v && pane === 'games' && <GamesPane v={v} leagues={leagues} signedIn={userId != null} />}
        {v && pane === 'leaderboards' && <BoardsPane v={v} userId={userId} />}
        {v && pane === 'answer' && <AnswerPane v={v} />}
        {v && pane === 'history' && <HistoryPane v={v} />}

        <p className="lob-foot">
          One account · one handle · one leaderboard spine. Pick &rsquo;em and The Weekly settle
          on real games; the Daily settles on history. Not affiliated with the NFL.
          nflverse data CC-BY-4.0.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}

function GamesPane({ v, leagues = [], signedIn = false }) {
  return (
    <>
      <div className="ggrid">
        {v.cards.map((c) => (
          <a
            key={c.key}
            className={`gcard${c.state !== 'ghost' ? ' gcard--live' : ''}`}
            href={c.state === 'ghost' ? '/games' : c.href}
            aria-disabled={c.state === 'ghost' ? 'true' : undefined}
          >
            <span className="gnum" aria-hidden="true">{c.num}</span>
            <span className="gtoprow">
              <span className="gname">{c.name}</span>
              {/* Status chip: volt for the playable game, jade NEW for
                  Pick 'em pre-first-settle. Flip-on-open law untouched -
                  the chip reads state, never the clock. */}
              {c.key === 'daily' && c.state !== 'ghost' && <span className="gchip gchip--hot">Play now</span>}
              {c.key === 'pickem' && (
                <span className="gchip gchip--new">{c.state === 'ghost' ? 'New · opens Aug 25' : 'New'}</span>
              )}
            </span>
            <Hook text={c.hook} />
            <MetaChips chips={c.chips} />
            <span className="gcardfoot">
              <Pulse>
                {c.key === 'daily' && (
                  <><b>{c.pulse?.playing ?? 0} playing</b>{c.pulse?.perfect != null && <> &middot; yesterday&rsquo;s perfect {c.pulse.perfect}</>}</>
                )}
                {c.key === 'pickem' && (c.pulse
                  ? <>Board {c.pulse.boardNumber} &middot; <b>{c.pulse.games} games</b>{c.pulse.next && <> &middot; locks {c.pulse.next}</>}</>
                  : <>New board coming</>)}
                {c.key === 'weekly' && (c.state === 'ghost'
                  ? <>Season opens with <b>Week 1</b></>
                  : (c.closesLabel ?? ' '))}
                {c.key === 'draft' && <>One ranked entry per week</>}
              </Pulse>
              <span className={`gbtn${c.state === 'ghost' ? ' gbtn--ghost' : ''}`}>
                {c.state === 'ghost' ? c.opensLabel : (c.cta ?? 'Play')}
              </span>
            </span>
          </a>
        ))}
      </div>

      <section className="mod">
        <div className="mod-head">
          <h2 className="eyebrow">Mock drafts</h2>
          <span className="pill">Unranked · unlimited</span>
        </div>
        <div className="row">
          <span>
            Full mock drafts against the same AI rooms The Draft uses. No clock,
            graded on live ADP.
          </span>
        </div>
        <a className="ghost" href="/sim">Start a mock &rarr;</a>
      </section>

      {/* YOUR LEAGUES - the door to the social spine. Lists the member's
          leagues; a signed-in reader with none gets the one-line pitch and
          the same route. Signed-out readers see nothing here - the lobby
          pitch machinery already owns that conversation. */}
      {signedIn && (
        <section className="mod">
          <div className="mod-head">
            <h2 className="eyebrow">Your leagues</h2>
            {leagues.length > 0 && <span className="pill">{leagues.length}</span>}
          </div>
          {leagues.length === 0 ? (
            <div className="row">
              <span className="muted">
                Your people, one board - create a league and share the code.
              </span>
            </div>
          ) : (
            leagues.map((lg) => (
              <div className="row" key={lg.id}>
                <span>{lg.name}</span>
                <span className="v muted">{lg.members} {lg.members === 1 ? 'member' : 'members'}</span>
              </div>
            ))
          )}
          <a className="ghost" href="/leagues">
            {leagues.length === 0 ? 'Start a league →' : 'Open your leagues →'}
          </a>
        </section>
      )}

      {/* GATED ON THE RECORD ITSELF, not on v.season. seasonStrip() returns
          null until the reader has a STANDING, so gating on it hid the whole
          module from exactly the readers it is most useful to: anyone who has
          played a day or two and has no ranked position yet. The record exists
          the moment a revealed day does. */}
      <YourStats v={v} />
    </>
  );
}

function BoardsPane({ v, userId = null }) {
  return (
    <>
      {v.boards.map((b) => (
        <section className="mod" key={b.key}>
          <div className="mod-head">
            <h2 className="eyebrow">{b.name}</h2>
            {b.state === 'live' && b.table?.through && (
              <span className="pill">through {b.table.through}</span>
            )}
          </div>
          {b.state !== 'live' ? (
            <div className="row"><span className="muted">{b.populatesLabel}</span></div>
          ) : b.key === 'overall' ? (
            // Frame 3: the Daily season board is a prize, not a table -
            // podium, movement, the viewer pinned. One component, shared
            // with the league scope.
            <SeasonBoard table={b.table} userId={userId} />
          ) : b.key === 'pickem' ? (
            // ACCURACY, NOT POINTS. A dash rank + note replaces a number for
            // anyone under the minimum-boards floor - never simply absent.
            <div>
              {b.table.top.map((r) => (
                <div className="row" key={r.userId}>
                  <span className="lb-left"><span className="rank">{r.rank ?? '-'}</span>{r.name}</span>
                  <span className="v">
                    {r.note ?? <>{r.pct}% <span className="muted">({r.correct}/{r.played})</span></>}
                  </span>
                </div>
              ))}
              {b.table.self && (
                <div className="row row--me">
                  <span className="lb-left"><span className="rank">{b.table.self.rank ?? '-'}</span>{b.table.self.name}</span>
                  <span className="v">
                    {b.table.self.note ?? <>{b.table.self.pct}% <span className="muted">({b.table.self.correct}/{b.table.self.played})</span></>}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div>
              {b.table.top.map((r) => (
                <div className="row" key={r.userId}>
                  <span className="lb-left"><span className="rank">{r.rank}</span>{r.name}</span>
                  <span className="v">{r.points} <span className="muted">pts</span></span>
                </div>
              ))}
              {b.table.self && (
                <div className="row row--me">
                  <span className="lb-left"><span className="rank">{b.table.self.rank}</span>{b.table.self.name}</span>
                  <span className="v">{b.table.self.points} <span className="muted">pts</span></span>
                </div>
              )}
            </div>
          )}
        </section>
      ))}
    </>
  );
}

function AnswerPane({ v }) {
  const y = v.yesterday;
  if (!y) {
    return (
      <section className="mod">
        <div className="row"><span className="muted">No day has revealed yet.</span></div>
      </section>
    );
  }
  return (
    <section className="mod">
      <div className="mod-head">
        <h2 className="eyebrow">
          Latest answer{y.edition ? ` - Ed. ${y.edition}` : ''} · {y.date}
        </h2>
      </div>
      <div className="ans">{y.season} <span className="muted">· Week {y.week}</span></div>
      <div>
        <div className="row"><span>Perfect lineup</span><span className="v volt">{y.perfect}</span></div>
        {y.played && (
          <div className="row">
            <span>You</span>
            <span className="v">
              {y.score}
              {y.tier && <span className={`badge ${tierClass(y.tier)}`}>{y.tier}</span>}
              {y.pct != null && <span className="muted"> {y.pct}%</span>}
            </span>
          </div>
        )}
        {y.winner && (
          <div className="row">
            <span>Top score</span>
            <span className="v">{y.winner.name} · {y.winner.score}</span>
          </div>
        )}
      </div>
      {/* ONE LINK, AND IT GOES TO THE REVEAL. This used to offer "Share card →"
          pointing at /daily/[date]/card, which is a 1080x1920 PNG from next/og -
          a reader who tapped it landed on a bare image with no chrome, no
          breadcrumb and no way back. The card is for unfurls and texts, which is
          a job it does without anyone visiting it directly; the reveal carries
          the same content in DOM, plus the board and a way out. The card stays
          reachable from there as an action. */}
      <div className="lob-links">
        <a className="ghost" href={y.href}>The full board &rarr;</a>
      </div>
    </section>
  );
}

/**
 * YOUR RECORD - through revealed days only, INCLUDING your own open day.
 *
 * Every other surface lets the reader see their own in-flight result, because
 * it is theirs. These are standings: a number that moved when you locked this
 * morning would disagree with the leaderboard one pane away, and "played 12/11"
 * reads as the page being unable to count. See lib/games/personal.js.
 */
function YourStats({ v }) {
  const s = v.stats;
  if (!s) return null;
  const tiers = Object.entries(s.tiers).filter(([, n]) => n > 0);
  return (
    <section className="mod">
      <div className="mod-head">
        <h2 className="eyebrow">
          Your record{v.season?.handle ? ` - ${v.season.handle}` : ''}
        </h2>
        {v.seasonKey && <span className="pill">{v.seasonKey}</span>}
      </div>

      <div className="grid2">
        <div className="stat"><div className="eyebrow">Played</div><div className="n">{s.played}/{s.playable}</div></div>
        <div className="stat">
          <div className="eyebrow">Avg of perfect</div>
          <div className="n">{s.avgPct != null ? `${s.avgPct}%` : <span className="muted">-</span>}</div>
        </div>
        <div className="stat"><div className="eyebrow">Season pts</div><div className="n">{v.season?.points ?? 0}</div></div>
        <div className="stat"><div className="eyebrow">Streak</div><div className="n">{s.streak}</div></div>
      </div>

      <div>
        <div className="row">
          <span>Best score</span>
          <span className="v">
            {s.best
              ? <>{s.best.score}{s.best.edition && <span className="muted"> · Ed. {s.best.edition}</span>}</>
              : <span className="muted">-</span>}
          </span>
        </div>
        <div className="row">
          <span>Guesses</span>
          <span className="v">
            {s.guess.guessed === 0
              ? <span className="muted">none yet</span>
              : (
                <>
                  {s.guess.exact} exact
                  <span className="muted"> · {s.guess.seasonRight} season only · {s.guess.missed} missed</span>
                </>
              )}
          </span>
        </div>
        {/* Tiers with a zero count are ABSENT rather than shown as 0. A row of
            empty badges reads as a scorecard of failures; the ones you earned
            read as a collection. */}
        {tiers.length > 0 && (
          <div className="row">
            <span>Tiers</span>
            <span className="v tierline">
              {tiers.map(([label, n]) => (
                <span className={`badge ${tierClass(label)}`} key={label}>{label} ×{n}</span>
              ))}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

function HistoryPane({ v }) {
  // The column only exists when there is a reader to own it. Driven by the
  // presence of `you` on the rows themselves, not by a separate flag, so the
  // header and the cells cannot disagree about whether the column is there.
  const hasYou = v.history.some((h) => h.you !== undefined);
  return (
    <section className="mod">
      <div className="mod-head">
        <h2 className="eyebrow">Every edition</h2>
        {hasYou && <span className="pill">Your score, revealed days</span>}
      </div>
      <div>
        {v.history.map((h) => {
          const inner = h.sealed ? (
            <>
              {/* A sealed row proves a day EXISTS without saying anything
                  about it. No season, no week, no score - that is the whole
                  point of the row. */}
              <span className="muted">- sealed -</span>
              <span className="v muted">open</span>
            </>
          ) : (
            <>
              {/* NOWRAP AS A CLASS, not a hope: "2018 · Wk 10" was breaking
                  across three lines in a cramped left column while the row had
                  free width. The id block (edition + era) stacks cleanly; the
                  era line never breaks mid-token. */}
              <span className="hist-when">{h.season} · Wk {h.week}</span>
              <span className="v hist-win">{h.top ? `${h.top.name} ${h.top.score}` : '-'}</span>
              <span className="muted">{h.perfect}</span>
              {h.you !== undefined && (
                <span className="hist-you">
                  {h.you.played ? (
                    <>
                      {h.you.score}
                      {h.you.tier && <span className={`badge ${tierClass(h.you.tier)}`}>{h.you.tier}</span>}
                    </>
                  ) : <span className="muted">-</span>}
                </span>
              )}
            </>
          );
          // A SEALED ROW IS NOT A LINK. There is nothing at the other end yet,
          // and a link to a page that redirects back is worse than no link.
          return h.sealed
            ? <div className="row row--sealed" key={h.date}><span className="hist-ed">{h.label}</span>{inner}</div>
            : (
              <a className="row row--hist row--link" key={h.date} href={h.href}>
                <span className="hist-ed">{h.label}</span>{inner}
              </a>
            );
        })}
      </div>
    </section>
  );
}
