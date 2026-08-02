// app/sim/tracker/page.js — the TRACKER bottom-tab destination.
//
// RESUME OR SETUP. A tracker draft is a thing you are physically in the middle
// of, at a table, with people waiting. So the tab returns you to an open draft
// rather than offering to start a second one on top of it; only when there is
// none does it show the setup card.
//
// Doing the resolution in a ROUTE rather than in SimTabBar is deliberate: the tab
// bar is a client component with no data access, and giving it a draft query
// would mean every sim page pays for it on every render. Here the cost lands only
// when the tab is actually tapped.
//
// noindex, ownership-scoped, and shell-framed like the rest of /sim.
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import Wordmark from '@/components/gridiron/Wordmark';
import Attribution from '@/components/sim/Attribution';
import SimTabBar from '@/components/sim/SimTabBar';
import ShellPersist from '@/components/sim/ShellPersist';
import GetTheAppBanner from '@/components/appstore/GetTheAppBanner';
import TrackerStart from '@/components/sim/TrackerStart';
import { resolveShellMode, simViewport } from '@/lib/shell/shell';
import { appleIapConfig } from '@/lib/appleIap';
import IapConfigure from '@/components/shell/IapConfigure';
import { getOpenTrackerDraft, isMember } from '@/lib/fantasy/drafts';
import { FFC_ATTRIBUTION } from '@/lib/fantasy/ffc';
import '@/components/gridiron/gridiron.css';
import '@/components/sim/sim.css';
import '@/components/sim/tracker.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Tracker - Sportsvyn', robots: { index: false, follow: false } };

export async function generateViewport({ searchParams }) {
  return simViewport(await resolveShellMode((await searchParams) ?? {}));
}

export default async function TrackerTab({ searchParams }) {
  const params = (await searchParams) ?? {};
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const isShell = await resolveShellMode(params);
  if (userId == null) redirect(`/signin?callbackUrl=/sim/tracker${isShell ? '&shell=sim-app' : ''}`);

  // Resume takes precedence over everything, including the entitlement check: a
  // draft already in progress belongs to the user regardless of what their
  // membership looks like right now.
  const open = await getOpenTrackerDraft(userId);
  if (open) redirect(`/sim/draft/${open.id}`);

  const member = await isMember(userId);
  const { enabled: iap, apiKey: rcKey, productId: rcProduct } = appleIapConfig();

  return (
    <div className={`sim sim--tabbar${isShell ? ' sim--shell' : ''}`} data-surface="ink">
      {isShell && <ShellPersist />}
      {isShell && iap && userId != null && (
        <IapConfigure userId={userId} apiKey={rcKey} productId={rcProduct} />
      )}
      <header className="sim-head">
        <Wordmark href="/sim" />
        <span className="tag">Draft <b>Tracker</b></span>
      </header>

      <main className="sim-wrap">
        <GetTheAppBanner shell={isShell} />
        {/* TrackerStart renders the gate card for non-members; the entitlement is
            re-checked server-side in startTrackerDraftFor either way. */}
        <TrackerStart entitled={member} shell={isShell} iap={iap} />
      </main>

      <Attribution text={FFC_ATTRIBUTION.text} url={FFC_ATTRIBUTION.url} />
      <SimTabBar />
    </div>
  );
}
