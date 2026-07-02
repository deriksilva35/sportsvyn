/**
 * TodayNextPanel: server component.
 *
 * Renders two stacked blocks inside one panel:
 *   1. Today's most recent final involving a followed team (if any).
 *   2. The next two scheduled fixtures involving a followed team.
 *
 * Followed team names render volt via the shared .team-name-followed
 * class from globals.css (color only, no other treatment). Names are
 * the only volt surface in this panel; flags, scores, and venue copy
 * stay paper-warm.
 */

import FlagSlot from '@/components/FlagSlot';
import { penSuffix } from '@/lib/penalties';

const PT_TZ = 'America/Los_Angeles';

function fmtKickoffPt(iso) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: PT_TZ,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

function NameSpan({ team, followedSet }) {
  const followed = team?.id != null && followedSet?.has(team.id);
  return (
    <span className={followed ? 'team-name-followed' : undefined}>
      {team?.name ?? ''}
    </span>
  );
}

// Knockout-stage label wording, mirroring the canonical map (lib/aiBrief.js
// STAGE_LABELS). Group stage is synthesized from group_code. The group stage
// is over, so in practice this resolves the round name (e.g. "Round of 32").
const STAGE_LABELS = {
  round_of_32: 'Round of 32',
  round_of_16: 'Round of 16',
  quarter:     'Quarterfinal',
  semi:        'Semifinal',
  third_place: 'Third-place playoff',
  final:       'Final',
};
function roundLabel(stage, groupCode) {
  if (stage === 'group') return groupCode ? `Group ${groupCode}` : 'Group Stage';
  return STAGE_LABELS[stage] ?? null;
}

function RecentRow({ match, followedSet }) {
  const hs = match.home_score ?? 0;
  const as = match.away_score ?? 0;
  // Shootout suffix folds into the meta line to keep the small row compact:
  // "Round of 32 · Full time · (3-4 pens)". Empty string for non-shootouts.
  const pens = penSuffix(match.home_score, match.away_score, match.home_penalties, match.away_penalties);
  const meta = [roundLabel(match.stage, match.group_code), 'Full time', pens].filter(Boolean).join(' · ');
  const watch = match.watch_score != null ? match.watch_score.toFixed(1) : null;
  return (
    <a className="tn-row tn-row-recent" href={`/match/${match.slug}`}>
      <div className="tn-row-head">
        <span className="tn-row-label">{meta}</span>
        {watch && <span className="tn-watch">Watch {watch}</span>}
      </div>
      <div className="tn-row-teams">
        <span className="tn-team">
          <FlagSlot
            flagSvgPath={match.home?.flag_svg_path}
            colorPrimary={match.home?.flag_color_primary}
            size="sm"
          />
          <NameSpan team={match.home} followedSet={followedSet} />
        </span>
        <span className="tn-score">{hs} to {as}</span>
        <span className="tn-team">
          <FlagSlot
            flagSvgPath={match.away?.flag_svg_path}
            colorPrimary={match.away?.flag_color_primary}
            size="sm"
          />
          <NameSpan team={match.away} followedSet={followedSet} />
        </span>
      </div>
    </a>
  );
}

function NextRow({ match, followedSet }) {
  return (
    <a className="tn-row tn-row-next" href={`/match/${match.slug}`}>
      <div className="tn-row-label">{fmtKickoffPt(match.kickoff_at)}</div>
      <div className="tn-row-teams">
        <span className="tn-team">
          <FlagSlot
            flagSvgPath={match.home?.flag_svg_path}
            colorPrimary={match.home?.flag_color_primary}
            size="sm"
          />
          <NameSpan team={match.home} followedSet={followedSet} />
        </span>
        <span className="tn-vs">v</span>
        <span className="tn-team">
          <FlagSlot
            flagSvgPath={match.away?.flag_svg_path}
            colorPrimary={match.away?.flag_color_primary}
            size="sm"
          />
          <NameSpan team={match.away} followedSet={followedSet} />
        </span>
      </div>
    </a>
  );
}

export default function TodayNextPanel({ recent, next, followedSet }) {
  const hasRecent = !!recent;
  const hasNext = Array.isArray(next) && next.length > 0;
  return (
    <section className="panel panel-today-next">
      <h2 className="phead">Today and Next</h2>
      <div className="pbody">
        {!hasRecent && !hasNext && (
          <p className="tn-empty">No followed fixtures today or upcoming.</p>
        )}
        {hasRecent && <RecentRow match={recent} followedSet={followedSet} />}
        {hasNext && next.map((m) => (
          <NextRow key={m.id} match={m} followedSet={followedSet} />
        ))}
      </div>
    </section>
  );
}
