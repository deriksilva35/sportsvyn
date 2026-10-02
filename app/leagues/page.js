/**
 * /leagues - YOUR LEAGUES (canvas "Leagues V1", board Main): CREATE A LEAGUE and
 * JOIN WITH CODE, then one card per league - its name, its games, how long and
 * which format, and a foot line (members, live or when it starts).
 *
 * THE INVITED CARD leads whenever a code rides the URL (?join=CODE - the share
 * link every league printed before /j/ existed, still in group chats). It is a
 * preview: lib/leagues/invite.js invitePreview() never writes, and the JOIN tap
 * is a server action. A dud code is a sentence, never a 404 - a dead link
 * punishes the friend for the member's typo.
 *
 * P2 puts the reader's place in each card's corner; until standings exist the
 * corner says whose league it is.
 */

import { auth } from '@/auth';
import Link from 'next/link';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import { resolveShellMode, simViewport } from '@/lib/shell/shell';
import { requireSignInInShell } from '@/lib/shell/signedOut';
import { shellSigninHref } from '@/lib/shell/signinHref';
import { myLeagues } from '@/lib/leagues/core';
import { invitePreview } from '@/lib/leagues/invite';
import { REFUSALS } from '@/lib/leagues/code';
import { leagueChips } from '@/lib/leagues/settings';
import { cardMeta, hasStarted, inviteLine } from '@/lib/leagues/describe';
import { leagueHref } from '@/lib/leagues/nav';
import { LeagueActions, InvitedCard } from '@/components/leagues/LeaguesHome';
import './leaguesV1.css';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Leagues - Sportsvyn',
  description: 'Play the games with your people. Free, always.',
};

export async function generateViewport() {
  return simViewport(await resolveShellMode());
}

export default async function LeaguesPage({ searchParams }) {
  const sp = (await searchParams) ?? {};
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const isShell = await resolveShellMode();
  // THE SHARE TARGET: /leagues?join=CODE. The dest must CARRY the code through
  // the sign-in law, or a signed-out friend tapping the link would authenticate
  // into a page that forgot why they came.
  const joinRaw = Array.isArray(sp.join) ? sp.join[0] : sp.join;
  const joinDest = joinRaw ? `/leagues?join=${encodeURIComponent(joinRaw)}` : '/leagues';
  requireSignInInShell({ isShell, userId, dest: joinDest });

  const uid = userId == null ? null : Number(userId);
  const leagues = uid == null ? [] : await myLeagues(uid).catch(() => []);
  const invite = joinRaw ? await invitePreview(joinRaw, uid).catch(() => null) : null;
  const now = new Date();

  return (
    <>
      <GlobalHeaderServer activeNav="leagues" />
      <main className="lv" data-surface="ink">
        <header className="lv-head">
          <h1 className="lv-title">Leagues</h1>
          <p className="lv-sub">Play the games with your people. Free, always.</p>
        </header>

        {uid == null ? (
          <div className="lv-actions">
            <a className="lv-btn lv-btn--primary" href={shellSigninHref(joinDest, isShell)}>Sign in to start one</a>
          </div>
        ) : (
          <LeagueActions />
        )}

        {uid != null && (
          <>
            <p className="lv-kicker">Your leagues &middot; {leagues.length}</p>
            {leagues.length === 0 ? (
              <p className="lv-empty">
                No leagues yet. Create one and drop the link in your group chat - whoever joins is on your board.
              </p>
            ) : (
              <div className="lv-list">
                {leagues.map((lg, i) => {
                  const live = hasStarted(lg, now);
                  return (
                    <Link className={`lv-card${i === 0 ? ' lv-card--lead' : ''}`} key={lg.id} href={leagueHref(lg.id)} data-league-card={lg.id}>
                      <div className="lv-card-top">
                        <span className="lv-card-name">{lg.name}</span>
                        {live && <span className="lv-chip lv-chip--live">Live</span>}
                      </div>
                      <div className="lv-chips">
                        {leagueChips(lg).map((c) => <span className="lv-chip" key={c}>{c}</span>)}
                      </div>
                      <div className="lv-card-foot">
                        <span className="lv-card-meta">{cardMeta(lg, now)}</span>
                        <span className="lv-card-you">{lg.mine ? 'Your league' : "You're in"}</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* The invitation - after your own leagues, as the canvas draws it. */}
        {joinRaw && (
          invite?.league ? (
            uid == null ? (
              <section className="lv-invited" aria-label="Invited">
                <span className="lv-kicker" style={{ padding: 0 }}>Invited</span>
                <p className="lv-invited-name"><b>{invite.league.name}</b>, {inviteLine(invite.league)}</p>
                <a className="lv-btn lv-btn--primary" href={shellSigninHref(joinDest, isShell)}>Sign in to join</a>
              </section>
            ) : (
              <InvitedCard
                inviteKey={joinRaw}
                name={invite.league.name}
                line={inviteLine(invite.league)}
                already={invite.already}
                leagueId={invite.league.id}
                refusal={invite.reason && !invite.already ? REFUSALS[invite.reason] ?? REFUSALS.failed : null}
              />
            )
          ) : (
            <section className="lv-invited" aria-label="Invited">
              <p className="lv-refusal">
                {REFUSALS[invite?.reason] ?? REFUSALS.no_league}. Ask for a fresh link.
              </p>
            </section>
          )
        )}
      </main>
      <SiteFooter />
    </>
  );
}
