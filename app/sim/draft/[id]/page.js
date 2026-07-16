// app/sim/draft/[id]/page.js — the draft room / results, ownership-scoped. noindex.
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import Wordmark from '@/components/gridiron/Wordmark';
import Attribution from '@/components/sim/Attribution';
import DraftRoom from '@/components/sim/DraftRoom';
import DraftResults from '@/components/sim/DraftResults';
import ShellPersist from '@/components/sim/ShellPersist';
import { resolveShellMode, simViewport } from '@/lib/shell/shell';
import { getDraft, getDraftForRoom } from '@/lib/fantasy/drafts';
import { getOrCreateRead } from '@/lib/fantasy/readWriter';
import { FFC_ATTRIBUTION } from '@/lib/fantasy/ffc';
import '@/components/gridiron/gridiron.css';
import '@/components/sim/sim.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Draft Room - Sportsvyn', robots: { index: false, follow: false } };

// Shell mode opts into viewport-fit:cover; non-shell emits the root viewport.
export async function generateViewport({ searchParams }) {
  return simViewport(await resolveShellMode((await searchParams) ?? {}));
}

export default async function DraftRoomPage({ params, searchParams }) {
  const { id } = await params;
  const draftId = Number(id);
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) redirect(`/signin?callbackUrl=/sim/draft/${draftId}`);
  const isShell = await resolveShellMode((await searchParams) ?? {});

  const base = await getDraft(draftId, userId);
  if (!base) notFound(); // not found OR not the user's draft

  const status = base.draft.status;
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
      />
    );
  } else if (status === 'completed') {
    body = <DraftResults data={await getOrCreateRead(draftId, userId)} />;
  } else {
    body = (
      <div style={{ padding: '40px 0' }}>
        <div className="sim-kicker">Draft abandoned</div>
        <p style={{ color: 'var(--paper-dim)' }}>This draft was abandoned.</p>
        <a className="sim-cta" href="/sim">Back to lobby</a>
      </div>
    );
  }

  return (
    <div className={`sim${isShell ? ' sim--shell' : ''}`} data-surface="ink">
      {isShell && <ShellPersist />}
      <header className="sim-head">
        <Wordmark href="/sim" />
        <span className="tag">Draft <b>Room</b></span>
        <div className="right"><a href="/sim">Lobby</a></div>
      </header>
      <main className="sim-wrap">{body}</main>
      <Attribution text={FFC_ATTRIBUTION.text} url={FFC_ATTRIBUTION.url} />
    </div>
  );
}
