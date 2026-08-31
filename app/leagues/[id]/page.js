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
import { firstLockLabel, FIRST_LOCK_FALLBACK } from '@/lib/pickem/read';
import { lastRevealedDate, dayBoard, overall } from '@/lib/daily/boards';
import { CodeChip, CopyLinkButton, JoinLeagueButton } from '@/components/leagues/LeagueChrome';
import SeasonBoard from '@/components/games/SeasonBoard';
import '../../games/games.css';
import '../leagues.css';

export const dynamic = 'force-dynamic';

export async function generateViewport() {
  return simViewport(await resolveShellMode());
}

export async function generateMetadata({ params }) {
  const { id } = await params;
  const lg = await leaguePreview(Number(id)).catch(() => null);
  return { title: lg ? `${lg.name} - Leagues - Sportsvyn` : 'Leagues - Sportsvyn' };
}

// GHOST PANEL COPY - verbatim from mock v0_1 (the file landed; reconciled),
// EXCEPT Pick'em's when-line: the mock's hardcoded Thursday was wrong (no
// game exists that day) and died with the first-kickoff ruling. It is filled
// per-request from the contest's snapshotted locks_at via firstLockLabel().
const GHOSTS = {
  pickem: { big: "Pick'em lights up with the board", when: null },
  weekly: { big: 'The Weekly board lights up at first kickoff', when: 'Thu Sep 10' },
  draft: { big: 'The Draft settles here after first kickoff', when: 'draft opens Sep 8 · locks Wed Sep 9, 8:20 PM ET' },
  season: { big: 'Cross-game standings arrive with the season', when: 'every game, one ladder' },
};

export default async function LeaguePage({ params, searchParams }) {
  const { id } = await params;
  const leagueId = Number(id);
  if (!Number.isInteger(leagueId)) notFound();
  const sp = (await searchParams) ?? {};
  const tab = parseLeagueTab(sp);

  const session = await auth();
  const userId = session?.user?.id ?? null;
  const isShell = await resolveShellMode();
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
          <Link className="appcrumb" href="/leagues">&larr; Leagues</Link>
          <section className="lg-preview-hero">
            <div className="eb">You&rsquo;re invited</div>
            <h1 className="lg-hero-name">{preview.name}</h1>
            <p className="ctx">
              {preview.members} {preview.members === 1 ? 'member' : 'members'} &middot; The
              Daily, Pick&rsquo;em, The Weekly, The Draft
            </p>
            {uid == null ? (
              <a className="lg-join-primary" href={shellSigninHref(dest, isShell)}>Sign in to join</a>
            ) : (
              <JoinLeagueButton leagueId={leagueId} name={preview.name} />
            )}
          </section>
          <p className="muted lg-hero-sub">
            Boards are members-only. Join and tonight&rsquo;s Daily counts.
          </p>
        </main>
        <SiteFooter />
      </>
    );
  }

  // ---- MEMBER: frame 2 ----------------------------------------------------
  const memberIds = await leagueMemberIds(leagueId).catch(() => []);
  // Pick'em's lock line, derived from the contest when a board exists -
  // caught to the sanctioned fallback like every ghost read.
  const pickemLock = await firstLockLabel().catch(() => FIRST_LOCK_FALLBACK);
  const pickemLockDate = pickemLock.replace(/^\w+ /, '').split(',')[0];
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
          <div className="lg-titlerow">
            <h1 className="lg-name">{league.name}</h1>
            <span className="memberpill">{league.members.length} {league.members.length === 1 ? 'member' : 'members'}</span>
          </div>
          <div className="lg-meta">
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
              {t.ghost && t.date && (
                <span className="lg-tab-date">{t.key === 'pickem' ? pickemLockDate : t.date}</span>
              )}
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
                  <div className={`row${i === 0 ? ' row--lead' : ''}`} key={r.userId}>
                    <span className="lb-left">
                      <span className="rank">{r.rank ?? '—'}</span>
                      <span className={r.userId === uid ? 'volt' : ''}>{r.name}</span>
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
                // The SAME season board the lobby renders, member-scoped: a
                // 2-member league gets a 2-card podium, never a ghost third
                // (one definition, both scopes - pinned).
                <SeasonBoard table={season} userId={uid} />
              ) : (
                <div className="row">
                  <span className="muted">Fills as members play &middot; reveals at midnight ET</span>
                </div>
              )}
            </section>
          </>
        )}

        {tab !== 'daily' && (
          <section className="lg-ghostpanel">
            <div className="big">{GHOSTS[tab]?.big}</div>
            <div className="when">{tab === 'pickem' ? `first lock · ${pickemLock}` : GHOSTS[tab]?.when}</div>
          </section>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
