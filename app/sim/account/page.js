// app/sim/account/page.js — the signed-in user's account: email, membership
// status, and sign out. Ownership-scoped, noindex.
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import Wordmark from '@/components/gridiron/Wordmark';
import SimTabBar from '@/components/sim/SimTabBar';
import SignOutButton from '@/components/sim/SignOutButton';
import DeleteAccount from '@/components/sim/DeleteAccount';
import ShellPersist from '@/components/sim/ShellPersist';
import { resolveShellMode, simViewport } from '@/lib/shell/shell';
import { getDraftsUsed, isMember, FREE_DRAFT_LIMIT } from '@/lib/fantasy/drafts';
import { getMembership } from '@/lib/membership';
import { openBillingPortal } from '@/app/actions/membership';
import '@/components/gridiron/gridiron.css';
import '@/components/sim/sim.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Account - Sportsvyn', robots: { index: false, follow: false } };

export async function generateViewport({ searchParams }) {
  return simViewport(await resolveShellMode((await searchParams) ?? {}));
}

export default async function SimAccount({ searchParams }) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const isShell = await resolveShellMode((await searchParams) ?? {});
  if (userId == null) redirect('/signin?callbackUrl=/sim/account');

  const [used, member, membership] = await Promise.all([
    getDraftsUsed(userId), isMember(userId), getMembership(userId),
  ]);
  const email = session.user?.email ?? '';
  const renews = member && membership?.current_period_end
    ? new Date(membership.current_period_end).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <div className={`sim sim--tabbar${isShell ? ' sim--shell' : ''}`} data-surface="ink">
      {isShell && <ShellPersist />}
      <header className="sim-head">
        <Wordmark href="/sim" />
        <span className="tag"><b>Account</b></span>
      </header>

      <main className="sim-wrap">
        <div className="sim-kicker">Account</div>
        <div className="acct">
          <div className="acct-row"><span className="k">Email</span><span className="v">{email}</span></div>
          <div className="acct-row"><span className="k">Membership</span><span className="v">{member ? (renews ? `Member · renews ${renews}` : 'Member') : 'Free'}</span></div>
          <div className="acct-row"><span className="k">Drafts</span><span className="v">{member ? 'Unlimited' : `${used} of ${FREE_DRAFT_LIMIT} free this week`}</span></div>
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
                : 'Unlimited drafts, custom rosters, 14+ teams, and the Sportsvyn board are part of the membership. Members sign in and it unlocks.'}
            </div>
          </div>
        ) : member ? (
          <form action={openBillingPortal}>
            <button type="submit" className="acct-manage">Manage membership</button>
          </form>
        ) : (
          <a href="/membership" className="acct-upsell acct-upsell--link">
            <div className="m1">Members get more.</div>
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
