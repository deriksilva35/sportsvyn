// app/scores/loading.js - the scoreboard's shape while the slate reads run.
// Same argument as the board's skeleton: force-dynamic reads leave a silent
// gap on navigation, and the acknowledgement is the page's own bones - date
// rail, chip strip, two card silhouettes.

import '@/components/gridiron/gridiron.css';

export default function LoadingScores() {
  return (
    <div className="gi" data-surface="ink" aria-busy="true" aria-label="Loading scores">
      <div className="gi-wrap">
        <div className="ldg-kicker" />
        <div className="ldg-strip" />
        <div className="ldg-strip ldg-strip--short" />
        <div className="ldg-cards">
          <div className="ldg-card" />
          <div className="ldg-card" />
        </div>
      </div>
    </div>
  );
}
