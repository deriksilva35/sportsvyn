'use client';

/**
 * components/games/ConfirmCard.js - THE confirm card. One component, both
 * ranked boards: /weekly renders it and /pickem/[sport] renders it.
 *
 * WHY IT IS SHARED (relay 3b item 1). Relay 3 item 3 built the same card
 * twice - two copies of the .wk-review/.wk-receipt markup, two Lock-it-in
 * buttons, two receipt notes - and they had already drifted before either
 * shipped: the Weekly's receipt listed the roster it had locked, the
 * Pick'em's listed nothing, so the two games disagreed about what a
 * receipt is for. The CSS was shared from the start; only the markup was
 * not. Now neither is duplicated.
 *
 * THE ANATOMY, and it is the same in both games:
 *   module wrapper   .wk-review before, .wk-receipt after
 *   summary          a roster list (Weekly) or a picked count (Pick'em)
 *   lock time        through StandaloneDate, so it is in the viewer's own
 *                    zone like every other clock on the screen (item 2)
 *   one volt button  "Lock it in" - the ONLY button on the card
 *   jade receipt     after, carrying the same summary it just locked
 *
 * IT DOES NOT SUBMIT ANYTHING, and the copy has to keep saying so.
 * Autosave is still the entire submit model on both boards: an entry that
 * is never confirmed counts at lock exactly the same as one that is. This
 * card writes entry.meta.confirmed_at and nothing else. It exists because
 * a save-on-every-tap game gives a reader no moment of "that is my
 * entry", not because the entry needs a second write to be real.
 */

import StandaloneDate from '@/components/StandaloneDate';
import './confirmCard.css';

export default function ConfirmCard({
  title,                 // review heading - "Your six", "Your board"
  rows = null,           // [{key, label, name}] roster summary, or null
  line = null,           // count summary shown BEFORE lock, or null
  receiptLine = null,    // count summary shown AFTER lock, or null
  lockIso = null,        // the instant this board locks
  lockPre = 'Locks',     // "Locks" | "First lock"
  note = null,           // receipt tail - what stays editable, and until when
  confirmedAt = null,
  confirming = false,
  onLockIn,
}) {
  const done = Boolean(confirmedAt);

  const summary = rows ? (
    <ol className="wk-receipt-list">
      {rows.map((r) => (
        <li key={r.key}>
          <span className="pos">{r.label}</span>
          <span className="nm">{r.name}</span>
        </li>
      ))}
    </ol>
  ) : null;

  // ONE CLAUSE, not two paragraphs: the count and the lock time belong on
  // the same line, and either half may be absent.
  const clause = (head) => (head || lockIso ? (
    <>
      {head}
      {head && lockIso ? ' · ' : null}
      {lockIso ? <>{head ? lockPre.toLowerCase() : lockPre} <StandaloneDate iso={lockIso} /></> : null}
    </>
  ) : null);

  if (done) {
    return (
      <div className="wk-receipt">
        <div className="wk-receipt-h">Locked in</div>
        {summary}
        <p className="wk-receipt-note">
          {clause(receiptLine)}{clause(receiptLine) ? '. ' : ''}{note}
        </p>
      </div>
    );
  }

  return (
    <div className="wk-review">
      <div className="wk-review-h">{title}</div>
      {summary}
      {clause(line) ? <p className="wk-review-note">{clause(line)}</p> : null}
      <button type="button" className="wk-lockin" disabled={confirming} onClick={onLockIn}>
        {confirming ? 'Locking…' : 'Lock it in'}
      </button>
    </div>
  );
}
