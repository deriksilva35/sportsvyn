// app/sim/page.js — the sim lobby. Unlinked from existing nav; noindex.
import { auth } from '@/auth';
import Wordmark from '@/components/gridiron/Wordmark';
import Attribution from '@/components/sim/Attribution';
import StartForm from '@/components/sim/StartForm';
import { getPresets, getDraftsUsed, isMember, canStartDraft, FREE_DRAFT_LIMIT } from '@/lib/fantasy/drafts';
import { FFC_ATTRIBUTION } from '@/lib/fantasy/ffc';
import '@/components/gridiron/gridiron.css';
import '@/components/sim/sim.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Mock Draft Sim - Sportsvyn', robots: { index: false, follow: false } };

export default async function SimLobby() {
  const session = await auth();
  const userId = session?.user?.id ?? null;

  return (
    <div className="sim" data-surface="ink">
      <header className="sim-head">
        <Wordmark href="/sim" />
        <span className="tag">Mock Draft <b>Sim</b></span>
      </header>

      <main className="sim-wrap">
        {userId == null ? (
          <section className="sim-pitch">
            <div className="sim-kicker">Fantasy · Mock Draft</div>
            <div className="sim-ph">Placeholder pitch copy</div>
            <h1>Draft against the market, not a spreadsheet</h1>
            <p>A full snake mock against AI opponents that reach and slide like a real room, graded on value versus live ADP. Three free drafts, no setup.</p>
            <a className="sim-cta" href="/signin?callbackUrl=/sim">Sign in to draft</a>
          </section>
        ) : (
          await (async () => {
            const [presets, used, member] = await Promise.all([getPresets(), getDraftsUsed(userId), isMember(userId)]);
            const gate = await canStartDraft(userId, member);
            return (
              <section>
                <div className="sim-kicker">Start a mock draft</div>
                <StartForm presets={presets} canStart={gate.ok} used={used} limit={FREE_DRAFT_LIMIT} />
              </section>
            );
          })()
        )}
      </main>
      <Attribution text={FFC_ATTRIBUTION.text} url={FFC_ATTRIBUTION.url} />
    </div>
  );
}
