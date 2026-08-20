/**
 * /leagues - your leagues: create, join, and each league's Weekly board.
 *
 * LAUNCH SCOPE (spec v0.2 cut line): create/join/member-list + the
 * WEEKLY-scoped board. Other game scopes and the season rollup fast-follow -
 * the Weekly is the game people join a league FOR on Sep 8.
 *
 * SEALED-UNTIL-LOCK INHERITS FOR FREE: the league board is weeklyBoardTable
 * with a member scope, and that function returns null pre-lock before it
 * reads a single entry - so a league page before Thursday shows WHO is in
 * (names are public to members) and no numbers, which is exactly the law.
 */

import { auth } from '@/auth';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import LeagueForms from '@/components/leagues/LeagueForms';
import { resolveShellMode, simViewport } from '@/lib/shell/shell';
import { requireSignInInShell } from '@/lib/shell/signedOut';
import { shellSigninHref } from '@/lib/shell/signinHref';
import { myLeagues, leagueMemberIds } from '@/lib/leagues/core';
import { currentContest } from '@/lib/weekly/entries';
import { weeklyBoardTable } from '@/lib/weekly/live';
import '../games/games.css';
import './leagues.css';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Leagues - Sportsvyn',
  description: 'Your people, one board. Create a league, share the code.',
};

export async function generateViewport({ searchParams }) {
  return simViewport(await resolveShellMode((await searchParams) ?? {}));
}

export default async function LeaguesPage({ searchParams }) {
  const sp = (await searchParams) ?? {};
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const isShell = await resolveShellMode(sp);
  requireSignInInShell({ isShell, userId, dest: '/leagues' });

  const uid = userId == null ? null : Number(userId);
  const leagues = uid == null ? [] : await myLeagues(uid).catch(() => []);
  const contest = await currentContest().catch(() => null);

  // One board read per league the reader is in - small N by construction.
  const boards = new Map();
  for (const lg of leagues) {
    const members = await leagueMemberIds(lg.id).catch(() => []);
    const table = await weeklyBoardTable(contest, uid, { memberIds: members }).catch(() => null);
    boards.set(lg.id, table);
  }

  return (
    <>
      <GlobalHeaderServer activeNav="games" />
      <main className="lob" data-surface="ink">
        <header className="lob-head">
          <h1 className="lob-title">Leagues</h1>
          <p className="lob-sub">Your people, one board. Share the code, own the season.</p>
        </header>

        {uid == null ? (
          <section className="mod">
            <p className="muted">
              A league is a board of just your people - every game, one code.
            </p>
            <a className="ghost" href={shellSigninHref('/leagues', isShell)}>Sign in to start one &rarr;</a>
          </section>
        ) : (
          <>
            <LeagueForms />

            {leagues.length === 0 && (
              <section className="mod">
                <p className="muted">
                  No leagues yet. Create one and drop the code in your group
                  chat - whoever joins is on your board.
                </p>
              </section>
            )}

            {leagues.map((lg) => {
              const table = boards.get(lg.id);
              return (
                <section className="mod" key={lg.id}>
                  <div className="mod-head">
                    <h2 className="eyebrow">{lg.name}</h2>
                    <span className="pill">{lg.members} {lg.members === 1 ? 'member' : 'members'}</span>
                  </div>
                  {/* The code IS the invitation - shown to members, mono so it
                      reads unambiguously off a phone screen in a group chat. */}
                  <div className="row">
                    <span className="muted">Join code</span>
                    <span className="v lg-code">{lg.join_code}</span>
                  </div>
                  {table ? (
                    <div>
                      <div className="row"><span className="muted">The Weekly</span><span className="muted">{table.through}</span></div>
                      {table.top.map((r) => (
                        <div className={`row${r.userId === uid ? ' row--me' : ''}`} key={r.userId}>
                          <span className="lb-left"><span className="rank">{r.rank}</span>{r.name}</span>
                          <span className="v">{r.points} <span className="muted">pts</span></span>
                        </div>
                      ))}
                      {table.self && (
                        <div className="row row--me">
                          <span className="lb-left"><span className="rank">{table.self.rank}</span>{table.self.name}</span>
                          <span className="v">{table.self.points} <span className="muted">pts</span></span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="row">
                      <span className="muted">
                        The Weekly board lights up at first kickoff &middot; Sep 10
                      </span>
                    </div>
                  )}
                </section>
              );
            })}
          </>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
