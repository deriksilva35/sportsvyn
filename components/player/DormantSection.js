/**
 * DormantSection — consistent empty-state for player-page sections whose
 * data doesn't exist yet (pre-tournament, missing bio fields, no outlook
 * blurb generated yet, etc.).
 *
 * Renders a small panel inside the standard § Section shape — muted
 * graphite background, mono kicker, a short honest line. NO fake
 * numbers, NO placeholder bars. Visually quiet by design: signals
 * "intentionally waiting" rather than "broken blank".
 */
export default function DormantSection({ message }) {
  return (
    <div className="player-dormant">
      <div className="player-dormant-line">{message}</div>
    </div>
  );
}
