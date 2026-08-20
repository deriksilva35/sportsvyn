/**
 * /leagues/[id] - the league page. Contract: draftvyn-leagues-page-mock-v0_1
 * (frames 2 and 3), v1.2 grammar.
 *
 * MEMBERS get the dashboard: header (crumb, name, count, code chip, copy
 * link), the tab pill row in ratified calendar order, and per-tab panels -
 * the Daily's two boards today, ghost panels for everything not yet open.
 * Tab state rides the URL through lib/leagues/nav (the scoresNav law), so a
 * link can open a specific tab.
 *
 * NON-MEMBERS get frame 3: the sealed preview as a hero - name + member
 * count, one JOIN button, nothing else. No identities, no boards; the
 * preview pin extends to this route by test. Signed-out riders carry this
 * exact destination through the sign-in law.
 *
 * READERS UNCHANGED: everything renders through lib/leagues + the scoped
 * Daily readers; ad-hoc entry SQL on this page is forbidden by test.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import { resolveShellMode, simViewport } from '@/lib/shell/shell';
import { requireSignInInShell } from '@/lib/shell/signedOut';
import { shellSigninHref } from '@/lib/shell/signinHref';
import { leagueDetail, leaguePreview, leagueMemberIds } from '@/lib/leagues/core';
import { LEAGUE_TABS, parseLeagueTab, leagueHref } from '@/lib/leagues/nav';
import { lastRevealedDate, dayBoard, overall } from '@/lib/daily/boards';
import { tierClass } from '@/lib/daily/reveal';
import { CodeChip, CopyLinkButton, JoinLeagueButton } from '@/components/leagues/LeagueChrome';
import '../../games/games.css';
import '../leagues.css';

export const dynamic = 'force-dynamic';

export async function generateViewport({ searchParams }) {
  return simViewport(await resolveShellMode((await searchParams) ?? {}));
}

export async function generateMetadata({ params }) {
  const { id } = await params;
  const lg = await leaguePreview(Number(id)).catch(() => null);
  return { title: lg ? `${lg.name} - Leagues - Sportsvyn` : 'Leagues - Sportsvyn' };
}

// GHOST PANEL COPY - faithful to the block's dates; the mock's verbatim
// lines reconcile when the file lands (it never reached the droplet).
const GHOSTS = {
  pickem: { line: "Pick 'em opens Aug 27 - straight picks, every game, every week.", date: 'AUG 27' },
  weekly: { line: 'The Weekly locks Sep 10 - six slots, no clock. Your league board lights at first kickoff.', date: 'SEP 10' },
  draft: { line: 'The Draft locks Sep 10 - eight rounds, best ball, thirty-second clock.', date: 'SEP 10' },
  season: { line: 'The season rollup lands with the first settled week - every game, one table.', date: null },
};

export default async function LeaguePage({ params, searchParams }) {
  const { id } = await params;
  const leagueId = Number(id);
  if (!Number.isInteger(leagueId)) notFound();
  const sp = (await searchParams) ?? {};
  const tab = parseLeagueTab(sp);

  const session = await auth();
  const userId = session?.user?.id ?? null;
  const isShell = await resolveShellMode(sp);
  const dest = leagueHref(leagueId, tab);
  requireSignInInShell({ isShell, userId, dest });

  const uid = userId == null ? null : Number(userId);
  const league = uid == null ? null : await leagueDetail(leagueId, uid).catch(() => null);

  // ---- NON-MEMBER (or signed-out web): frame 3, the sealed preview -------
  if (!league) {
    const preview = await leaguePreview(leagueId).catch(() => null);
    if (!preview) notFound();
    return (
      <>
        <GlobalHeaderServer activeNav="games" />
        <main className="lob" data-surface="ink">
          <section className="mod mod--invite lg-hero">
            <div className="eyebrow">You&rsquo;re invited</div>
            <h1 className="lg-hero-name">{preview.name}</h1>
            <p className="muted">
              {preview.members} {preview.members === 1 ? 'member' : 'members'} &middot; The
              Daily &middot; Pick &rsquo;em &middot; The Weekly &middot; The Draft
            </p>
            {uid == null ? (
              <a className="lg-join-primary" href={shellSigninHref(dest, isShell)}>Sign in to join</a>
            ) : (
              <JoinLeagueButton leagueId={leagueId} />
            )}
            <p className="muted lg-hero-sub">
              Boards are members-only. Join and tonight&rsquo;s Daily counts.
            </p>
          </section>
        </main>
        <SiteFooter />
      </>
    );
  }

  // ---- MEMBER: frame 2 ----------------------------------------------------
  const memberIds = await leagueMemberIds(leagueId).catch(() => []);
  const revealedDate = tab === 'daily' ? await lastRevealedDate().catch(() => null) : null;
  const [daily, season] = tab === 'daily'
    ? await Promise.all([
      revealedDate ? dayBoard(revealedDate, uid, 10, { memberIds }).catch(() => null) : null,
      overall(uid, 10, null, { memberIds }).catch(() => null),
    ])
    : [null, null];

  return (
    <>
      <GlobalHeaderServer activeNav="games" />
      <main className="lob" data-surface="ink">
        <Link className="appcrumb" href="/leagues">&larr; Leagues</Link>

        <header className="lg-head">
          <h1 className="lg-name">{league.name}</h1>
          <div className="lg-head-row">
            <span className="pill">{league.members.length} {league.members.length === 1 ? 'member' : 'members'}</span>
            <CodeChip code={league.join_code} />
            <CopyLinkButton code={league.join_code} />
          </div>
        </header>

        {/* The tab rail - calendar order, ratified. Ghost pills carry their
            dates in mono. Links, never <a>: soft nav is the law. */}
        <nav className="lg-tabs" aria-label="League sections">
          {LEAGUE_TABS.map((t) => (
            <Link
              key={t.key}
              href={leagueHref(leagueId, t.key)}
              className={`lg-tab${tab === t.key ? ' on' : ''}${t.ghost ? ' ghost' : ''}`}
              aria-current={tab === t.key ? 'page' : undefined}
            >
              {t.label}
              {t.ghost && t.date && <span className="lg-tab-date">{t.date}</span>}
            </Link>
          ))}
        </nav>

        {tab === 'daily' && (
          <>
            <section className="mod">
              <div className="mod-head">
                <h2 className="eyebrow">
                  The Daily &mdash; latest board
                  {daily && <span className="ctx"> &middot; {daily.date} &middot; perfect {daily.perfect ?? '—'}</span>}
                </h2>
              </div>
              {daily?.top?.length ? (
                daily.top.map((r, i) => (
                  <div className={`row${i === 0 ? ' row--lead' : ''}${r.userId === uid ? ' row--me' : ''}`} key={r.userId}>
                    <span className="lb-left">
                      <span className="rank">{r.rank ?? '—'}</span>
                      <span className={r.userId === uid ? 'volt' : ''}>{r.name}</span>
                      {r.tier && <span className={`badge ${tierClass(r.tier)}`}>{r.tier}</span>}
                    </span>
                    <span className="v">{r.dnf ? <span className="muted">dnf</span> : r.score}</span>
                  </div>
                ))
              ) : (
                <div className="row">
                  <span className="muted">Fills as members play &middot; reveals at midnight ET</span>
                </div>
              )}
              <Link className="ghost" href="/daily">Play today&rsquo;s Daily &rarr;</Link>
            </section>

            <section className="mod">
              <div className="mod-head">
                <h2 className="eyebrow">
                  Daily season
                  {season?.through && <span className="ctx"> &middot; through {season.through}</span>}
                </h2>
              </div>
              {season?.top?.length ? (
                season.top.map((r, i) => (
                  <div className={`row${i === 0 ? ' row--lead' : ''}${r.userId === uid ? ' row--me' : ''}`} key={r.userId}>
                    <span className="lb-left">
                      <span className="rank">{r.rank}</span>
                      <span className={r.userId === uid ? 'volt' : ''}>{r.name}</span>
                    </span>
                    <span className="v">{r.points} <span className="muted">pts</span></span>
                  </div>
                ))
              ) : (
                <div className="row">
                  <span className="muted">Fills as members play &middot; reveals at midnight ET</span>
                </div>
              )}
            </section>
          </>
        )}

        {tab !== 'daily' && (
          <section className="mod lg-ghost">
            <div className="mod-head">
              <h2 className="eyebrow">{LEAGUE_TABS.find((t) => t.key === tab)?.label}</h2>
              {GHOSTS[tab]?.date && <span className="pill">{GHOSTS[tab].date}</span>}
            </div>
            <div className="row"><span className="muted">{GHOSTS[tab]?.line}</span></div>
          </section>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
