// app/sim/page.js — the sim lobby. Unlinked from existing nav; noindex.
import Link from 'next/link';
import { auth } from '@/auth';
import Wordmark from '@/components/gridiron/Wordmark';
import HideInShell from '@/components/shell/HideInShell';
import Attribution from '@/components/sim/Attribution';
import StartForm from '@/components/sim/StartForm';
import LiveDraftCard from '@/components/sim/LiveDraftCard';
import SimTabBar from '@/components/sim/SimTabBar';
import ShellPersist from '@/components/sim/ShellPersist';
import GetTheAppBanner from '@/components/appstore/GetTheAppBanner';
import { resolveShellMode, simViewport } from '@/lib/shell/shell';
import { requireSignInInShell } from '@/lib/shell/signedOut';
import { shellSigninHref } from '@/lib/shell/signinHref';
import { appleIapConfig } from '@/lib/appleIap';
import IapConfigure from '@/components/shell/IapConfigure';
import { getPresets, getDraftsUsed, isMember, canStartDraft, getOpenSimDraft, FREE_DRAFT_LIMIT } from '@/lib/fantasy/drafts';
import { FFC_ATTRIBUTION } from '@/lib/fantasy/ffc';
import '@/components/gridiron/gridiron.css';
import '@/components/sim/sim.css';
import '@/components/sim/tracker.css';
import OnboardingGate from '@/components/onboarding/OnboardingGate';
import PushReRegister from '@/components/push/PushReRegister';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Mock Draft Sim - Sportsvyn', robots: { index: false, follow: false } };

// Shell mode opts into viewport-fit:cover; non-shell emits the root viewport.
export async function generateViewport({ searchParams }) {
  return simViewport(await resolveShellMode((await searchParams) ?? {}));
}

