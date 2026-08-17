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
import { gamesLobby } from '@/lib/games/read';
import { normalizePane, PANES, PANE_LABEL } from '@/lib/games/lobby';
import { tierClass } from '@/lib/daily/reveal';
import './games.css';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'The Games - Sportsvyn',
  description: 'Game day, every day. One account. One handle. Every board.',
};

export async function generateViewport({ searchParams }) {
  return simViewport(await resolveShellMode((await searchParams) ?? {}));
}

// Emoji are correct HERE and wrong on the game surfaces themselves. v1.2 s7
// counts them among what makes the app feel alive, and the mocks use them in
// exactly one place: chrome. A lobby card is chrome.
const ICON = { daily: '🗓', pickem: '✅', weekly: '📋', draft: '🎯' };

export default async function GamesPage({ searchParams }) {
  const sp = (await searchParams) ?? {};
  const pane = normalizePane(sp.pane);
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const v = await gamesLobby(userId).catch(() => null);

  const href = (p) => (p === 'games' ? '/games' : `/games?pane=${p}`);

  return (
    <>
      <GlobalHeaderServer activeNav="games" />
      <main className="lob" data-surface="ink">

        <header className="lob-head">
          <h1 className="lob-title">Game day, every day.</h1>
          <p className="lob-sub">One account. One handle. Every board.</p>
        </header>

        <nav className="ptabs" aria-label="Games sections">
          {PANES.map((p) => (
            <a key={p} href={href(p)} className={`pt${p === pane ? ' pt--on' : ''}`}>
              {PANE_LABEL[p]}
            </a>
          ))}
        </nav>

        {!v && (
          <section className="mod">
            <p className="muted">The lobby is having a moment. Try again shortly.</p>
          </section>
        )}

        {v && pane === 'games' && <GamesPane v={v} />}
        {v && pane === 'leaderboards' && <BoardsPane v={v} />}
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

function GamesPane({ v }) {
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
            <span className="gicon" aria-hidden="true">{ICON[c.key]}</span>
            <span className="gname">{c.name}</span>
            <span className="gdesc">{c.blurb}</span>
            <span className={`gbtn${c.state === 'ghost' ? ' gbtn--ghost' : ''}`}>
              {c.state === 'ghost' ? c.opensLabel : (c.cta ?? 'Play')}
            </span>
            <span className="gfoot">{c.foot ?? c.closesLabel ?? ' '}</span>
          </a>
        ))}
      </div>

      <section className="mod">
        <div className="mod-head">
          <h2 className="eyebrow">Practice range</h2>
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

      {v.season && (
        <section className="mod">
          <div className="mod-head">
            <h2 className="eyebrow">
              Your season{v.season.handle ? ` — ${v.season.handle}` : ''}
            </h2>
            {v.seasonKey && <span className="pill">{v.seasonKey}</span>}
          </div>
          <div className="grid2">
            <div className="stat"><div className="eyebrow">Season pts</div><div className="n">{v.season.points}</div></div>
            <div className="stat"><div className="eyebrow">Streak</div><div className="n">{v.streak}</div></div>
            <div className="stat"><div className="eyebrow">Played</div><div className="n">{v.season.played}/{v.season.daysPlayable}</div></div>
            <div className="stat"><div className="eyebrow">Pick &rsquo;em</div><div className="n muted">&mdash;</div></div>
          </div>
        </section>
      )}
    </>
  );
}

function BoardsPane({ v }) {
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
          {b.state === 'live' ? (
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
          ) : (
            <div className="row"><span className="muted">{b.populatesLabel}</span></div>
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
          Latest answer{y.edition ? ` — Ed. ${y.edition}` : ''} · {y.date}
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
      <div className="lob-links">
        <a className="ghost" href={y.href}>The full board &rarr;</a>
        <a className="ghost" href={`${y.href}/card`}>Share card &rarr;</a>
      </div>
    </section>
  );
}

function HistoryPane({ v }) {
  return (
    <section className="mod">
      <div className="mod-head"><h2 className="eyebrow">Every edition</h2></div>
      <div>
        {v.history.map((h) => (
          <div className={`row${h.sealed ? ' row--sealed' : ''}`} key={h.date}>
            <span className="hist-ed">{h.label}</span>
            {h.sealed ? (
              <>
                {/* A sealed row proves a day EXISTS without saying anything
                    about it. No season, no week, no score - that is the whole
                    point of the row. */}
                <span className="muted">&mdash; sealed &mdash;</span>
                <span className="v muted">open</span>
              </>
            ) : (
              <>
                <span>{h.season} · Wk {h.week}</span>
                <span className="v">{h.top ? `${h.top.name} ${h.top.score}` : '—'}</span>
                <span className="muted">{h.perfect}</span>
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
