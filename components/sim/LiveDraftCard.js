/**
 * LiveDraftCard - the way back into a draft you are already in.
 *
 * WHY IT EXISTS. The lobby never asked whether the user had an open draft. A
 * returning player with a half-finished room got the preset deck and a "Start a
 * mock draft" kicker, as though nothing existed; the only route back was the
 * HISTORY tab, listed among finished drafts, which is a place you have to
 * already know to look. u35 made three real picks, left, and had no visible
 * way back for sixteen hours - while that room quietly held one of their three
 * free credits.
 *
 * TRACKER ALREADY DID THIS. getOpenTrackerDraft powers the same resume-or-setup
 * branch on the TRACKER tab, with the note that "a live draft is a thing you
 * are IN, so the tab returns you to it rather than offering to start another
 * one on top of it." Sim mode simply never got the treatment.
 *
 * IT SAYS WHERE YOU ARE, not just that something exists. Round and pick, out of
 * the real totals, because "you have an unfinished draft" is a notification and
 * "round 1, pick 4 of 180" is a place. Absent entirely when there is no open
 * draft: the caller renders nothing and the deck moves up.
 */

import Link from 'next/link';
import { deriveRounds } from '@/lib/fantasy/config';

function ago(d) {
  if (!d) return null;
  const mins = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 60000));
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs} ${hrs === 1 ? 'hour' : 'hours'} ago`;
  return `${Math.round(hrs / 24)} days ago`;
}

export default function LiveDraftCard({ draft, member = false }) {
  if (!draft) return null;

  const teams = draft.teams_count ?? null;
  const rounds = deriveRounds(draft.roster_slots) || null;
  const total = teams && rounds ? teams * rounds : null;
  // The pick they are ON is the next one, not the last one made.
  const next = (draft.pick_count ?? 0) + 1;
  const round = teams ? Math.floor((next - 1) / teams) + 1 : null;
  const started = ago(draft.started_at);

  return (
    <section className="livedraft" data-surface="ink" aria-label="Draft in progress">
      <div className="ld-head">
        <span className="ld-kick">Draft in progress</span>
        {started ? <span className="ld-when">started {started}</span> : null}
      </div>

      <div className="ld-body">
        <div className="ld-where">
          <span className="ld-name">{draft.config_name ?? 'Mock draft'}</span>
          <span className="ld-state">
            {round ? <>Round <b>{round}</b> · </> : null}
            Pick <b>{next}</b>{total ? <> of {total}</> : null}
          </span>
        </div>
        <Link className="ld-resume" href={`/sim/draft/${draft.id}`}>Resume</Link>
      </div>

      {/* Free users are told the truth about what the open room is costing.
          getDraftsUsed counts in_progress alongside completed, so this draft
          has already spent one of three whether or not it is ever finished -
          which is the honest reason to go back rather than start another. */}
      {!member ? (
        <p className="ld-note">This draft is already using one of your three free drafts. Finishing it costs nothing more.</p>
      ) : null}
    </section>
  );
}
