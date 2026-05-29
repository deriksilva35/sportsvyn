/**
 * WatchScoreVertical — rail slot for the Watch Score block (Option-C
 * v2-winprob locked layout).
 *
 * Data shape (from articles where type='preview' AND score_type='watch'):
 *   composite_score, stakes_score, quality_score, narrative_score,
 *   drama_score, moment_score (all numeric(3,1), arrive as strings from
 *   neon's driver — we Number() them before rendering).
 *
 * Tier mapping (no canonical mockup band table; using the band scheme
 * confirmed in chat):
 *   >= 8.0 → Must Watch
 *   6.5-7.9 → Worth Watching
 *   5.0-6.4 → Solid Watch
 *   < 5.0  → Niche
 *
 * Per-dimension notes (stakes_note etc.) are NOT rendered in the rail —
 * the locked mockup shows only score values per dimension. Notes are
 * reserved for tooltip / expand surfaces we haven't built yet.
 */

const DIMENSIONS = [
  ['Stakes',    'stakes_score'],
  ['Quality',   'quality_score'],
  ['Narrative', 'narrative_score'],
  ['Drama',     'drama_score'],
  ['Moment',    'moment_score'],
];

function tierFor(composite) {
  if (composite >= 8.0) return 'Must Watch';
  if (composite >= 6.5) return 'Worth Watching';
  if (composite >= 5.0) return 'Solid Watch';
  return 'Niche';
}

function num1(v) {
  if (v == null) return '—';
  return Number(v).toFixed(1);
}

export default function WatchScoreVertical({ score = null }) {
  if (!score) {
    return (
      <div className="ws-vertical is-empty" data-empty="watch-score">
        <div className="ws-vertical-kicker">Watch Score</div>
        <div className="slot-empty-body">
          Editorial Watch Score lands here once the analyst pass runs against
          this fixture.
        </div>
      </div>
    );
  }

  const composite = Number(score.composite_score);
  const tier = Number.isFinite(composite) ? tierFor(composite) : '';

  return (
    <div className="ws-vertical">
      <div className="ws-vertical-kicker">Watch Score</div>
      <div className="ws-vertical-score">{num1(score.composite_score)}</div>
      <div className="ws-vertical-tier">{tier}</div>
      <div className="ws-vertical-dims-label">Editorial Dimensions</div>
      {DIMENSIONS.map(([label, key]) => (
        <div key={key} className="ws-vertical-dim">
          <div className="ws-vertical-dim-label">{label}</div>
          <div className="ws-vertical-dim-value">{num1(score[key])}</div>
        </div>
      ))}
    </div>
  );
}
