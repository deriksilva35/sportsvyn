/**
 * LiveWatchScore — rail card for the LIVE tab right column.
 *
 * Server component. Reads match_watch_score_history (written by the
 * poll-live cron's captureLiveWatchScoreTick) and renders a number +
 * trend + sparkline + caption + footer, inside the .rail-card chrome.
 *
 * State gating:
 *   - scheduled  → returns null (Preview tab owns the pre-match watch
 *                  score; this card is live/final only).
 *   - live       → latest tick composite, trend from kickoff baseline,
 *                  "Live Now" tag, redPulse animation via .live-card.
 *   - final      → peak composite (frozen), "Final · peaked at X.X",
 *                  no Live Now tag, no pulse.
 *
 * Caption: templated, factual — no "must-watch" / "worth your time"
 * recommendation verbs. Pattern: "{N} goal[s], {M} lead change[s] · {minute}'
 * played" for live, swap "final" at FT. Scoreless gets its own phrasing.
 *
 * Sparkline: SVG, volt line + fill gradient. X-axis = minute when every
 * tick has one, else tick index. Y-axis = composite, scaled to series
 * min/max (data-scaled — surfaces deflections better than a fixed 0-10).
 * Goal markers placed at indices where goals_count climbed from the
 * previous tick. Graceful thin-data: fewer than 3 ticks → no sparkline,
 * just number + trend + caption.
 */

import { sql } from '@/lib/db';

const WIDTH = 280;
const HEIGHT = 76;
const PAD_X = 2;
const PAD_TOP = 8;
const PAD_BOTTOM = 12;
const BASELINE_Y = HEIGHT - PAD_BOTTOM;

async function getWatchScoreHistory(matchId) {
  const rows = await sql`
    SELECT minute, minute_extra, status_short,
           home_score, away_score,
           goals_count, lead_changes,
           composite_score::float AS composite_score,
           recorded_at
      FROM match_watch_score_history
     WHERE match_id = ${matchId}
     ORDER BY recorded_at ASC, id ASC
  `;
  return rows;
}

function describeTrend(delta) {
  if (delta > 0.3)  return { glyph: '▲', label: 'Climbing', value: `+${delta.toFixed(1)} from kickoff` };
  if (delta < -0.3) return { glyph: '▼', label: 'Cooling',  value: `${delta.toFixed(1)} from kickoff` };
  return { glyph: '●', label: 'Steady', value: null };
}

function describeCaption({ status, goals, leadChanges, minute }) {
  let leftPart;
  if (goals === 0) {
    leftPart = 'Scoreless';
  } else {
    const goalsText = `${goals} goal${goals === 1 ? '' : 's'}`;
    if (leadChanges > 0) {
      leftPart = `${goalsText}, ${leadChanges} lead change${leadChanges === 1 ? '' : 's'}`;
    } else {
      leftPart = goalsText;
    }
  }
  const rightPart = status === 'final'
    ? 'final'
    : minute != null ? `${minute}' played` : 'in play';
  return `${leftPart} · ${rightPart}`;
}

// Build SVG point series. Returns null when there's not enough data to
// draw a meaningful curve — caller renders the rest of the card without
// the sparkline rather than emitting a degenerate one-point line.
function buildSparkline(series) {
  if (series.length < 3) return null;

  // X-domain: minute when every tick has one (typical mid-and-late-tick
  // series), else fall back to tick index for series that started before
  // API-Sports populated minute (early-tick warmup).
  const allHaveMinute = series.every((r) => r.minute != null);
  const xs = allHaveMinute ? series.map((r) => r.minute) : series.map((_, i) => i);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const xSpan = xMax - xMin || 1;

  // Y-domain: data-scaled. Shows the goal-deflection arc more clearly
  // than a fixed 0-10 scale where most of the chart sits in the middle.
  const ys = series.map((r) => r.composite_score);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const ySpan = yMax - yMin || 1;

  const drawableW = WIDTH - PAD_X * 2;
  const drawableH = HEIGHT - PAD_TOP - PAD_BOTTOM;

  const points = series.map((r, i) => ({
    x: PAD_X + ((xs[i] - xMin) / xSpan) * drawableW,
    y: PAD_TOP + drawableH - ((r.composite_score - yMin) / ySpan) * drawableH,
    goals: r.goals_count,
  }));

  // Goal markers: every index whose goals_count is strictly greater than
  // the prior tick's. lead_changes would also be a candidate signal but
  // goals_count is monotonically increasing (it never resets), so this
  // exactly matches "a goal was just scored on this tick."
  const goalMarkers = points.filter((p, i) => i > 0 && p.goals > points[i - 1].goals);

  return { points, goalMarkers };
}

