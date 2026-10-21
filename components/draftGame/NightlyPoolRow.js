// The Nightly Draft's pool row (wed-1b): ONE LINE of fixed columns -
// [jersey + position chip, fixed width] [name, then "vs OPP · tip PT · avg" under it, ellipsis]
// [Draft pill, 64px min, 44px tall]. A taken row is greyed, one line, "taken by Bot A · Rd 1",
// no button. An armed row wears a light lime tint; the confirm lives in the room's one
// sticky bar, so the pill only ever says "Draft". Presentational; the parent owns the tap.
import TeamMark from '@/components/team/TeamMark';
import { rowLine, takenLine } from '@/lib/draftGame/nightlyCopy';
import './nightly.css';

export const chipClass = (pos) => `nd-pos nd-pos--${String(pos).toLowerCase().replace(/[^a-z]/g, '').slice(0, 1)}`;

export default function NightlyPoolRow({ p, armed = false, disabled = false, onArm }) {
  const taken = Boolean(p.takenBy);
  return (
    <li className={`nd-row${taken ? ' nd-row--taken' : ''}${armed ? ' nd-row--armed' : ''}`} data-armed={armed ? '1' : undefined} data-taken={taken ? '1' : undefined}>
      <span className="nd-jersey">
        <TeamMark leagueSlug="nba" abbr={p.team} size={28} />
        <span className={chipClass(p.pos)}>{p.pos}</span>
      </span>
      <span className="nd-who">
        <b>{p.name}</b>
        <small>{taken ? takenLine(p) : rowLine(p)}</small>
      </span>
      {!taken && (
        <button type="button" className="nd-draft" disabled={disabled} onClick={onArm}>Draft</button>
      )}
    </li>
  );
}
