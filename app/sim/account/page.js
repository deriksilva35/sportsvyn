// app/sim/account/page.js — the signed-in user's account: email, membership
// status, and sign out. Ownership-scoped, noindex.
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import Wordmark from '@/components/gridiron/Wordmark';
import SimTabBar from '@/components/sim/SimTabBar';
import SignOutButton from '@/components/sim/SignOutButton';
import ShellPersist from '@/components/sim/ShellPersist';
import { resolveShellMode, simViewport } from '@/lib/shell/shell';
import { getDraftsUsed, isMember, FREE_DRAFT_LIMIT } from '@/lib/fantasy/drafts';
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

  const [used, member] = await Promise.all([getDraftsUsed(userId), isMember(userId)]);
  const email = session.user?.email ?? '';

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
          <div className="acct-row"><span className="k">Membership</span><span className="v">{member ? 'Member' : 'Free'}</span></div>
          <div className="acct-row"><span className="k">Drafts</span><span className="v">{used} of {FREE_DRAFT_LIMIT} free used</span></div>
        </div>

        {!member && (
          <div className="acct-upsell">
            <div className="m1">Members get more.</div>
            <div className="m2">Unlimited drafts · custom rosters · 14+ teams · the Sportsvyn board.</div>
          </div>
        )}

        <SignOutButton />
      </main>

      <SimTabBar />
    </div>
  );
}
