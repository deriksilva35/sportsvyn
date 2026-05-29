/**
 * EdgePick — rail slot for Sportsvyn's editorial pick + reasoning.
 * No data path exists yet (no edge_picks table, no generator). Renders
 * null in the SHELL — block is HIDDEN, not shown empty, since absence is
 * more honest than a placeholder pick.
 */

export default function EdgePick({ pick = null }) {
  if (!pick) return null;

  return (
    <div className="edge-vertical">
      <div className="edge-vertical-label">Sportsvyn Edge Pick</div>
      <div className="edge-vertical-pick">
        {pick.text}
      </div>
      <div className="edge-vertical-reasoning">{pick.reasoning}</div>
    </div>
  );
}
