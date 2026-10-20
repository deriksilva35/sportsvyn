// components/draftRoom/PoolRow.js - THE DRAFT LOOK's pool row (sun-3): position
// chip, name, a sub-line, and on the right either the pick pill or - once the
// player is gone - the drafter's name on a faded row. An ARMED row (the weekly
// room's tap-then-confirm) turns lime and its pill says "Confirm".
// Presentational only; the parent owns the click.
import '@/app/draft/game/game.css';
import './draftRoom.css';

export default function PoolRow({ pos, name, sub, takenBy = null, armed = false, label = 'Draft', onPick = null, disabled = false, small = true, mark = null }) {
  return (
    <li className={`dgm-prow${takenBy ? ' dgm-prow--taken' : ''}${armed ? ' drm-prow--armed' : ''}`} data-armed={armed ? '1' : undefined}>
      {mark}
      <span className={`dgm-pos dgm-pos--${String(pos).toLowerCase()}`}>{pos}</span>
      <span className="dgm-who">
        <b>{name}</b>
        <small>{sub}</small>
      </span>
      {takenBy ? (
        <span className="dgm-by">{takenBy}</span>
      ) : (
        <button type="button" className={`dgm-pill${small ? ' dgm-pill--sm' : ''}${armed ? ' dgm-pill--lime' : ''}`}
          disabled={disabled} onClick={onPick ?? undefined}>
          {armed ? 'Confirm' : label}
        </button>
      )}
    </li>
  );
}
