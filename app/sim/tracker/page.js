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
import HideInShell from '@/components/shell/HideInShell';
import Attribution from '@/components/sim/Attribution';
import SimTabBar from '@/components/sim/SimTabBar';
import ShellPersist from '@/components/sim/ShellPersist';
import GetTheAppBanner from '@/components/appstore/GetTheAppBanner';
import TrackerStart from '@/components/sim/TrackerStart';
import YourDrafts from '@/components/sim/YourDrafts';
import { getDraftHistory } from '@/lib/fantasy/drafts';
import { splitDrafts } from '@/lib/fantasy/yourDrafts';
import { resolveShellMode, simViewport } from '@/lib/shell/shell';
import { shellSigninHref } from '@/lib/shell/signinHref';
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
  if (userId == null) redirect(shellSigninHref('/sim/tracker', isShell));

  // A CARD, NOT A REDIRECT. This used to bounce straight into an open room,
  // which made the tab a trapdoor rather than a destination: a reader who
  // tapped TRACKER to check the rules, or to look at last week's board, was
  // thrown into a live draft with no way to have meant anything else. The room
  // is still one tap away and still the first thing on the page - but it is now
  // a choice. Resume still outranks the entitlement check either way: a draft
  // in progress belongs to the user whatever their membership looks like now.
  const open = await getOpenTrackerDraft(userId);

  const [member, historyRows] = await Promise.all([
    isMember(userId),
    getDraftHistory(userId).catch(() => []),
  ]);
  const yourDrafts = splitDrafts(historyRows);
  const { enabled: iap, apiKey: rcKey, productId: rcProduct } = appleIapConfig();

  return (
    <div className={`sim sim--tabbar${isShell ? ' sim--shell' : ''}`} data-surface="ink">
      {isShell && <ShellPersist />}
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
          <span className="tag">Draft <b>Tracker</b></span>
        </header>
      </HideInShell>

      <main className="sim-wrap">
        <GetTheAppBanner shell={isShell} />

        {/* THE OPEN ROOM LEADS. A draft you are physically in the middle of, at
            a table, with people waiting, outranks every other thing on this
            page. Absent entirely when there is none. */}
        {open && (
          <section className="sim-mod trk-resume">
            <div className="sim-kicker">You are tracking a draft</div>
            <p className="trk-lede">
              Room {open.id} is still open. Pick up where you left off &mdash; nothing
              expires and nothing is on a clock.
            </p>
            <a className="btn btn--volt" href={`/sim/draft/${open.id}`}>Re-enter the room &rarr;</a>
          </section>
        )}

        {/* WHAT THIS IS, before what it costs. The tracker is the one product
            here that has to be explained rather than recognised: "draft sim" is
            self-evident and "track a real draft" is not. */}
        <section className="sim-mod">
          <div className="sim-kicker">What the tracker is</div>
          <p className="trk-lede">
            You are drafting somewhere else &mdash; a league site, a room, a bar &mdash; and
            you enter each pick here as it happens. The tracker keeps the board, tells you
            what is left, and grades your roster the same way a mock does.
          </p>
          <div className="trk-rows">
            <div className="row"><span>No clock</span><span className="r">Runs as long as your draft does</span></div>
            <div className="row"><span>Every seat</span><span className="r">You enter all of them, not just yours</span></div>
            <div className="row"><span>Leave and return</span><span className="r">The room waits</span></div>
          </div>
        </section>

        {/* TrackerStart renders the gate card for non-members; the entitlement is
            re-checked server-side in startTrackerDraftFor either way. */}
        <TrackerStart entitled={member} shell={isShell} iap={iap} />

        {/* ITS OWN HISTORY, under its own setup. Making a reader cross to
            PROFILE to find last Tuesday's room would be the two-homes problem
            again, one level down. PROFILE still carries all three buckets. */}
        <YourDrafts split={yourDrafts} only="tracker" />
      </main>

      <Attribution text={FFC_ATTRIBUTION.text} url={FFC_ATTRIBUTION.url} />
      <SimTabBar />
    </div>
  );
}
