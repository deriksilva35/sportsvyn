/**
 * /account — who you are signed in as, what you hold, and how to stop.
 *
 * WHY THIS EXISTS. The only real account page was /sim/account, reachable only
 * from inside the sim: a reader who arrived through the Daily or a box score
 * and wanted to sign out had to find their way into a fantasy product first.
 * The header's account menu offered "My Sportsvyn" (a dashboard) and
 * "Membership" (a price list), neither of which answers "who am I and how do I
 * leave".
 *
 * IT DOES NOT REBUILD MEMBERSHIP LOGIC. getMembership and isMember are the same
 * reads /sim/account makes, and SignOutButton is the same component - which
 * matters beyond reuse, because that button also logs out of RevenueCat.
 * Anything that ships a second sign-out path will eventually ship one that
 * forgets to.
 *
 * BILLING AND DELETION STAY WHERE THEY ARE. This page names the state and links
 * onward; it is deliberately not a second billing surface, because two places
 * that can cancel a subscription is one place too many.
 *
 * Ink, v1.2 module grammar. Ownership-scoped, noindex.
 */

import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import YourDrafts from '@/components/sim/YourDrafts';
import { getDraftHistory } from '@/lib/fantasy/drafts';
import { splitDrafts } from '@/lib/fantasy/yourDrafts';
import SignOutButton from '@/components/sim/SignOutButton';
import { resolveShellMode, simViewport } from '@/lib/shell/shell';
import { getMembership } from '@/lib/membership';
import { isMember } from '@/lib/fantasy/drafts';
import './account.css';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Account - Sportsvyn',
  robots: { index: false, follow: false },
};

export async function generateViewport({ searchParams }) {
  return simViewport(await resolveShellMode((await searchParams) ?? {}));
}

export default async function AccountPage({ searchParams }) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) redirect('/signin?callbackUrl=/account');

  const isShell = await resolveShellMode((await searchParams) ?? {});
  // Neither read may cost the page: a membership lookup that fails reads as
  // "not a member", which is the safe direction for a status line.
  const [member, membership, draftRows] = await Promise.all([
    isMember(userId).catch(() => false),
    getMembership(userId).catch(() => null),
    // Caught to an empty list: a history read must never be able to cost
    // somebody their account page, which is also where sign-out lives.
    getDraftHistory(userId).catch(() => []),
  ]);
  const yourDrafts = splitDrafts(draftRows);

  const email = session.user?.email ?? '';
  const renews = member && membership?.current_period_end
    ? new Date(membership.current_period_end).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    })
    : null;
  const source = membership?.source === 'apple' ? 'Apple' : membership?.source === 'stripe' ? 'Stripe' : null;

  return (
    <>
      <GlobalHeaderServer activeNav={null} />
      <main className="acct" data-surface="ink">

        <section className="acct-mod">
          <h1 className="acct-eyebrow">Signed in as</h1>
          <div className="acct-email">{email || 'your account'}</div>
        </section>

        <section className="acct-mod">
          <h2 className="acct-eyebrow">Membership</h2>
          <div className="acct-rows">
            <div className="acct-row">
              <span>Status</span>
              <span className={`acct-r${member ? ' acct-r--on' : ''}`}>
                {member ? 'Active' : 'Free'}
              </span>
            </div>
            {membership?.tier && (
              <div className="acct-row"><span>Plan</span><span className="acct-r">{membership.tier}</span></div>
            )}
            {source && (
              <div className="acct-row"><span>Billed through</span><span className="acct-r">{source}</span></div>
            )}
            {renews && (
              <div className="acct-row"><span>Renews</span><span className="acct-r">{renews}</span></div>
            )}
          </div>
          {/* 3.1.1: no pricing entry inside the native container. */}
          {!isShell && (
            <a className="acct-ghost" href="/membership">
              {member ? 'Manage membership' : 'What is free this season'} &rarr;
            </a>
          )}
        </section>

        {/* YOUR DRAFTS. The brief's rule is that nothing should be reachable
            only by remembering a URL, and before this an unfinished mock was
            exactly that once its resume card scrolled off Practice. Renders
            nothing at all for a reader with no drafts - a heading over an empty
            list reads as a feature that failed to load. */}
        <YourDrafts split={yourDrafts} />

        <section className="acct-mod">
          <h2 className="acct-eyebrow">Elsewhere</h2>
          <div className="acct-rows">
            <a className="acct-row acct-row--link" href="/my"><span>My Sportsvyn</span><span className="acct-r">&rarr;</span></a>
            <a className="acct-row acct-row--link" href="/daily"><span>The Daily</span><span className="acct-r">&rarr;</span></a>
            <a className="acct-row acct-row--link" href="/sim/account"><span>Draft settings and account deletion</span><span className="acct-r">&rarr;</span></a>
          </div>
        </section>

        {/* LEGAL, REACHABLE IN-APP. The site footer carries Privacy and Terms
            on the web and the footer is not rendered in the container - so
            without this the two documents would be reachable only by typing a
            URL the app has no bar to type it in. The App Store expects both
            in-app, and two quiet links in the account section is the native
            pattern for it. Rendered on the web too: a second path to the legal
            pages costs nothing and the account page is where people look. */}
        <section className="acct-mod">
          <h2 className="acct-eyebrow">Legal</h2>
          <div className="acct-rows">
            <a className="acct-row acct-row--link" href="/privacy"><span>Privacy</span><span className="acct-r">&rarr;</span></a>
            <a className="acct-row acct-row--link" href="/terms"><span>Terms</span><span className="acct-r">&rarr;</span></a>
          </div>
        </section>

        <section className="acct-mod">
          {/* The same component the sim uses, so there is exactly one sign-out
              path and it is the one that also logs out of RevenueCat. */}
          <SignOutButton shell={isShell} />
        </section>

      </main>
      <SiteFooter />
    </>
  );
}
