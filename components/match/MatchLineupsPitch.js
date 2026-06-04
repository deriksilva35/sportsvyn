'use client';

/**
 * MatchLineupsPitch — pitch-based render for the "Lineups & Injuries" tab.
 *
 * Locked spec (polish-lock pass item 7):
 *   - One team on the pitch at a time. HOME shown by default.
 *   - Segmented toggle: two buttons labeled with the team NAMES (not
 *     HOME/AWAY chips). Active button = volt fill on ink text.
 *   - Jerseys = number + surname, positioned via API-Sports grid coords
 *     (lib/lineups.js / match_lineups, migration 021). Always volt — one
 *     team at a time means there's no home/away color split to encode.
 *   - Below pitch: the shown team's starting XI as name + position list.
 *   - Graceful fallback when any grid coord is absent: skip the pitch,
 *     render the list alone. This is the likely state pre-poll-fill or
 *     on thin API-Sports payloads (some friendlies omit grid).
 *   - Mobile: toggle above a single vertical pitch + list, fits 390px.
 *
 * Bench: a "Substitutes" list renders UNDER the starting XI list when
 * the side carries bench players in the payload (lib/lineups.js groups
 * starting + bench into one `players` array with role). Bench stays
 * OFF the pitch — pitch is XI-only by design.
 *
 * Injuries: tab is labeled "Lineups & Injuries" but no injuries data
 * is wired anywhere yet (no API endpoint, no table, no cron). A small
 * "Injury report unavailable" stub renders at the bottom of the panel
 * so the tab label doesn't promise content the page doesn't show. When
 * an injuries slice lands, swap the stub for the real block.
 *
 * Surname source: API-Sports /fixtures/lineups returns only the full
 * `name` string per player — no shortname/displayname/lastname field.
 * Confirmed against lib/lineups.js's normalizePlayer + a live DEV
 * sample (Wales vs Ghana 2026-06-02). The last-token heuristic is the
 * best we have without an extra paid /players endpoint round-trip.
 * Known wrong for Brazilian/Portuguese mononyms ("Ronaldo Nazário" →
 * we render "Nazário", common shorthand is "Ronaldo") and compound
 * surnames where the meaningful name isn't the last token. Accepted
 * limitation; revisit if a curated player.short_name column lands.
 */

import { useState } from 'react';

// API-Sports grid format: "row:col" where row=1 is the goalkeeper line
// and increases toward the attacking goal. col is left-to-right rank
// within the row (col 1 = leftmost). We distribute players evenly
// across each row's horizontal slice rather than treating col as an
// absolute coordinate — col values aren't pixel-positions, they're
// positional ranks. Returns null if ANY starting player is missing a
// parseable grid, so the caller falls back to list-only.
function buildPitchPositions(starting) {
  if (!Array.isArray(starting) || starting.length === 0) return null;
  const parsed = [];
  for (const p of starting) {
    if (!p?.grid) return null;
    const m = String(p.grid).match(/^(\d+):(\d+)$/);
    if (!m) return null;
    parsed.push({
      ...p,
      row: parseInt(m[1], 10),
      col: parseInt(m[2], 10),
    });
  }
  const byRow = new Map();
  for (const p of parsed) {
    if (!byRow.has(p.row)) byRow.set(p.row, []);
    byRow.get(p.row).push(p);
  }
  const rows = Array.from(byRow.keys()).sort((a, b) => a - b);
  const minRow = rows[0];
  const maxRow = rows[rows.length - 1];
  const rowSpan = Math.max(1, maxRow - minRow);

  // y%: row 1 (GK) → 88% (bottom = defending goal). maxRow → 10% (top
  // = attacking goal). 10-88 leaves visual margin for jersey + surname
  // labels not to clip the goal line.
  // x%: 16-84 range (narrowed from 12-88), evenly distributed by col
  // rank within the row. Marker boxes are up to 68px wide (surname
  // max-width) and positioned with transform:translate(-50%,-50%);
  // at xPct=88 on a 328px pitch, the right edge sat at 322.6px —
  // only 5px of clearance. At a narrower pitch (different padding
  // chain, or first-paint state before media queries settle), that
  // 5px clearance flipped negative and the marker box extended past
  // the pitch's right edge into the document, pushing horizontal
  // overflow and forcing iOS Safari to open the layout viewport.
  // 16-84 gives the rightmost/leftmost markers ~12-13% of the pitch
  // width as buffer (43px on a 328 pitch) — more than half the marker
  // width — so the marker box always sits fully inside the pitch
  // regardless of which calculation rounding falls where. Visual
  // cost: outside defenders sit ~13px inboard of the touchline
  // instead of ~5px. Imperceptible at phone scale.
  const positions = [];
  for (const row of rows) {
    const players = byRow.get(row).sort((a, b) => a.col - b.col);
    const n = players.length;
    const yPct = 88 - ((row - minRow) / rowSpan) * 78;
    players.forEach((p, i) => {
      const xPct = n === 1 ? 50 : 16 + (i / (n - 1)) * 68;
      positions.push({ ...p, xPct, yPct });
    });
  }
  return positions;
}

