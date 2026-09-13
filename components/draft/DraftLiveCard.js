// components/draft/DraftLiveCard.js - the locked Draft card's eight rows.
//
// EXTRACTED FROM app/draft/page.js so the markup can be rendered and read
// without a session - the same reason WeeklyGrade and DraftGrade are
// components rather than branches of a page. The shape decisions all live in
// lib/draft/liveCard.js; this only draws them.
//
// A null `card` is the pre-live state: the picks are in, nothing has kicked
// off, and the card says what it always said - round, name, position.

import StandaloneTime from '@/components/StandaloneTime';

export default function DraftLiveCard({ card = null, roster = [] }) {
  const rows = card?.rows ?? roster.map((r) => ({ ...r, key: r.ffc ?? r.id, counting: true, state: null }));
  return (
    <div>
      {rows.map((r) => (
        <div className={`row${r.counting ? '' : ' row--dropped'}`} key={r.key} data-game={r.state?.kind}>
          <span>
            <span className="slot-tag">R{r.round}</span> {r.name}
            {/* THE SIX THAT COUNT ARE MARKED, not merely the two that do not.
                A reader should not have to infer membership from the absence
                of dimming. */}
            {r.counting && r.state ? <span className="dr-count" title="counts toward the best six">✓</span> : null}
            <span className="muted"> · {r.pos}</span>
            {r.team ? <span className="muted"> · {r.team}</span> : null}
            {r.state?.label ? <span className="muted"> · {r.state.label}</span> : null}
          </span>
          <span className={`r${r.state?.started ? '' : ' r--mut'}`}>
            {!r.state ? r.pos
              : r.state.started ? r.state.points
                : r.state.kickoffAt ? <StandaloneTime iso={r.state.kickoffAt} />
                  : r.state.kind === 'bye' ? 'bye' : '-'}
          </span>
        </div>
      ))}
      {/* .row .r is white-space:nowrap so the numbers never break; this line is
          prose, and without r--wrap it ran off the right edge of a phone
          instead of wrapping. */}
      <div className="row"><span>Results</span><span className="r r--mut r--wrap">Tuesday morning &middot; drop-worst applies at settle</span></div>
    </div>
  );
}
