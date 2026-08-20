/**
 * /leagues - your leagues: create, join, and each league's Weekly board.
 *
 * THE CARD IS A DOOR, NOT A DASHBOARD (mock v0_1 frame 1): name, count,
 * code, and ONE headline - the latest revealed Daily leader among members.
 * The boards themselves live on /leagues/[id], where the tab rail holds
 * every game in calendar order.
 */

import { auth } from '@/auth';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import LeagueForms from '@/components/leagues/LeagueForms';
import { resolveShellMode, simViewport } from '@/lib/shell/shell';
import { requireSignInInShell } from '@/lib/shell/signedOut';
import { shellSigninHref } from '@/lib/shell/signinHref';
import { myLeagues, leagueMemberIds, leagueByCode } from '@/lib/leagues/core';
import JoinPrompt from '@/components/leagues/JoinPrompt';
import Link from 'next/link';
import { lastRevealedDate, dayBoard } from '@/lib/daily/boards';
import { leagueHref } from '@/lib/leagues/nav';
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
  // THE SHARE TARGET: /leagues?join=CODE is what actually rides a group chat.
  // The dest must CARRY the code through the sign-in law, or a signed-out
  // friend tapping the link would authenticate into a page that forgot why
  // they came.
  const joinRaw = Array.isArray(sp.join) ? sp.join[0] : sp.join;
  const joinDest = joinRaw ? `/leagues?join=${encodeURIComponent(joinRaw)}` : '/leagues';
  requireSignInInShell({ isShell, userId, dest: joinDest });

  const uid = userId == null ? null : Number(userId);
  const leagues = uid == null ? [] : await myLeagues(uid).catch(() => []);
  // The code-holder's preview: name + member count, never a null page. A dud
  // code renders a sentence, because a share target that 404s punishes the
  // FRIEND for the member's typo.
  const invite = joinRaw ? await leagueByCode(joinRaw).catch(() => null) : null;
  const alreadyIn = invite != null && leagues.some((l) => l.id === invite.id);

  // THE CARD IS A DOOR, NOT A DASHBOARD (mock v0_1 frame 1): one headline
  // per league - the latest revealed Daily leader among members, read through
  // the same scoped dayBoard, top row only. The boards themselves live on
  // /leagues/[id].
  const revealedDate = await lastRevealedDate().catch(() => null);
  const headlines = new Map();
  for (const lg of leagues) {
    const members = await leagueMemberIds(lg.id).catch(() => []);
    const board = revealedDate
      ? await dayBoard(revealedDate, uid, 1, { memberIds: members }).catch(() => null)
      : null;
    const lead = board?.top?.find((r) => !r.dnf) ?? null;
    headlines.set(lg.id, lead ? <>{lead.name} leads &middot; <b>{lead.score}</b></> : null);
  }

  return (
    <>
      <GlobalHeaderServer activeNav="games" />
      <main className="lob" data-surface="ink">
        <header className="lob-head">
          <h1 className="lob-title">Leagues</h1>
          <p className="lob-sub">Your people, one board. Share the code, own the season.</p>
        </header>

        {/* The invitation card leads whenever a code rides the URL - it is
            the whole reason this page load exists. */}
        {joinRaw && (
          <JoinPrompt
            invite={invite ? { name: invite.name, members: invite.members, code: invite.join_code } : null}
            signedIn={uid != null}
            alreadyIn={alreadyIn}
            signinHref={shellSigninHref(joinDest, isShell)}
          />
        )}

        {uid == null ? (
          <section className="mod">
            <p className="muted">
              A league is a board of just your people - every game, one code.
            </p>
            <a className="ghost" href={shellSigninHref(joinDest, isShell)}>Sign in to start one &rarr;</a>
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

            {leagues.map((lg) => (
              <Link className="lg-door" key={lg.id} href={leagueHref(lg.id)}>
                <div className="lg-door-top">
                  <span className="lg-door-name">{lg.name}</span>
                  <span className="memberpill">{lg.members} {lg.members === 1 ? 'member' : 'members'}</span>
                </div>
                <div className="lg-door-headline">
                  <span className="lbl">The Daily</span>
                  <span className="lead-line">{headlines.get(lg.id) ?? <span className="muted">fills as members play</span>}</span>
                </div>
                <div className="lg-door-go">
                  <span>Join code&nbsp; <span className="lg-code">{lg.join_code}</span></span>
                  <span className="arrow">Open &rarr;</span>
                </div>
              </Link>
            ))}
          </>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
