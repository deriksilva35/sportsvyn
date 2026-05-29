/**
 * MatchMetaStrip — graphite strip with stacked label+value pairs.
 * Per the Option-C mockup: Kickoff (in volt) · Venue · Stage · Referee · Weather.
 * Each item is omitted when its value is null — sparse data renders fewer items.
 */

function fmtKickoff(d) {
  if (!d) return null;
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
    timeZoneName: 'short',
  }).format(new Date(d));
}

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
      <MetaItem label="Kickoff" value={fmtKickoff(match?.kickoff_at)} className="volt" />
      <MetaItem label="Venue" value={match?.venue} />
      <MetaItem label="Stage" value={stageLabel} />
    </div>
  );
}
