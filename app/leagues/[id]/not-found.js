/**
 * app/leagues/[id]/not-found.js - what everybody who is NOT a member of the
 * league in the URL sees (ruling sun-12 item 8). Private leagues show nothing,
 * not even the name, to non-members.
 *
 * ONE PAGE FOR "NOT YOURS" AND "DOES NOT EXIST", AND IT IS A 404. League ids
 * are serial; the old sealed preview (name, member count, games) answered every
 * id walk with a league's name. Now the page calls notFound() for a non-member
 * exactly as it does for an id that was never issued, and this boundary renders
 * the same body for both, so a probe cannot tell them apart by status or HTML.
 * It takes no props by convention, so it CANNOT be handed league data - that is
 * the point of rendering the refusal here rather than in the page.
 *
 * Signed out: a sign-in prompt that comes back to this URL (a member who was
 * signed out lands on their board). Signed in: "This league is private" and
 * the invite-code field - the invite link or code is the only way in
 * (/j/<key>, which does show the name, because holding it IS the invitation).
 */

import Link from 'next/link';
import { auth } from '@/auth';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import { resolveShellMode } from '@/lib/shell/shell';
import { JoinWithCodeForm } from '@/components/leagues/LeagueChrome';
import LeagueSigninLink from '@/components/leagues/LeagueSigninLink';
import '../../games/games.css';
import '../leagues.css';
import '../leaguesV1.css';

export default async function LeagueNotFound() {
  const session = await auth().catch(() => null);
  const signedIn = session?.user?.id != null;
  const isShell = await resolveShellMode();
  return (
    <>
      <GlobalHeaderServer activeNav="leagues" />
      <main className="lob" data-surface="ink" data-league-private={signedIn ? 'member-only' : 'signed-out'}>
        <Link className="appcrumb" href="/leagues">&larr; Leagues</Link>
        <section className="lg-preview-hero">
          <div className="eb">Private league</div>
          {signedIn ? (
            <>
              <h1 className="lg-hero-name">This league is private</h1>
              <p className="ctx">Only its members can see it.</p>
              <JoinWithCodeForm />
              <p className="muted lg-ask-code">
                Got an invite? Open the link a member sent you, or enter its code here.
              </p>
            </>
          ) : (
            <>
              <h1 className="lg-hero-name">Sign in to see this league</h1>
              <p className="ctx">Leagues are private to their members.</p>
              <LeagueSigninLink isShell={isShell} />
              <p className="muted lg-ask-code">
                Got an invite? Open the link a member sent you.
              </p>
            </>
          )}
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
