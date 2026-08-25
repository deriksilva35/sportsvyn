import {
  stripGeometry, downDistanceLabel, spotLabel, driveSubLine,
  pctForAbsolute, ENDZONE_PCT,
} from '@/lib/gridiron/driveStrip';

/**
 * The DriveStrip, per docs/design/sportsvyn-drivestrip-gamecast-mock-v0_2.html.
 *
 * ALL GEOMETRY COMES FROM lib/gridiron/driveStrip.js - not one percentage is
 * written by hand in this file. The mock hard-codes ~200 field elements at
 * literal offsets; reproducing those literals here would be a second source of
 * truth for where a yard line sits, and the first thing to rot when the field
 * changes height or the end zone changes width. FIELD_MARKS below generates
 * exactly the marks the mock draws, from the same function that places the ball.
 *
 * Server component. No clock ticks, no client state - the strip renders a
 * SNAPSHOT, which is the same discipline liveChip() applies to the scoreboard.
 */

// Every 10 yards: a full line carrying its number. Every 5: a short tick.
// Every remaining yard: a pair of hash marks. Generated, never transcribed.
function fieldMarks() {
  const lines = [], ticks = [], hashes = [];
  for (let y = 0; y <= 100; y += 1) {
    const left = pctForAbsolute(y);
    if (y % 10 === 0) {
      if (y === 0 || y === 100) continue;          // goal lines are the end-zone edges
      lines.push({ left, label: y > 50 ? 100 - y : y, mid: y === 50 });
    } else if (y % 5 === 0) {
      ticks.push({ left });
    } else {
      hashes.push({ left });
    }
  }
  return { lines, ticks, hashes };
}
const FIELD_MARKS = fieldMarks();

function Field({ geometry, homeAbbr, awayAbbr }) {
  return (
    <div className="ds-field">
      <div className="ds-zone l" style={{ width: `${ENDZONE_PCT}%` }}><span>{homeAbbr}</span></div>
      <div className="ds-zone r" style={{ width: `${ENDZONE_PCT}%` }}><span>{awayAbbr}</span></div>
      {FIELD_MARKS.lines.map((m) => (
        <span key={`l${m.left}`}>
          <i className={`ds-tick${m.mid ? ' mid' : ''}`} style={{ left: `${m.left}%` }} />
          <i className="ds-num" style={{ left: `${m.left}%` }}>{m.label}</i>
        </span>
      ))}
      {FIELD_MARKS.ticks.map((m) => (
        <i key={`t${m.left}`} className="ds-tick five" style={{ left: `${m.left}%` }} />
      ))}
      {FIELD_MARKS.hashes.map((m) => (
        <span key={`h${m.left}`}>
          <i className="ds-hash" style={{ left: `${m.left}%`, top: '20px' }} />
          <i className="ds-hash" style={{ left: `${m.left}%`, top: '34px' }} />
        </span>
      ))}
      {geometry?.drive && (
        <i className="ds-span" style={{ left: `${geometry.drive.left}%`, width: `${geometry.drive.width}%` }} />
      )}
      {geometry?.toGo != null && <i className="ds-togo" style={{ left: `${geometry.toGo}%` }} />}
      {geometry?.ball != null && <i className="ds-ball" style={{ left: `${geometry.ball}%` }} />}
    </div>
  );
}

/**
 * THE STRIP. One component, every state - the mock's frames 1 and 3 are modes
 * of the same thing, not three components.
 */
