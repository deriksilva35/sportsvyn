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

// StatValue — shared null-state renderer for any stat cell.
// CRITICAL: gates on value == null ONLY (not falsiness) so a real 0
// (e.g. OFFSIDES 0) renders in the normal color, not the muted null
// state. The inner span's color rule wins over the parent .home/.away
// color for null cells via .stat-value--null; non-null cells inherit
// the parent's color (home=volt, away=paper-warm). See match.css.
function StatValue({ v }) {
  if (v == null) {
    return <span className="stat-value stat-value--null">—</span>;
  }
  return <span className="stat-value">{v}</span>;
}

// Composite-string formatter for the multi-field stats (Passes ·
// accuracy, Fouls · Y · R). Returns null when the primary count is
// missing so StatValue handles the null-state render. Real 0 in any
// subfield stays as a numeric — the formatter only nulls when the
// LEAD field is absent.
function passesText(count, pct) {
  if (count == null) return null;
  return pct != null ? `${count} · ${pct}` : String(count);
}
function foulsText(fouls, yellows, reds) {
  if (fouls == null) return null;
  return `${fouls} · ${yellows ?? 0} · ${reds ?? 0}`;
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
        <span className="home"><StatValue v={homeValue} /></span>
        <span className="away"><StatValue v={awayValue} /></span>
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

  // Passes (count · accuracy). passesText returns null when count is
  // null so the cell renders the muted null state instead of "— / —".
  const passesHome = passesText(h['Total passes'], h['Passes %']);
  const passesAway = passesText(a['Total passes'], a['Passes %']);

  // Fouls · Yellow · Red (combined row). foulsText returns null when
  // fouls is absent; real 0 in any subfield renders normally.
  const foulsHome = foulsText(h['Fouls'], h['Yellow Cards'], h['Red Cards']);
  const foulsAway = foulsText(a['Fouls'], a['Yellow Cards'], a['Red Cards']);

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
        homeValue={h['Total Shots']}
        awayValue={a['Total Shots']}
      />

      <StatCluster
        label="On Target"
        homeValue={h['Shots on Goal']}
        awayValue={a['Shots on Goal']}
      />

      <StatCluster
        label="Blocked"
        homeValue={h['Blocked Shots']}
        awayValue={a['Blocked Shots']}
      />

      <StatCluster
        label="Saves"
        homeValue={h['Goalkeeper Saves']}
        awayValue={a['Goalkeeper Saves']}
      />

      <StatCluster
        label="Passes (accuracy)"
        homeValue={passesHome}
        awayValue={passesAway}
      />

      <StatCluster
        label="Corners"
        homeValue={h['Corner Kicks']}
        awayValue={a['Corner Kicks']}
      />

      <StatCluster
        label="Offsides"
        homeValue={h['Offsides']}
        awayValue={a['Offsides']}
      />

      <StatCluster
        label="Fouls · Yellow · Red"
        homeValue={foulsHome}
        awayValue={foulsAway}
      />
    </div>
  );
}
