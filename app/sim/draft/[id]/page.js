// app/sim/draft/[id]/page.js — the draft room / results, ownership-scoped. noindex.
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import Wordmark from '@/components/gridiron/Wordmark';
import HideInShell from '@/components/shell/HideInShell';
import Attribution from '@/components/sim/Attribution';
import DraftRoom from '@/components/sim/DraftRoom';
import TrackerRoom from '@/components/sim/TrackerRoom';
import TrackerResults from '@/components/sim/TrackerResults';
import DraftResults from '@/components/sim/DraftResults';
import SimTabBar from '@/components/sim/SimTabBar';
import ShellPersist from '@/components/sim/ShellPersist';
import GetTheAppBanner from '@/components/appstore/GetTheAppBanner';
import { resolveShellMode, simViewport } from '@/lib/shell/shell';
import { getDraft, getDraftForRoom } from '@/lib/fantasy/drafts';
import { getOrCreateRead, getOrCreateTrackerRead } from '@/lib/fantasy/readWriter';
import { FFC_ATTRIBUTION } from '@/lib/fantasy/ffc';
import '@/components/gridiron/gridiron.css';
import '@/components/sim/sim.css';
import '@/components/sim/tracker.css';
import OnboardingGate from '@/components/onboarding/OnboardingGate';
import PushReRegister from '@/components/push/PushReRegister';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Draft Room - Sportsvyn', robots: { index: false, follow: false } };

// Shell mode opts into viewport-fit:cover; non-shell emits the root viewport.
export async function generateViewport() {
  return simViewport(await resolveShellMode());
}

export default async function DraftRoomPage({ params, searchParams }) {
  const { id } = await params;
  const draftId = Number(id);
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) redirect(`/signin?callbackUrl=/sim/draft/${draftId}`);
  const isShell = await resolveShellMode();

  const base = await getDraft(draftId, userId);
  if (!base) notFound(); // not found OR not the user's draft

  const status = base.draft.status;
  const isTrackerDraft = (base.draft.mode ?? 'sim') === 'tracker';

  // A live tracker draft is its own full screen per the locked mock: it renders
  // its own header (the wordmark still links to /sim, which is the escape hatch)
  // and its own bottom tabs, so the sim chrome around it would be a second header
  // and a second tab bar competing for the same thumb.
  if (status === 'in_progress' && isTrackerDraft) {
    const room = await getDraftForRoom(draftId, userId);
    return (
      <div className={`sim${isShell ? ' sim--shell' : ''}`} data-surface="ink">
        {isShell && <ShellPersist />}
        {/* The sim draws its own header, so it mounts the sheet itself - see
            the note in GlobalHeaderServer. */}
        <OnboardingGate />
      <PushReRegister />
        <TrackerRoom
          draftId={draftId}
          config={room.config}
          order={room.order}
          rounds={room.rounds}
          userTeamIndex={room.userTeamIndex}
          teamLabels={room.teamLabels}
          initialPicks={room.picks}
          initialAvailable={room.available}
        />
      </div>
    );
  }

  let body;
  if (status === 'in_progress') {
    const room = await getDraftForRoom(draftId, userId);
    body = (
      <DraftRoom
        draftId={draftId}
        config={room.config}
        order={room.order}
        userTeamIndex={room.userTeamIndex}
        initialPicks={room.picks}
        initialAvailable={room.available}
        timerSeconds={room.timerSeconds}
        initialAuto={room.isAuto}
        poolMapping={room.poolMapping}
        minors={room.minors}
        upcomingKeepers={room.upcomingKeepers ?? []}
      />
    );
  } else if (status === 'completed') {
    // Tracker draws its own results: the value ledger and a grade-free Read.
    body = isTrackerDraft
      ? <TrackerResults data={await getOrCreateTrackerRead(draftId, userId)} />
      : <DraftResults data={await getOrCreateRead(draftId, userId)} />;
  } else {
    body = (
      <div style={{ padding: '40px 0' }}>
        <div className="sim-kicker">Draft abandoned</div>
        <p style={{ color: 'var(--paper-dim)' }}>This draft was abandoned.</p>
        <a className="sim-cta" href="/sim">Back to lobby</a>
      </div>
    );
  }

  // The bottom tab bar shows on the results / abandoned views, but NOT inside an
  // active draft room - there the swipe pager's own dot/segment tabs own the bottom.
  const showTabBar = status !== 'in_progress';

  return (
    <div className={`sim${showTabBar ? ' sim--tabbar' : ''}${isShell ? ' sim--shell' : ''}`} data-surface="ink">
      {isShell && <ShellPersist />}
      {/* THE CONTAINER HAS ONE HEADER, and it is not this one. This renders
          the SPORTSVYN gridiron wordmark, which is right on the web and wrong
          in an app whose bundle is com.sportsvyn.draftvyn - it is why two tabs
          showed one brand and two showed another. components/shell/AppHeader
          replaces it in the shell; on the web nothing changes. */}
      <HideInShell>
        <header className="sim-head">
          <Wordmark href="/sim" />
          <span className="tag">Draft <b>Room</b></span>
          <div className="right"><a href="/sim">Lobby</a></div>
        </header>
      </HideInShell>
      {/* Same predicate as the tab bar, for the same reason: a live draft room is
          a locked one-viewport console with a pick clock running, and chrome that
          pushes it down or competes for the tap does not belong there. On the
          results and abandoned views the page scrolls normally and the banner is
          just the next block. The live TRACKER room returns earlier (above) and
          never reaches this markup at all. */}
      <main className="sim-wrap">
        {/* BACK, WITHIN THE SECTION. The tab bar switches sections; this walks
            back inside one. A results board is a sub-surface of the tab that
            owns it - Practice for a mock, Tracker for a tracked room - and
            before this the only way out of one was the browser's back button,
            which the app container does not have.

            Suppressed on the live room for the same reason the tab bar is:
            showTabBar is false there. */}
        {showTabBar && (
          <a className="appcrumb" href={isTrackerDraft ? '/sim/tracker' : '/sim'}>
            &larr; {isTrackerDraft ? 'Tracker' : 'Mock'}
          </a>
        )}
        {showTabBar && <GetTheAppBanner shell={isShell} />}
        {body}
      </main>
      <Attribution text={FFC_ATTRIBUTION.text} url={FFC_ATTRIBUTION.url} />
      {showTabBar && <SimTabBar />}
    </div>
  );
}