// Surname extraction: last whitespace-separated token. API-Sports
// usually supplies "L. Messi" / "Mbappé" / "C. Ronaldo", so the
// last-token heuristic gets the right surname for ~95% of cases.
// Edge: Portuguese/Brazilian conventions where the *first* name is
// the mononym ("Ronaldo Nazário" → we'd take "Nazário", wrong) —
// accepted as a known limitation, no smart fallback here.
function surname(name) {
  if (!name) return '';
  const parts = String(name).trim().split(/\s+/);
  return parts[parts.length - 1];
}

function PitchMarker({ player }) {
  return (
    <div
      className="lineup-pitch-marker"
      style={{ left: `${player.xPct}%`, top: `${player.yPct}%` }}
    >
      <div className="lineup-jersey">{player.number ?? '—'}</div>
      <div className="lineup-surname">{surname(player.name)}</div>
    </div>
  );
}

function Pitch({ positions }) {
  return (
    <div className="lineup-pitch" role="img" aria-label="Lineup formation diagram">
      {/* Pitch markings as overlay SVG. viewBox 100x150 matches the
          container's 2:3 aspect-ratio so meet preserves proportion.
          Lines are rgba(paper, 0.15) — visible but ink-dominant. */}
      <svg
        className="lineup-pitch-markings"
        viewBox="0 0 100 150"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        {/* halfway line + center circle */}
        <line x1="0" y1="75" x2="100" y2="75" />
        <circle cx="50" cy="75" r="9" />
        <circle cx="50" cy="75" r="0.7" className="lineup-pitch-dot" />
        {/* top (attacking) goal — penalty box, goal box, penalty spot */}
        <rect x="30" y="0" width="40" height="20" />
        <rect x="40" y="0" width="20" height="8" />
        <circle cx="50" cy="13" r="0.7" className="lineup-pitch-dot" />
        {/* bottom (defending, GK side) — penalty box, goal box, penalty spot */}
        <rect x="30" y="130" width="40" height="20" />
        <rect x="40" y="142" width="20" height="8" />
        <circle cx="50" cy="137" r="0.7" className="lineup-pitch-dot" />
      </svg>
      {positions.map((p, i) => (
        <PitchMarker key={`${p.row}:${p.col}:${i}`} player={p} />
      ))}
    </div>
  );
}

function PlayerListRow({ p }) {
  return (
    <li className="lineup-list-row">
      <span className="lineup-list-num">{p.number ?? '—'}</span>
      <span className="lineup-list-name">{p.name}</span>
      {p.pos && <span className="lineup-list-pos">{p.pos}</span>}
    </li>
  );
}

function TeamToggle({ active, label, onClick }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`lineup-toggle${active ? ' active' : ''}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export default function MatchLineupsPitch({ lineups = null, homeName, awayName }) {
  const [side, setSide] = useState('home');

  if (!lineups) {
    return (
      <div className="tab-stub">Lineups &amp; injuries publish ~60 minutes before kickoff.</div>
    );
  }

  const current = side === 'home' ? lineups.home : lineups.away;
  const players = current?.players ?? [];
  const starting = players.filter((p) => p.role === 'starting');
  const bench = players.filter((p) => p.role === 'bench');
  const positions = buildPitchPositions(starting);
  const shownTeamName = side === 'home' ? homeName : awayName;

  return (
    <div className="match-lineups-pitch">
      <div className="lineup-toggle-row" role="tablist">
        <TeamToggle
          active={side === 'home'}
          label={homeName ?? 'Home'}
          onClick={() => setSide('home')}
        />
        <TeamToggle
          active={side === 'away'}
          label={awayName ?? 'Away'}
          onClick={() => setSide('away')}
        />
      </div>

      <div className="lineup-stage">
        <div className="lineup-stage-header">
          <span className="lineup-stage-shown-team">{shownTeamName ?? '—'}</span>
          {current?.formation && (
            <span className="lineup-stage-formation">{current.formation}</span>
          )}
        </div>

        {positions && positions.length > 0 ? (
          <Pitch positions={positions} />
        ) : (
          <div className="lineup-pitch-stub">
            Formation positions unavailable — showing starting XI as list only.
          </div>
        )}

        <div className="lineup-list-section">
          <div className="lineup-list-section-label">Starting XI</div>
          <ol className="lineup-list">
            {starting.length === 0 ? (
              <li className="lineup-list-empty">No starting XI published.</li>
            ) : (
              starting.map((p, i) => <PlayerListRow key={`s-${side}-${i}`} p={p} />)
            )}
          </ol>
        </div>

        {bench.length > 0 && (
          <div className="lineup-list-section">
            <div className="lineup-list-section-label">Substitutes</div>
            <ol className="lineup-list">
              {bench.map((p, i) => <PlayerListRow key={`b-${side}-${i}`} p={p} />)}
            </ol>
          </div>
        )}
      </div>

      {/* Honest gap: tab label still says "& Injuries" but injuries
          data isn't wired (no API, no table, no cron). Stub matches
          the null-stat tone so the page doesn't promise content it
          can't deliver. Replace with a real block when the injuries
          slice lands. */}
      <div className="lineup-injuries">
        <div className="lineup-injuries-label">Injuries</div>
        <div className="lineup-injuries-stub">Injury report unavailable.</div>
      </div>
    </div>
  );
}
