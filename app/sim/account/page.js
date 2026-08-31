// app/sim/account/page.js — the signed-in user's account: email, membership
// status, and sign out. Ownership-scoped, noindex.
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import Wordmark from '@/components/gridiron/Wordmark';
import HideInShell from '@/components/shell/HideInShell';
import SimTabBar from '@/components/sim/SimTabBar';
import SignOutButton from '@/components/sim/SignOutButton';
import DeleteAccount from '@/components/sim/DeleteAccount';
import ShellPersist from '@/components/sim/ShellPersist';
import GetTheAppBanner from '@/components/appstore/GetTheAppBanner';
import { resolveShellMode, simViewport } from '@/lib/shell/shell';
import NotificationsRow from '@/components/push/NotificationsRow';
import { sql } from '@/lib/db';
import { appleIapConfig } from '@/lib/appleIap';
import IapConfigure from '@/components/shell/IapConfigure';
import { getDraftsUsed, isMember, FREE_DRAFT_LIMIT } from '@/lib/fantasy/drafts';
import { getMembership } from '@/lib/membership';
import { openBillingPortal } from '@/app/actions/membership';
import '@/components/gridiron/gridiron.css';
import '@/components/sim/sim.css';
import OnboardingGate from '@/components/onboarding/OnboardingGate';
import PushReRegister from '@/components/push/PushReRegister';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Account - Sportsvyn', robots: { index: false, follow: false } };

export async function generateViewport() {
  return simViewport(await resolveShellMode());
}

export default async function SimAccount({ searchParams }) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const isShell = await resolveShellMode();
  if (userId == null) redirect('/signin?callbackUrl=/sim/account');

  const [used, member, membership, me] = await Promise.all([
    getDraftsUsed(userId), isMember(userId), getMembership(userId),
    sql`SELECT push_choice FROM users WHERE id = ${Number(userId)}`.then((r) => r[0] ?? null).catch(() => null),
  ]);
  const { enabled: iap, apiKey: rcKey, productId: rcProduct } = appleIapConfig();
  const email = session.user?.email ?? '';
  const renews = member && membership?.current_period_end
    ? new Date(membership.current_period_end).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <div className={`sim sim--tabbar${isShell ? ' sim--shell' : ''}`} data-surface="ink">
      {isShell && <ShellPersist />}
      {/* The sim draws its own header, so it mounts the sheet itself - see
          the note in GlobalHeaderServer. */}
      <OnboardingGate />
      <PushReRegister />
      {isShell && iap && userId != null && (
        <IapConfigure userId={userId} apiKey={rcKey} productId={rcProduct} />
      )}
      {/* THE CONTAINER HAS ONE HEADER, and it is not this one. This renders
          the SPORTSVYN gridiron wordmark, which is right on the web and wrong
          in an app whose bundle is com.sportsvyn.draftvyn - it is why two tabs
          showed one brand and two showed another. components/shell/AppHeader
          replaces it in the shell; on the web nothing changes. */}
      <HideInShell>
        <header className="sim-head">
          <Wordmark href="/sim" />
          <span className="tag"><b>Account</b></span>
        </header>
      </HideInShell>

      <main className="sim-wrap">
        <GetTheAppBanner shell={isShell} />
        <div className="sim-kicker">Account</div>
        <div className="acct">
          <div className="acct-row"><span className="k">Email</span><span className="v">{email}</span></div>
          <div className="acct-row"><span className="k">Membership</span><span className="v">{member ? (renews ? `Member · renews ${renews}` : 'Member') : 'Free'}</span></div>
          {/* Unlimited for everyone now - see FREE_DRAFT_LIMIT. The COUNT is still
              worth showing; the cap is not, because there is not one. */}
          <div className="acct-row"><span className="k">Drafts</span><span className="v">{used} run &middot; unlimited</span></div>
          {/* Renders only where the push plugin exists - web and the v1.1
              binary see nothing. The road back for every NOT NOW. */}
          <NotificationsRow choice={me?.push_choice ?? null} />
        </div>

        {/* SHELL (App Store 3.1.1): no purchase path and no billing management.
            "Manage membership" opens Stripe's billing portal, which is an
            external account-and-payment mechanism - out in the shell. The
            non-member upsell links to the pricing page - also out. Both are
            replaced by a neutral, factual line about where membership is
            handled. Web is unchanged. */}
        {isShell ? (
          <div className="acct-upsell">
            <div className="m1">{member ? 'Membership active.' : 'Free account.'}</div>
            <div className="m2">
              {member
                ? 'Membership is managed on sportsvyn.com from any browser.'
                : iap
                  ? 'Unlimited drafts, the Draft Tracker, custom rosters, 14+ teams, and the Sportsvyn board.'
                  : 'Unlimited drafts, custom rosters, 14+ teams, and the Sportsvyn board are part of the membership. Members sign in and it unlocks.'}
            </div>
            {/* Buy from the account page too: this is where someone lands when
                they go looking for "how do I upgrade", and with the flag off it
                is unchanged - the neutral line above is all they get. Members
                never see it; their box still points at the web for billing,
                which is the 3.1.1-safe answer for MANAGING a subscription. */}
            {/* PassBuy REMOVED FROM THE SHELL. It rendered the price, UNLOCK
                THE DRAFT PASS and RESTORE PURCHASE to non-members - which is
                now everybody, in front of features that are free. The component
                and its RevenueCat wiring stay in the tree untouched: two live
                passes still resolve, and Apple requires a restore path to exist
                for an app that HAS purchases. This one no longer does. */}
          </div>
        ) : member ? (
          <form action={openBillingPortal}>
            <button type="submit" className="acct-manage">Manage membership</button>
          </form>
        ) : (
          <a href="/membership" className="acct-upsell acct-upsell--link">
            <div className="m1">Everything is free this season.</div>
            <div className="m2">Unlimited drafts · custom rosters · 14+ teams · the Sportsvyn board.</div>
            <div className="m3">See membership →</div>
          </a>
        )}

        <SignOutButton shell={isShell} />
        <DeleteAccount shell={isShell} />
      </main>

      <SimTabBar />
    </div>
  );
}
