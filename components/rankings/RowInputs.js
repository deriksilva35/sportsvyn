// components/rankings/RowInputs.js - the working behind one ranked row.
//
// ONE COMPONENT, BOTH BOARDS. The NFL and CFB modules show the same four
// facts in the same order, and the only difference is that the NFL has no AP
// line to show. A second implementation per league is how two boards end up
// disagreeing about what their own numbers mean.
//
// IT READS THE STORED BLOB, NEVER RECOMPUTES. ranking_entries.inputs was
// frozen at publish time (migration 108) precisely so this panel shows what
// the published number was actually built from - not what the model would say
// if it ran again now, against results that have since moved on. If the blob
// is absent, which it is on every hand-seeded edition, the panel does not
// render at all rather than showing a row of dashes.
//
// NATIVE <details>, NO CLIENT BOUNDARY. The whole Rankings tab is a server
// component by ruling - every control on it is a link - and a disclosure is
// the one interaction the platform already does: open/closed state, keyboard
// and the accessible name all come free. The gamecast's drive chart made the
// same call for the same reason.
//
// "2 OF 5 DIMENSIONS" IS SAID OUT LOUD. A computed gridiron board can honestly
// answer result and momentum and cannot answer process, squad or coherence;
// the composite averages over the two it scored. A reader comparing this to a
// World Cup board that really does score five is entitled to know that.

const n2 = (v) => (v == null ? null : Number(v).toFixed(2));
const n1 = (v) => (v == null ? null : Number(v).toFixed(1));
const signed = (v) => (v == null ? null : `${Number(v) > 0 ? '+' : ''}${Number(v).toFixed(1)}`);

export default function RowInputs({ inputs = null, total = 5 }) {
  if (!inputs || inputs.elo == null) return null;
  const { elo, delta3, last3 = [], ap = null, editor = null, composite = null, weights = null, field = null } = inputs;
  return (
    <details className="rk-inputs">
      <summary>How this rank was computed</summary>
      <dl>
        <div><dt>Elo</dt><dd>{n2(elo)}{delta3 == null ? null : <small>{signed(delta3)} over the last three</small>}</dd></div>
        {last3.length ? (
          <div>
            <dt>Last three</dt>
            <dd className="rk-last3">
              {last3.map((g, i) => (
                // The key is the position: the same opponent can appear twice
                // in three games, so opp is not unique within this list.
                <span key={`${g.opp}-${i}`} className={`rk-res ${String(g.result).toLowerCase()}`}>
                  {g.result} <b>{g.margin}</b> {g.opp}
                </span>
              ))}
            </dd>
          </div>
        ) : null}
        {/* THE AP LINE IS CFB-ONLY, and it is absent rather than empty on the
            NFL, which has no poll at all. An unranked CFB team says so in
            words - a blank would read as a missing value. */}
        {ap ? (
          <div><dt>AP</dt><dd>#{ap.rank} <span className="rk-arrow">→</span> {n2(ap.score)} <small>curved over {field ? `the ${field}-team field` : 'the published field'}</small></dd></div>
        ) : null}
        {/* THE EDITOR'S LINE. It is a judgement, not a measurement, so it is
            labelled as one and it sits beside the poll rather than inside the
            arithmetic above it. Absent - not blank - for the 113 teams of a
            138-team field nobody put in a 25, and for every NFL row. */}
        {editor ? (
          <div><dt>Editor</dt><dd>#{editor.rank} <span className="rk-arrow">&rarr;</span> {n2(editor.score)} <small>this week&#39;s editor list</small></dd></div>
        ) : null}
        {/* THE COMPOSITE, WRITTEN OUT. A reader shown only the final number
            cannot check it; a reader shown "result 8.5 + editor 5.5 -> 7.0"
            can do the mean in their head, which is the whole point of a flat
            mean over a weighted one. */}
        {composite?.value != null ? (
          <div>
            <dt>Composite</dt>
            <dd>
              {(composite.dims ?? []).map((d, i) => (
                <span key={d}>{i ? ' + ' : ''}{d} {n1(composite.values?.[d])}</span>
              ))}
              {' '}<span className="rk-arrow">&rarr;</span> {n1(composite.value)}
              {(composite.dims ?? []).length === 1 ? <small>not in the editor&#39;s 25</small> : null}
            </dd>
          </div>
        ) : null}
        {weights ? (
          <div>
            <dt>Weights</dt>
            <dd>
              {weights.sites > 0 && ap
                ? `editorial ${n2(weights.editorial)} · AP ${n2(weights.sites)}`
                : `editorial ${n2(1)} · no second source to blend`}
            </dd>
          </div>
        ) : null}
        {/* THE CAVEAT, AND IT IS NOT OPTIONAL. Momentum is computed and shown
            above as the three-game swing, but it is NOT in the composite: a
            flat mean of result and momentum gave a hot three weeks half the
            ranking. process, squad and coherence a finished-games model
            cannot answer at all. */}
        <div><dt>Dimensions</dt><dd>result, of {total} <small>momentum is shown, not blended; process, squad and coherence are held</small></dd></div>
      </dl>
    </details>
  );
}

/** The movement glyph, and the rule for when there is one. Exported so the
 *  modules cannot each invent their own threshold. */
export function Movement({ previousRank = null, movement = null }) {
  // A GLYPH IFF previous_rank IS SET. previousRank answers "was this team on
  // the last edition" and movement answers "which way" - a team that HELD its
  // rank has movement 0 and must show a hold, which is not the same as the
  // nothing a new team shows.
  // THE GLYPHS ARE LITERAL, not entities. components/rankings/rankings.test.mjs
  // greps the tree for the arrow to prove exactly one component draws it, and
  // an entity would hide this file from its own guard.
  if (previousRank == null) return <span className="rk-mv new" aria-label="new this edition">–</span>;
  const m = Number(movement ?? 0);
  if (m > 0) return <span className="rk-mv up" aria-label={`up ${m}`}>▲{m}</span>;
  if (m < 0) return <span className="rk-mv dn" aria-label={`down ${-m}`}>▼{-m}</span>;
  return <span className="rk-mv hold" aria-label="unchanged">–</span>;
}

export { n1 };
