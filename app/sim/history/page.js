// app/sim/history/page.js — the user's past drafts. Ownership-scoped, noindex.
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import Wordmark from '@/components/gridiron/Wordmark';
import SimTabBar from '@/components/sim/SimTabBar';
import ShellPersist from '@/components/sim/ShellPersist';
import { resolveShellMode, simViewport } from '@/lib/shell/shell';
import { getDraftHistory } from '@/lib/fantasy/drafts';
import { getEntitlements } from '@/lib/membership';
import { getExposureReport } from '@/lib/sim/exposureReport';
import ExposureReport from '@/components/sim/ExposureReport';
import { SCORING_LABEL } from '@/lib/fantasy/config';
import '@/components/gridiron/gridiron.css';
import '@/components/sim/sim.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Draft History - Sportsvyn', robots: { index: false, follow: false } };

export async function generateViewport({ searchParams }) {
  return simViewport(await resolveShellMode((await searchParams) ?? {}));
}

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function label(d) {
  if (d.config_name && d.config_name !== 'Custom') return d.config_name;
  const scoring = SCORING_LABEL[d.scoring_format] ?? (d.scoring_format ?? '').toUpperCase();
  return `${d.config_name === 'Custom' ? 'Custom · ' : ''}${d.teams_count ?? '?'}-team ${scoring}`.trim();
}

export default async function SimHistory({ searchParams }) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const isShell = await resolveShellMode((await searchParams) ?? {});
  if (userId == null) redirect('/signin?callbackUrl=/sim/history');

  const [drafts, ent] = await Promise.all([getDraftHistory(userId), getEntitlements(userId)]);
  // Exposure Report: computed for sim-entitled users, locked preview for free.
  const exposure = ent.sim ? await getExposureReport(userId) : null;

  return (
    <div className={`sim sim--tabbar${isShell ? ' sim--shell' : ''}`} data-surface="ink">
      {isShell && <ShellPersist />}
      <header className="sim-head">
        <Wordmark href="/sim" />
        <span className="tag">Draft <b>History</b></span>
      </header>

      <main className="sim-wrap">
        <div className="sim-kicker">Your drafts</div>
        {drafts.length === 0 ? (
          <p className="hist-empty">No drafts yet. <Link href="/sim">Start one →</Link></p>
        ) : (
          <ul className="hist">
            {drafts.map((d) => {
              const inner = (
                <>
                  <span className="hist-main">
                    <span className="hist-nm">{label(d)}</span>
                    <span className="hist-sub">{fmtDate(d.started_at)}{d.status === 'in_progress' ? ` · pick ${d.pick_count + 1}` : ''}</span>
                  </span>
                  <span className="hist-right">
                    {d.status === 'completed' && d.grade
                      ? <span className="hist-grade">{d.grade}</span>
                      : <span className={`hist-status ${d.status}`}>{d.status === 'in_progress' ? 'In progress' : d.status === 'completed' ? 'Complete' : 'Abandoned'}</span>}
                  </span>
                </>
              );
              // completed -> results; in_progress -> resume the room; abandoned -> no link.
              return (
                <li key={d.id} className="hist-row">
                  {d.status === 'abandoned'
                    ? <div className="hist-link is-abandoned">{inner}</div>
                    : <Link href={`/sim/draft/${d.id}`} className="hist-link">{inner}</Link>}
                </li>
              );
            })}
          </ul>
        )}

        <ExposureReport report={exposure} locked={!ent.sim} />
      </main>

      <SimTabBar />
    </div>
  );
}
