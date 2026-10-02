/**
 * /j/<key> - THE LEAGUE INVITE LINK (Leagues V1, fri-1). <key> is the link
 * token the share sheet hands out (twelve characters) or the six-character
 * code; lib/leagues/code.js parseInviteKey() tells them apart. The Apple
 * app-site-association claims /j/* (lib/aasa.js), so in Messages this opens the
 * app straight onto this page.
 *
 * NO WRITE ON RENDER. This page is a preview - the league's name, its games,
 * how it is scored, how full it is and who runs it - and the JOIN is a tap
 * (components/leagues/InviteJoin.js, a server action). A full league, a league
 * that started with late joins off, and a reset link each render their
 * sentence and no button.
 *
 * SIGNED OUT: in the app, the sign-in law sends the reader to sign-in and back
 * here (requireSignInInShell). On the web the preview renders with SIGN IN TO
 * JOIN, whose round trip lands back on this exact URL - so a link unfurled by a
 * group chat (the OG card, P4) has a page to read rather than a redirect.
 */

import Link from 'next/link';
import { auth } from '@/auth';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import { resolveShellMode, simViewport } from '@/lib/shell/shell';
import { requireSignInInShell } from '@/lib/shell/signedOut';
import { shellSigninHref } from '@/lib/shell/signinHref';
import { invitePreview } from '@/lib/leagues/invite';
import { REFUSALS, invitePath, parseInviteKey } from '@/lib/leagues/code';
import { inviteLine, rulesLine, joinWindowLine } from '@/lib/leagues/describe';
import { leagueChips } from '@/lib/leagues/settings';
import { leagueHref } from '@/lib/leagues/nav';
import InviteJoin from '@/components/leagues/InviteJoin';
import '../../leagues/leaguesV1.css';

export const dynamic = 'force-dynamic';

export async function generateViewport() {
  return simViewport(await resolveShellMode());
}

export async function generateMetadata({ params }) {
  const { code } = await params;
  const p = await invitePreview(code).catch(() => null);
  const lg = p?.league;
  return {
    title: lg ? `Join ${lg.name} - Sportsvyn` : 'League invite - Sportsvyn',
    description: lg ? inviteLine(lg) : 'Play the games with your people. Free, always.',
    robots: { index: false, follow: false },
    // The invite card (./opengraph-image.js) needs an absolute URL in the
    // unfurl; app/layout.js sets no metadataBase, so this route does.
    metadataBase: new URL('https://sportsvyn.com'),
    openGraph: { title: lg ? `Join ${lg.name}` : 'League invite', description: lg ? inviteLine(lg) : undefined, siteName: 'Sportsvyn' },
  };
}

export default async function InvitePage({ params }) {
  const { code } = await params;
  const key = parseInviteKey(code);
  const dest = invitePath(key?.value ?? code);
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const isShell = await resolveShellMode();
  requireSignInInShell({ isShell, userId, dest });

  const uid = userId == null ? null : Number(userId);
  const p = await invitePreview(code, uid).catch(() => ({ ok: false, reason: 'failed', league: null, already: false }));
  const lg = p.league;
  const windowLine = lg && !p.reason && !p.already ? joinWindowLine(lg) : null;

  return (
    <>
      <GlobalHeaderServer activeNav="leagues" />
      <main className="lv" data-surface="ink">
        {!lg ? (
          <section className="lv-hero" data-invite-state="dead">
            <p className="lv-hero-eb">League invite</p>
            <p className="lv-refusal">{REFUSALS[p.reason] ?? REFUSALS.failed}.</p>
            <Link className="lv-btn lv-btn--block" href="/leagues">Go to your leagues</Link>
          </section>
        ) : (
          <section className="lv-hero" data-invite-state={p.already ? 'member' : p.reason ?? 'open'}>
            <p className="lv-hero-eb">You&rsquo;re invited{lg.owner_handle ? ` by @${lg.owner_handle}` : ''}</p>
            <h1 className="lv-hero-name">{lg.name}</h1>
            <div className="lv-chips">
              {leagueChips(lg).map((c) => <span className="lv-chip" key={c}>{c}</span>)}
            </div>
            <p className="lv-hero-line">{rulesLine(lg)}</p>
            {windowLine && <p className="lv-hero-line">{windowLine}</p>}
            {p.already ? (
              <Link className="lv-btn lv-btn--primary lv-btn--block" href={leagueHref(lg.id)}>You&rsquo;re in - open the league</Link>
            ) : p.reason ? (
              <p className="lv-refusal" role="status">{REFUSALS[p.reason] ?? REFUSALS.failed}.</p>
            ) : uid == null ? (
              <a className="lv-btn lv-btn--primary lv-btn--block" href={shellSigninHref(dest, isShell)}>Sign in to join</a>
            ) : (
              <InviteJoin inviteKey={key.value} name={lg.name} />
            )}
            <p className="lv-note">Free, always. Your picks stay yours; the league just puts your people on one board.</p>
          </section>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
