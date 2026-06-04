/**
 * MatchMetaStrip — graphite strip with stacked label+value pairs.
 * Per the Option-C mockup: Kickoff (in volt) · Venue · Stage · Referee · Weather.
 * Each item is omitted when its value is null — sparse data renders fewer items.
 *
 * Kickoff is rendered via the <KickoffTime> client island so it
 * displays in the VISITOR's local timezone (with zone abbreviation
 * appended). The previous hardcoded 'America/New_York' formatter
 * lived here as fmtKickoff — removed. See KickoffTime.js for the
 * SSR→local-time hydration strategy.
 */

import KickoffTime from './KickoffTime';

function MetaItem({ label, value, className = '' }) {
  if (value == null || value === '') return null;
  return (
    <div className="match-meta-item">
      <div className="match-meta-label">{label}</div>
      <div className={`match-meta-value ${className}`}>{value}</div>
    </div>
  );
}

const STAGE_DISPLAY = {
  group: 'Group',
  round_of_32: 'Round of 32',
  round_of_16: 'Round of 16',
  quarter: 'Quarterfinal',
  semi: 'Semifinal',
  third_place: '3rd Place',
  final: 'Final',
};

export default function MatchMetaStrip({ match }) {
  const stageLabel = match?.stage
    ? (STAGE_DISPLAY[match.stage] ?? match.stage) +
      (match.group_code ? ` · Group ${match.group_code}` : '')
    : 'Friendly';

  return (
    <div className="match-meta-strip">
      <MetaItem
        label="Kickoff"
        value={match?.kickoff_at ? <KickoffTime kickoffAt={match.kickoff_at} /> : null}
        className="volt"
      />
      <MetaItem label="Venue" value={match?.venue} />
      <MetaItem label="Stage" value={stageLabel} />
    </div>
  );
}
