// components/draftRoom/SeatStrip.js - THE DRAFT LOOK's seat strip (sun-3).
//
// One tile per seat: You in lime, everyone else navy, each with a line under the
// name (Game Drafts: "2/4"; the weekly room: that seat's last pick). Four seats
// sit in a grid; twelve SCROLL sideways (`scroll`), and the tile on the clock is
// marked so the room can scroll it into view. Presentational only.
import '@/app/draft/game/game.css';
import './draftRoom.css';

export default function SeatStrip({ seats, scroll = false }) {
  return (
    <div className={scroll ? 'drm-strip' : 'dgm-tiles'} data-seat-strip={scroll ? 'scroll' : 'grid'}>
      {seats.map((s) => (
        <div key={s.key} className={`dgm-tile${s.you ? ' dgm-tile--you' : ''}${s.onClock ? ' drm-tile--clock' : ''}`}
          data-seat={s.key} data-on-clock={s.onClock ? '1' : undefined}>
          <b>{s.label}</b>
          <span className={s.numeric ? 'n' : 'drm-tile-sub'}>{s.sub}</span>
        </div>
      ))}
    </div>
  );
}
