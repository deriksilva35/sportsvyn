// app/sim/page.js — the sim lobby. Unlinked from existing nav; noindex.
import { auth } from '@/auth';
import Wordmark from '@/components/gridiron/Wordmark';
import HideInShell from '@/components/shell/HideInShell';
import Attribution from '@/components/sim/Attribution';
import StartForm from '@/components/sim/StartForm';
import LiveDraftCard from '@/components/sim/LiveDraftCard';
import SimTabBar from '@/components/sim/SimTabBar';
import ShellPersist from '@/components/sim/ShellPersist';
import GetTheAppBanner from '@/components/appstore/GetTheAppBanner';
import WelcomeSheet from '@/components/sim/WelcomeSheet';
import { resolveShellMode, simViewport } from '@/lib/shell/shell';
import { shellSigninHref } from '@/lib/shell/signinHref';
import { appleIapConfig } from '@/lib/appleIap';
import IapConfigure from '@/components/shell/IapConfigure';
import { getPresets, getDraftsUsed, isMember, canStartDraft, getOpenSimDraft, FREE_DRAFT_LIMIT } from '@/lib/fantasy/drafts';
import { FFC_ATTRIBUTION } from '@/lib/fantasy/ffc';
import '@/components/gridiron/gridiron.css';
import '@/components/sim/sim.css';
import '@/components/sim/tracker.css';

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
            <div className="sim-kicker">Fantasy · Mock Draft</div>
            <h1>Draft against the market, not a spreadsheet</h1>
            <p>A full snake mock against AI opponents that reach and slide like a real room - every pick graded on value versus live ADP. Three free drafts, no setup. Members draft unlimited.</p>
            <a className="sim-cta" href={signinHref}>Sign in to draft</a>
            <p className="sim-cta-note">Sign in or create an account - Apple or email.</p>
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
                {/* First-launch sheet: shell + flag + NOT already entitled. Mounted
                    here rather than at the top of the page because that is where
                    `member` is resolved - hoisting it would have meant a second
                    isMember() query for the same answer. Once per device; see
                    WelcomeSheet for the storage contract. */}
                {isShell && iap && !member && <WelcomeSheet />}
                {/* ABOVE THE DECK, because a draft you are already in outranks
                    starting another one. Renders nothing when there is none. */}
                <LiveDraftCard draft={openDraft} member={member} />
                <section>
                  <div className="sim-kicker">Start a mock draft</div>
                  <StartForm presets={presets} canStart={gate.ok} used={used} limit={FREE_DRAFT_LIMIT} member={member} shell={isShell} iap={iap} />
                </section>
                {/* THE TRACKER SETUP MOVED TO ITS OWN TAB. Two flows, two
                    homes: this page starts a mock against AI, /sim/tracker
                    tracks a real draft at a real table. They shared a screen
                    while the tracker was new, and the result was one page
                    asking a reader to decide which product they were in before
                    it would let them start anything. One link out is enough. */}
                <a className="sim-trklink" href="/sim/tracker">
                  Tracking a real draft? &rarr;
                </a>
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
