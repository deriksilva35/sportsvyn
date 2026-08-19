// app/nfl/fantasy/loading.js - the board's shape while its reads run.
//
// The page is force-dynamic behind a three-read await (the movement aggregate
// over 18k pool rows) - ~350ms at best, longer on device. With soft nav the
// old page stays painted, but NOTHING SIGNALS PROGRESS through that gap, and
// a tap with no acknowledgement reads as a stutter. This skeleton is the
// acknowledgement: the page's own bones - kicker, stat band, filter strip,
// sheet - in silhouette. Static shapes, no shimmer: a shimmer promises
// content per-block, and these blocks are placeholders for the layout, not
// the data.

import '@/components/gridiron/gridiron.css';
import '@/components/fantasy/fantasy.css';

export default function LoadingBoard() {
  return (
    <div data-surface="ink" aria-busy="true" aria-label="Loading the board">
      <div className="fb-wrap">
        <div className="ldg-kicker" />
        <div className="ldg-title" />
        <div className="ldg-band">
          {[0, 1, 2, 3].map((i) => <div className="ldg-stat" key={i} />)}
        </div>
        <div className="ldg-strip" />
        <div className="ldg-sheet">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <div className="ldg-row" key={i} />)}
        </div>
      </div>
    </div>
  );
}