export function DriveStrip({ state, lastPlay, drive, homeAbbr, awayAbbr, offenseAbbr, defenseAbbr, simulated }) {
  if (state.mode === 'none' || state.mode === 'final') return null;

  // THE HONEST GAP. No play data means the strip says so - it does not draw an
  // empty field and let the reader infer a game with no plays in it.
  if (state.mode === 'pending') {
    return (
      <div className="ds-strip pending">
        <div className="ds-top"><div className="ds-dd quiet">Play data pending</div></div>
        <div className="ds-foot"><span>Score and clock are live above</span></div>
      </div>
    );
  }

  // Halftime drops the field entirely rather than draw a stale ball on it.
  if (state.mode === 'halftime') {
    return (
      <div className="ds-strip quietbg">
        <div className="ds-top"><div className="ds-dd quiet">Halftime</div></div>
      </div>
    );
  }

  const dd = downDistanceLabel(lastPlay?.down, lastPlay?.distance, lastPlay?.yardsToGoal);
  const spot = spotLabel(lastPlay?.yardsToGoal, offenseAbbr, defenseAbbr);
  const geometry = state.mode === 'between' ? null : stripGeometry({
    offenseIsHome: drive?.offenseIsHome ?? false,
    yardsToGoal: lastPlay?.yardsToGoal,
    distance: lastPlay?.distance,
    driveStartYardsToGoal: drive?.startYardsToGoal,
  });

  return (
    <div className={`ds-strip${state.mode === 'between' ? ' quietbg' : ''}`}>
      <div className="ds-top">
        <div className={`ds-dd${state.mode === 'between' ? ' quiet' : ''}`}>
          {state.mode === 'between' ? 'Between drives' : (dd ?? '—')}
        </div>
        {spot && state.mode !== 'between' && (
          <div className="ds-at">at <b>{spot}</b>{offenseAbbr ? ` · ${offenseAbbr} ball` : ''}</div>
        )}
      </div>
      <Field geometry={geometry} homeAbbr={homeAbbr} awayAbbr={awayAbbr} />
      <div className="ds-foot">
        <span>
          {drive
            ? <>Drive: <b>{drive.playCount} plays{drive.yards != null ? `, ${drive.yards} yds` : ''}</b>{drive.duration ? ` · ${drive.duration}` : ''}</>
            : <>Drive in progress</>}
        </span>
        {/* NO WIN PROBABILITY. The mock draws a win-prob rail; neither provider
            gives us one on this path and inventing a percentage would be the
            most confident lie on the page. The rail returns when a real number
            does. */}
        {simulated && <span className="ds-sim">simulated</span>}
      </div>
    </div>
  );
}

/** The mock's "Last play" card - the sentence the strip cannot say. */
export function LastPlay({ play }) {
  if (!play?.text) return null;
  return (
    <div className="ds-lastplay">
      <div className="lbl">Last play</div>
      <div className="txt">{play.text}</div>
    </div>
  );
}

const TAG_CLASS = {
  'Touchdown': 'td', 'Field goal': 'fg', 'Punt': 'punt', 'Turnover': 'to',
  'Downs': 'to', 'Missed FG': 'to', 'Safety': 'to', 'In progress': 'td',
};

/**
 * THE DRIVE CHART - frame 2, and the part of this build that carries no live
 * dependency at all. Every drive of a completed game, newest first, with its
 * plays beneath.
 */
export function DriveChart({ rows, expandFirst = true, teamAbbr = new Map(), homeTeamId }) {
  if (!rows?.length) {
    return <div className="ds-empty">No play-by-play stored for this game.</div>;
  }
  return (
    <div className="ds-chart">
      <div className="ds-eyebrow">
        <span>Drive chart</span>
        <span className="mono">{rows.length} drives</span>
      </div>
      {rows.map((d, i) => {
        const defenseAbbr = [...teamAbbr.entries()]
          .find(([id]) => id !== d.offenseTeamId)?.[1] ?? null;
        return (
          <div className="ds-drive" key={d.driveId}>
            <div className="dh">
              <div className="who">
                {i === 0 && <span className="dot">●</span>}{d.offenseAbbr ?? '—'}
              </div>
              {/* An untagged drive shows NO tag rather than a guessed one - see
                  bdlDriveResult()'s conservative fallthrough. */}
              {d.result && <span className={`tag ${TAG_CLASS[d.result] ?? 'punt'}`}>{d.result}</span>}
            </div>
            <div className="dsub">{driveSubLine(d, defenseAbbr)}</div>
            {(expandFirst ? i === 0 : false) && (
              <div className="plays">
                {d.plays.map((p) => (
                  <div className={`play${p.scoring ? ' score' : ''}`} key={p.providerPlayId}>
                    <span className="dn">{downDistanceLabel(p.down, p.distance, p.yardsToGoal) ?? '—'}</span>
                    <span className="pt">{p.text}</span>
                    <span className={`yd ${p.yardsGained > 0 ? 'pos' : p.yardsGained < 0 ? 'neg' : 'zero'}`}>
                      {p.yardsGained == null ? '—' : `${p.yardsGained > 0 ? '+' : ''}${p.yardsGained}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