export default async function SimLobby({ searchParams }) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const params = (await searchParams) ?? {};
  const isShell = await resolveShellMode(params);
  // IN THE CONTAINER, SIGNED OUT, THE ANSWER IS THE SIGN-IN FORM. Ahead of the
  // lobby read below, because a redirect makes every query under it wasted.
  requireSignInInShell({ isShell, userId, dest: '/sim' });
  // Apple IAP buy path. Server-resolved (not NEXT_PUBLIC_, so flipping it is a
  // pure env change) and threaded as a prop, the same way `shell` already flows.
  // `enabled` requires the flag AND a valid appl_ key, so a half-configured
  // environment renders the suppressed card rather than a button that cannot work.
  const { enabled: iap, apiKey: rcKey, productId: rcProduct } = appleIapConfig();
  // Carry shell context into /signin so it renders the app front door reliably
  // (not dependent on the sv_shell cookie having been written yet), AND inside
  // the callbackUrl value so it survives Sign in with Apple.
  //
  // Apple posts its result back cross-site (response_mode=form_post), which
  // drops the SameSite=Lax sv_shell cookie - so the createUser hook could never
  // tell a shell signup from a web one and labelled every Apple account
  // apple:web. auth.js already relaxes the callback-url cookie to
  // SameSite=None+Secure exactly so it survives that POST, so putting the
  // marker INSIDE the callbackUrl is what carries the surface across.
  const signinHref = shellSigninHref('/sim', isShell);
  // Post-deletion landing: the delete-account flow signs out and redirects here.
  const deleted = userId == null && params.deleted != null;

  // sim--stack: the signed-in lobby now hosts TWO products (mock-draft setup +
  // tracker), and the <=900px one-viewport lock was written for exactly one
  // section. Without it the two sections each take flex:1 of a locked 100vh
  // column with overflow:hidden, splitting the screen and scrunching both with
  // nowhere to scroll. The modifier relaxes the lock so the page scrolls and each
  // section sizes to its content; desktop is untouched.
  return (
    <div
      className={`sim${userId != null ? ' sim--tabbar sim--setup sim--stack' : ''}${isShell ? ' sim--shell' : ''}`}
      data-surface="ink"
    >
      {isShell && <ShellPersist />}
      {/* The sim draws its own header, so it mounts the sheet itself - see
          the note in GlobalHeaderServer. */}
      <OnboardingGate />
      <PushReRegister />
      {/* Configure RevenueCat only in shell, only with the buy path on, and only
          once the user id is known - never anonymously (see IapConfigure). */}
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
          <span className="tag">Mock Draft <b>Sim</b></span>
        </header>
      </HideInShell>

      <main className="sim-wrap">
        <GetTheAppBanner shell={isShell} />
        {deleted ? (
          <section className="sim-pitch">
            <div className="sim-kicker">Account deleted</div>
            <h1>Your account was deleted</h1>
            <p>Your account, drafts, and history have been permanently removed. Thanks for trying the sim.</p>
            <a className="sim-cta" href={signinHref}>Start over</a>
          </section>
        ) : userId == null ? (
          <section className="sim-pitch">
            {/* THE ASK IS IDENTITY, NOT ACCESS. "Sign in to draft" read as a
                toll on the thing they came for, and it is not even true any
                more - drafts are free and unlimited. What signing in actually
                buys is a NAME: a handle that carries your score across every
                game, rather than appearing as Player 3f9c on a public board.
                The headline and the free-unlimited line are kept; only the ask
                is reframed. */}
            <div className="sim-kicker">Fantasy · Mock Draft</div>
            <h1>Draft against the market, not a spreadsheet</h1>
            <p>A full snake mock against AI opponents that reach and slide like a real room - every pick graded on value versus live ADP. Free and unlimited, no setup.</p>
            <a className="sim-cta" href={signinHref}>Claim your handle</a>
            <p className="sim-cta-note">
              An account takes a moment and costs nothing. It gets you a handle -
              the name beside your score on every board, in every game - and it
              keeps your drafts, your history and your streak.
            </p>
          </section>
        ) : (
          await (async () => {
            // The open-draft read rides the same round trip as the other three.
            const [presets, used, member, openDraft] = await Promise.all([
              getPresets(), getDraftsUsed(userId), isMember(userId), getOpenSimDraft(userId),
            ]);
            const gate = await canStartDraft(userId, member);
            return (
              <>
                {/* WELCOMESHEET RETIRED. It was a product pitch shown once per
                    device to non-members, and both halves of that premise died:
                    the paywall is gone so "non-member" is everybody, and the
                    first-open surface is now OnboardingSheet - which asks for
                    something rather than selling something. Its best line is
                    salvaged into the signed-out hero above. */}
                {/* THE DAILY'S DOOR ON PRACTICE (v0.3 polish). One compact band,
                    not a hero - Practice is still this page's job - but it is
                    the app's most-visited screen and The Daily turns over at
                    midnight, so the band is the difference between a game that
                    exists and a game that gets found. Above everything,
                    volt-forward, one line. */}
                <Link className="sim-dailyband" href="/daily">
                  <span className="sdb-kick">The Daily</span>
                  <span className="sdb-line">Today&rsquo;s board is live. Three minutes, best six.</span>
                  <span className="sdb-cta">Play &rarr;</span>
                </Link>
                {/* ABOVE THE DECK, because a draft you are already in outranks
                    starting another one. Renders nothing when there is none. */}
                <LiveDraftCard draft={openDraft} member={member} />
                <section>
                  <div className="sim-kicker">Start a mock draft</div>
                  <StartForm presets={presets} canStart={gate.ok} used={used} limit={FREE_DRAFT_LIMIT} member={member} shell={isShell} iap={iap} />
                </section>
                {/* The tracker link moved INTO StartForm (v0.3.1): it now
                    carries the live config as a handoff, and only the form
                    knows the live config. One link out is still the law -
                    it just learned to pack a bag. */}
              </>
            );
          })()
        )}
      </main>
      <Attribution text={FFC_ATTRIBUTION.text} url={FFC_ATTRIBUTION.url} />
      {userId != null && <SimTabBar />}
    </div>
  );
}
