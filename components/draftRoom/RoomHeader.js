// components/draftRoom/RoomHeader.js - THE DRAFT LOOK's header (sun-3), shared by
// Game Drafts and the weekly Draft room: a navy card, a lime eyebrow, the title,
// an optional sub-line, and an optional right-hand slot (the weekly room's clock).
//
// Presentational only: no data, no hooks. Classes are Game Drafts' (app/draft/
// game/game.css, dgm-*), so one stylesheet carries the look everywhere.
import '@/app/draft/game/game.css';
import './draftRoom.css';

export default function RoomHeader({ eyebrow, title, sub = null, right = null, phase = null, titleProps = {} }) {
  return (
    <section className="dgm-hd" data-draft-room-header data-draft-game-phase={phase ?? undefined}>
      <div className="drm-hd-row">
        <div className="drm-hd-main">
          <div className="dgm-eyebrow">{eyebrow}</div>
          {title != null && <h1 className="dgm-hd-title" {...titleProps}>{title}</h1>}
          {sub != null && <div className="dgm-hd-sub">{sub}</div>}
        </div>
        {right != null && <div className="drm-hd-right">{right}</div>}
      </div>
    </section>
  );
}
