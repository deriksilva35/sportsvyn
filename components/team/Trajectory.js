/**
 * Trajectory — sparkline of team-power score across published editions, plus
 * an editorial archive list. Y-axis fixed at 6-10 to match the design's
 * composite range. Sparkline emits a polyline path + point circles, with the
 * current edition's point enlarged and stroked. Archive list renders one row
 * per edition with label/score/movement; per-edition blurb body is not in
 * scope here (seeded data has no ranking_row_blurb entries).
 *
 * Date column uses <LocalDate> client island for visitor-zone rendering
 * (was hardcoded ET). See components/LocalDate.js.
 */

import LocalDate from '@/components/LocalDate';

const Y_MIN = 6;
const Y_MAX = 10;
const X_LEFT = 40;
const X_RIGHT = 580;
const Y_TOP = 20;
const Y_BOTTOM = 140;

function scoreToY(score) {
  const clamped = Math.max(Y_MIN, Math.min(Y_MAX, Number(score)));
  const pct = (clamped - Y_MIN) / (Y_MAX - Y_MIN);
  return Y_BOTTOM - pct * (Y_BOTTOM - Y_TOP);
}

function buildPath(points) {
  return points
    .map(({ x, y }, i) => (i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`))
    .join(' ');
}

function Sparkline({ entries }) {
  if (entries.length < 2) return null;

  const scores = entries.map((e) => Number(e.score));
  const minScore = Math.min(...scores).toFixed(1);
  const maxScore = Math.max(...scores).toFixed(1);

  const span = X_RIGHT - X_LEFT;
  const points = entries.map((e, i) => ({
    x: X_LEFT + (span * i) / (entries.length - 1),
    y: scoreToY(e.score),
    score: Number(e.score),
    label: `ED ${e.edition_number}`,
    isCurrent: e.is_current,
  }));

  const path = buildPath(points);
  const currentPoint = points[points.length - 1];

  return (
    <div className="trajectory-chart">
      <div className="trajectory-chart-header">
        <span className="trajectory-chart-title">Composite over editions</span>
        <span className="trajectory-chart-range">Range: <span className="val">{minScore} — {maxScore}</span></span>
      </div>
      <svg viewBox="0 0 600 180" preserveAspectRatio="xMidYMid meet">
        <line x1={X_LEFT} y1={Y_TOP} x2={X_LEFT} y2={Y_BOTTOM} stroke="#2E2E2E" strokeWidth="1" />
        <line x1={X_LEFT} y1={Y_BOTTOM} x2={X_RIGHT} y2={Y_BOTTOM} stroke="#2E2E2E" strokeWidth="1" />

        <text x={X_LEFT - 8} y={Y_TOP + 6} fill="#888" fontFamily="var(--font-mono)" fontSize="9" textAnchor="end">10</text>
        <text x={X_LEFT - 8} y={(Y_TOP + Y_BOTTOM) / 2 + 4} fill="#888" fontFamily="var(--font-mono)" fontSize="9" textAnchor="end">8</text>
        <text x={X_LEFT - 8} y={Y_BOTTOM + 6} fill="#888" fontFamily="var(--font-mono)" fontSize="9" textAnchor="end">6</text>

        {points.map((p, i) => (
          <text
            key={`xl-${i}`}
            x={p.x}
            y={Y_BOTTOM + 20}
            fill={p.isCurrent ? '#D4FF00' : '#888'}
            fontFamily="var(--font-mono)"
            fontSize="8"
            textAnchor="middle"
          >
            {p.isCurrent ? 'NOW' : p.label}
          </text>
        ))}

        <path
          d={path}
          stroke="#D4FF00"
          strokeWidth="2.5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {points.map((p, i) => (
          <circle
            key={`pt-${i}`}
            cx={p.x}
            cy={p.y}
            r={p.isCurrent ? 5 : 3}
            fill="#D4FF00"
            stroke={p.isCurrent ? '#0A0A0A' : undefined}
            strokeWidth={p.isCurrent ? 2 : undefined}
          />
        ))}

        <text
          x={currentPoint.x}
          y={currentPoint.y - 8}
          fill="#D4FF00"
          fontFamily="var(--font-mono)"
          fontSize="10"
          fontWeight="700"
          textAnchor="end"
        >
          {currentPoint.score.toFixed(1)}
        </text>
      </svg>
    </div>
  );
}

function Archive({ entries }) {
  return (
    <div className="trajectory-archive">
      <div className="trajectory-archive-header">Editorial archive</div>
      {[...entries].reverse().map((e) => (
        <div key={e.entry_id} className="archive-row">
          <div className="archive-row-meta">
            <span className="edition">
              {e.is_current ? `${e.edition_label ?? `Edition ${e.edition_number}`} · Current` : (e.edition_label ?? `Edition ${e.edition_number}`)}
            </span>
            <span className="sep">·</span>
            <span className="score">{Number(e.score).toFixed(1)}</span>
            {e.published_at && (
              <>
                <span className="sep">·</span>
                <span><LocalDate iso={e.published_at} /></span>
              </>
            )}
            {e.rank_movement != null && e.rank_movement !== 0 && (
              <>
                <span className="sep">·</span>
                <span className={`movement ${e.rank_movement > 0 ? 'up' : 'down'}`}>
                  {e.rank_movement > 0 ? '▲' : '▼'} {Math.abs(e.rank_movement)}
                </span>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Trajectory({ entries }) {
  if (!entries?.length) return null;

  return (
    <section className="page-section" id="trajectory">
      <div className="section-head">
        <div className="section-head-left">
          <span className="section-head-num">§ Trajectory</span>
          <h2 className="section-head-title">Power Ranking <span className="accent">Over Time</span></h2>
        </div>
      </div>
      <div className="trajectory-wrap">
        <Sparkline entries={entries} />
        <Archive entries={entries} />
      </div>
    </section>
  );
}
