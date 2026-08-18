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
import { getOpenTrackerDraft, isMember, trackerResumeCard } from '@/lib/fantasy/drafts';
import { FFC_ATTRIBUTION } from '@/lib/fantasy/ffc';
import '@/components/gridiron/gridiron.css';
import '@/components/sim/sim.css';
import '@/components/sim/tracker.css';
import OnboardingGate from '@/components/onboarding/OnboardingGate';
import PushReRegister from '@/components/push/PushReRegister';

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

  // BACK INTO THE ROOM, and my card was the wrong fix for the trapdoor.
  //
  // I replaced this redirect with a resume card so the tab could not throw a
  // reader into a live draft. On a phone that reads as LOSING THE SESSION: tab
  // to the Daily mid-round, come back, and the tracker shows a setup screen.
  // A commissioner two hours into draft night does not read that as "your room
  // is one tap away", they read it as gone.
  //
  // AN ACTIVE ROOM PERSISTS UNTIL IT IS EXPLICITLY ENDED. The tab returns you
  // into it; the home screen below renders only when there is none. The
  // trapdoor is solved the other way round instead - the room carries a
  // "Tracker home" breadcrumb, so the rules and the setup stay reachable FROM
  // the room, and END TRACKING is the only exit that forgets it.
  //
  // The session was never client-only: getOpenTrackerDraft reads a drafts row
  // with status 'in_progress', so it already survives an app kill, a dead
  // battery and a two-hour draft. The bug was this page declining to use it.
  //
  // Resume outranks the entitlement check, as before: a draft in progress
  // belongs to the user whatever their membership looks like right now.
  // THE TAB RESUMES; THE BREADCRUMB DOES NOT LOOP.
  //
  // The redirect made "Tracker home" a dead link: tapping it from inside the
  // room landed here, and here sent you straight back. A no-op, and the room
  // had no way out at all.
  //
  // ?home=1 IS THE DIFFERENCE BETWEEN THE TWO ARRIVALS. Tapping the TRACKER tab
  // means "take me to my draft" and still resumes. Tapping the breadcrumb means
  // "I want the rules, the setup, the history" and must actually leave - so it
  // suppresses the resume and the page renders home with a Resume card on top.
  // In-room -> home -> resume round-trips, and the card is the way back.
  const goHome = params.home === '1';
  const open = await getOpenTrackerDraft(userId);
  if (open && !goHome) redirect(`/sim/draft/${open.id}`);

  // The card needs to say WHERE in the draft, or "Resume" is just a word. Round
  // and pick are derived from the pick count rather than stored - the same
  // derivation the room uses, so the card and the room cannot disagree.
  const resume = open ? await trackerResumeCard(open.id) : null;

  const [member, historyRows] = await Promise.all([
    isMember(userId),
    getDraftHistory(userId).catch(() => []),
  ]);
  const yourDrafts = splitDrafts(historyRows);
  const { enabled: iap, apiKey: rcKey, productId: rcProduct } = appleIapConfig();

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
          <span className="tag">Draft <b>Tracker</b></span>
        </header>
      </HideInShell>

      <main className="sim-wrap">
        <GetTheAppBanner shell={isShell} />

        {/* THE OPEN ROOM LEADS, when you arrived here deliberately. This is
            what makes the breadcrumb a real exit rather than a loop: you can
            reach the rules and the history without ending the draft, and get
            back in one tap. */}
        {resume && (
          <section className="sim-mod trk-resume">
            <div className="sim-kicker">You are tracking a draft</div>
            <p className="trk-lede">
              Round {resume.round}, pick {resume.pickInRound} &mdash; {resume.picks} in.
              Nothing expires and nothing is on a clock.
            </p>
            <a className="btn btn--volt" href={`/sim/draft/${resume.id}`}>
              Resume &mdash; Rd {resume.round} Pick {resume.pickInRound} &rarr;
            </a>
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
