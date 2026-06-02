/**
 * MatchStats — Full Match Stats panel for the LIVE tab right rail.
 *
 * Reads from match_statistics (migration 023, written by the poll-live
 * cron via lib/statistics.js). Server component — receives the home + away
 * stats objects as a prop from app/match/[slug]/page.js's Promise.all.
 * Refresh cadence comes from LiveHero.js calling router.refresh() after
 * each successful tick, so new values flow into the panel without a reload.
 *
 * Renders the locked v4 mock's .live-stats block:
 *   - Header: "Full Match Stats · {minute}'" (when live)
 *   - Possession cluster with side-by-side bar + percentages
 *   - Expected Goals cluster with bar (HIDES when null on both sides —
 *     friendlies on the current API plan return null xG)
 *   - Counts: Total Shots, On Target, Blocked, Saves, Passes (accuracy),
 *     Corners, Offsides, Fouls · Yellow · Red
 *
 * Value parsing handles the mixed-type API:
 *   - integers ("Total Shots": 13)
 *   - percentage strings ("Ball Possession": "45%")
 *   - null (unavailable stat, render '—')
 *
 * Graceful empty: when stats === null (no current rows for the match),
 * renders a small tab-stub. Mirrors MatchLineups' empty pattern.
 */

function parsePercent(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const s = String(value).trim();
  const m = s.match(/^(\d+(?:\.\d+)?)\s*%?$/);
  return m ? Number(m[1]) : null;
}

function num(value) {
  if (value == null) return '—';
  if (typeof value === 'number') return String(value);
  return String(value);
}

function StatBar({ homePct, awayPct }) {
  // Defensive: clamp so a bad sum doesn't overflow the row.
  const h = Math.max(0, Math.min(100, homePct ?? 0));
  const a = Math.max(0, Math.min(100, awayPct ?? 0));
  return (
    <div className="stat-bar" role="img" aria-label="Comparative stat bar">
      <div className="stat-bar-home" style={{ width: `${h}%` }} />
      <div className="stat-bar-away" style={{ width: `${a}%` }} />
    </div>
  );
}

function StatCluster({ label, homeValue, awayValue, bar = null }) {
  return (
    <div className="stat-cluster">
      <div className="stat-row">
        <div className="label">{label}</div>
      </div>
      {bar}
      <div className="stat-vals">
        <span className="home">{homeValue}</span>
        <span className="away">{awayValue}</span>
      </div>
    </div>
  );
}

export default function MatchStats({ stats = null, minute = null }) {
  if (!stats) {
    return <div className="tab-stub">Match stats populate once play begins.</div>;
  }

  const h = stats.home ?? {};
  const a = stats.away ?? {};

  // Possession (string "45%" → number)
  const homePoss = parsePercent(h['Ball Possession']);
  const awayPoss = parsePercent(a['Ball Possession']);
  const hasPoss = homePoss != null && awayPoss != null;

  // Expected Goals — sometimes null (friendlies). Only render when both
  // present; otherwise the row hides cleanly.
  const homeXg = h['expected_goals'] != null ? Number(h['expected_goals']) : null;
  const awayXg = a['expected_goals'] != null ? Number(a['expected_goals']) : null;
  const hasXg = homeXg != null && awayXg != null && Number.isFinite(homeXg) && Number.isFinite(awayXg);
  const totalXg = hasXg ? homeXg + awayXg : 0;
  const homeXgPct = hasXg && totalXg > 0 ? (homeXg / totalXg) * 100 : 0;
  const awayXgPct = hasXg && totalXg > 0 ? (awayXg / totalXg) * 100 : 0;

  // Passes (count · accuracy)
  const homePasses = h['Total passes'];
  const awayPasses = a['Total passes'];
  const homePassPct = h['Passes %'];
  const awayPassPct = a['Passes %'];
  const passesHome = homePasses != null ? `${homePasses}${homePassPct ? ' · ' + homePassPct : ''}` : '—';
  const passesAway = awayPasses != null ? `${awayPasses}${awayPassPct ? ' · ' + awayPassPct : ''}` : '—';

  // Fouls · Yellow · Red (combined row)
  const foulsHome = `${num(h['Fouls'])} · ${num(h['Yellow Cards'] ?? 0)} · ${num(h['Red Cards'] ?? 0)}`;
  const foulsAway = `${num(a['Fouls'])} · ${num(a['Yellow Cards'] ?? 0)} · ${num(a['Red Cards'] ?? 0)}`;

  const headerSuffix = minute != null ? ` · ${minute}'` : '';

  return (
    <div className="live-stats">
      <div className="live-stats-header">Full Match Stats{headerSuffix}</div>

      {hasPoss && (
        <StatCluster
          label="Possession"
          homeValue={`${homePoss.toFixed(0)}%`}
          awayValue={`${awayPoss.toFixed(0)}%`}
          bar={<StatBar homePct={homePoss} awayPct={awayPoss} />}
        />
      )}

      {hasXg && (
        <StatCluster
          label="Expected Goals"
          homeValue={homeXg.toFixed(2)}
          awayValue={awayXg.toFixed(2)}
          bar={<StatBar homePct={homeXgPct} awayPct={awayXgPct} />}
        />
      )}

      <StatCluster
        label="Total Shots"
        homeValue={num(h['Total Shots'])}
        awayValue={num(a['Total Shots'])}
      />

      <StatCluster
        label="On Target"
        homeValue={num(h['Shots on Goal'])}
        awayValue={num(a['Shots on Goal'])}
      />

      <StatCluster
        label="Blocked"
        homeValue={num(h['Blocked Shots'])}
        awayValue={num(a['Blocked Shots'])}
      />

      <StatCluster
        label="Saves"
        homeValue={num(h['Goalkeeper Saves'])}
        awayValue={num(a['Goalkeeper Saves'])}
      />

      <StatCluster
        label="Passes (accuracy)"
        homeValue={passesHome}
        awayValue={passesAway}
      />

      <StatCluster
        label="Corners"
        homeValue={num(h['Corner Kicks'])}
        awayValue={num(a['Corner Kicks'])}
      />

      <StatCluster
        label="Offsides"
        homeValue={num(h['Offsides'])}
        awayValue={num(a['Offsides'])}
      />

      <StatCluster
        label="Fouls · Yellow · Red"
        homeValue={foulsHome}
        awayValue={foulsAway}
      />
    </div>
  );
}