function Sparkline({ data }) {
  const { points, goalMarkers } = data;
  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(' ');
  const last = points[points.length - 1];
  const first = points[0];
  const fillPath = `${linePath} L${last.x.toFixed(2)},${BASELINE_Y} L${first.x.toFixed(2)},${BASELINE_Y} Z`;

  return (
    <svg
      className="ws-spark"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Live Watch Score over time"
    >
      <defs>
        <linearGradient id="wsfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#D4FF00" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#D4FF00" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1="0" y1={BASELINE_Y} x2={WIDTH} y2={BASELINE_Y} stroke="#2E2E2E" strokeWidth="1" />
      <path d={fillPath} fill="url(#wsfill)" />
      <path
        d={linePath}
        fill="none"
        stroke="#D4FF00"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {goalMarkers.map((p, i) => (
        <circle
          key={`g${i}`}
          cx={p.x.toFixed(2)}
          cy={p.y.toFixed(2)}
          r="2.6"
          fill="#0A0A0A"
          stroke="#D4FF00"
          strokeWidth="1.5"
        />
      ))}
      <circle cx={last.x.toFixed(2)} cy={last.y.toFixed(2)} r="4" fill="#D4FF00" />
    </svg>
  );
}

export default async function LiveWatchScore({ match }) {
  if (match.status !== 'live' && match.status !== 'final') return null;

  const series = await getWatchScoreHistory(match.id);
  if (series.length === 0) return null;

  const isLive = match.status === 'live';
  const isFinal = match.status === 'final';

  let displayComposite;
  let trendNode;
  let captionSource;

  if (isLive) {
    const latest = series[series.length - 1];
    const baselineComposite = series[0].composite_score;
    const delta = latest.composite_score - baselineComposite;
    const trend = describeTrend(delta);
    displayComposite = latest.composite_score;
    captionSource = latest;
    trendNode = (
      <div className="ws-trend">
        <span aria-hidden="true">{trend.glyph}</span>
        <span>{trend.label}</span>
        {trend.value && <span>· {trend.value}</span>}
      </div>
    );
  } else {
    // Final: freeze on peak. Caption pulls from the FT row when present
    // (some ticks land status_short = '2H' at minute 90 before the FT row
    // arrives) so the goals_count + lead_changes reflect the settled
    // match, not whatever the second-to-last live tick saw.
    const peak = series.reduce(
      (max, r) => (r.composite_score > max ? r.composite_score : max),
      -Infinity,
    );
    const ftRow = series.find((r) => ['FT', 'AET', 'PEN'].includes(r.status_short));
    displayComposite = peak;
    captionSource = ftRow ?? series[series.length - 1];
    trendNode = (
      <div className="ws-trend">
        <span aria-hidden="true">●</span>
        <span>Final · peaked at {peak.toFixed(1)}</span>
      </div>
    );
  }

  const caption = describeCaption({
    status: match.status,
    goals: captionSource.goals_count,
    leadChanges: captionSource.lead_changes,
    minute: captionSource.minute,
  });

  const sparkline = buildSparkline(series);

  return (
    <div className={`rail-card${isLive ? ' live-card' : ''}`}>
      <div className="rail-card-head">
        <span className="rail-card-kicker">Live Watch Score</span>
        {isLive && (
          <span className="rail-now-tag">
            <span className="dot" />
            Live Now
          </span>
        )}
      </div>
      <div className="ws-body">
        <div className="ws-number-row">
          <span className="ws-number">{displayComposite.toFixed(1)}</span>
          <span className="ws-outof">/10</span>
        </div>
        {trendNode}
        {sparkline && <Sparkline data={sparkline} />}
        <p className="ws-caption">{caption}</p>
      </div>
      <div className="ws-footer">Updates every minute · peak preserved after full time</div>
    </div>
  );
}
