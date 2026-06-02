'use client';

/**
 * LiveHero — the locked v4 live banner. Replaces <TeamsHeader> during
 * status='live': graphite-on-live-red banner with absolute ● Live pill,
 * three-column grid (flag+name | huge score | flag+name), live-red minute
 * + half label, and a nested Win Probability strip.
 *
 * Same 60s polling cadence as the old LivePoller (which this component
 * supersedes); LivePoller has been removed. Pre-populates initialState
 * from the server's last-known DB values so the first paint shows real
 * data with no flash.
 *
 * Win-prob strip honesty (locked decision Q2): the percentages here are
 * the pre-kickoff consensus snapshot. refresh-odds excludes live matches
 * (its predicate is status='scheduled' AND kickoff_at within 10 days),
 * so the odds rows freeze the moment status flips to 'live'. The strip
 * is labelled "Market · Pre-kickoff consensus" and there is NO ● Live
 * badge — the mock's "Live" label is aspirational. A future live-recompute
 * slice would either change refresh-odds's predicate OR build an in-house
 * probability model from score + minute + pre-match prior, and only then
 * should this strip claim live-ness.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const PERIOD_LABELS = {
  '1H':   '1st Half',
  'HT':   'Half-time',
  '2H':   '2nd Half',
  'ET':   'Extra Time',
  'BT':   'Break',
  'P':    'Penalties',
  'SUSP': 'Suspended',
  'INT':  'Interrupted',
  'LIVE': '',
  'FT':   'Final',
  'AET':  'Final (AET)',
  'PEN':  'Final (PEN)',
};

function periodLabel(shortCode) {
  if (!shortCode) return '';
  return PERIOD_LABELS[shortCode] ?? '';
}

// 3-letter label for the win-prob bar segments. Prefer the team's
// abbreviation column (always 3 chars when populated); fall back to the
// first word of the name truncated to 3 uppercase chars. Mirrors the
// locked v4 mock pattern ("MAR" not "Morocco") so the away-side label
// never overflows its segment at narrower widths.
function shortLabel(abbr, name) {
  if (abbr) return abbr;
  if (!name) return '';
  return name.split(/\s+/)[0].slice(0, 3).toUpperCase();
}

function TeamCell({ name, flagSvg, leading }) {
  return (
    <div className={`live-team${leading ? ' leading' : ''}`}>
      {flagSvg ? (
        <span className="live-team-flag" aria-hidden="true">
          <img src={flagSvg} alt="" />
        </span>
      ) : (
        <span className="live-team-flag" aria-hidden="true" />
      )}
      <div className="live-team-name">{name ?? '—'}</div>
    </div>
  );
}

export default function LiveHero({
  fixtureId,
  initialState,
  homeName,
  awayName,
  homeFlagSvg,
  awayFlagSvg,
  homeAbbr,
  awayAbbr,
  winProbability = null,
}) {
  const [state, setState] = useState(initialState);
  const [error, setError] = useState(false);
  const router = useRouter();

  useEffect(() => {
    // No polling when status is terminal — the match is over, score and
    // events are frozen, the sync route would just trigger a needless
    // paid API-Sports call + DB write per tick. Mount-time check covers
    // the page-loaded-at-final case; the state.status dep covers the
    // live→final transition (when status flips to final mid-session,
    // the cleanup runs and the next pass returns early before starting
    // a new interval).
    if (state.status === 'final' || state.status === 'postponed' || state.status === 'cancelled') {
      return;
    }
    let cancelled = false;
    async function tick() {
      try {
        const res = await fetch(`/api/sync/fixture/${fixtureId}`, { cache: 'no-store' });
        if (!res.ok) { if (!cancelled) setError(true); return; }
        const data = await res.json();
        if (!cancelled) {
          setError(false);
          setState((prev) => ({ ...prev, ...data }));
          // Re-run the server tree so anything written to the DB by this
          // tick's syncFixture (events, score, status) flows into the
          // server-rendered components below — notably KeyMoments. The
          // page is already ƒ-dynamic; refresh is cheap and lets the
          // factual timeline feel live without a separate poller.
          router.refresh();
        }
      } catch {
        if (!cancelled) setError(true);
      }
    }
    const interval = setInterval(tick, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [fixtureId, router, state.status]);

  const home = state.home_score ?? 0;
  const away = state.away_score ?? 0;
  // Leading side derives from the score (live or final). Equal scores
  // (or scoreless draws at FT) → no leading highlight on either side.
  const leading = home > away ? 'home' : away > home ? 'away' : null;
  const period = periodLabel(state.status_short);
  const isFinalState = state.status === 'final';

  return (
    <div className="live-banner">
      {/* Indicator pill: pulsing red "Live" while in play; muted "Final"
          marker at FT (no pulse, no live-red). Keeps the same corner
          placement so the visual frame of the banner stays consistent
          across the two states. */}
      <div className={`live-indicator${isFinalState ? ' final' : ''}`}>
        {!isFinalState && <span className="live-dot" />}
        <span>{isFinalState ? 'Final' : 'Live'}</span>
      </div>

      <div className="live-score-row">
        <TeamCell name={homeName} flagSvg={homeFlagSvg} leading={leading === 'home'} />
        <div className="live-score-block">
          <div className="live-score">
            <span className={leading === 'home' ? 'leading' : undefined}>{home}</span>
            <span className="sep">—</span>
            <span className={leading === 'away' ? 'leading' : undefined}>{away}</span>
          </div>
          {/* Period line: at live we show "{minute}' · {period}" (e.g. "67' ·
              2nd Half"). At final there's no live minute clock — just the
              "Final" label (or "Final (AET)" / "Final (PEN)" when applicable). */}
          <div className="live-period">
            {!isFinalState && state.minute != null && (
              <>
                <span className="minute">{state.minute}&apos;</span>
                {period && <span> · </span>}
              </>
            )}
            {period && <span>{period}</span>}
          </div>
        </div>
        <TeamCell name={awayName} flagSvg={awayFlagSvg} leading={leading === 'away'} />
      </div>

      {winProbability && (
        <div className="winprob-banner">
          <div className="winprob-banner-label">
            <div>Win Probability</div>
          </div>
          {/* Bar shows pct-only inside each segment (and only when the
              segment is wide enough — drops the text below ~8% so a
              lopsided split like 82/12/6 doesn't clip into garbage).
              Legend row below carries the team-labeled values at full
              width regardless of segment size — mirrors the pre-match
              WinProbability rail's bar-plus-cells pattern. */}
          <div className="winprob-banner-bars-stack">
            <div
              className="winprob-banner-bars"
              role="img"
              aria-label="Pre-kickoff market win probability"
            >
              <div className="winprob-bar home" style={{ width: `${winProbability.home_pct}%` }}>
                {winProbability.home_pct >= 8 ? `${winProbability.home_pct.toFixed(0)}%` : ''}
              </div>
              <div className="winprob-bar draw" style={{ width: `${winProbability.draw_pct}%` }}>
                {winProbability.draw_pct >= 8 ? `${winProbability.draw_pct.toFixed(0)}%` : ''}
              </div>
              <div className="winprob-bar away" style={{ width: `${winProbability.away_pct}%` }}>
                {winProbability.away_pct >= 8 ? `${winProbability.away_pct.toFixed(0)}%` : ''}
              </div>
            </div>
            <div className="winprob-banner-legend">
              <span className="legend-home">
                {shortLabel(homeAbbr, homeName)} {winProbability.home_pct.toFixed(0)}%
              </span>
              <span className="legend-draw">
                Draw {winProbability.draw_pct.toFixed(0)}%
              </span>
              <span className="legend-away">
                {shortLabel(awayAbbr, awayName)} {winProbability.away_pct.toFixed(0)}%
              </span>
            </div>
          </div>
          <div className="winprob-banner-source">Market · Pre-kickoff consensus</div>
        </div>
      )}

      {error && <div className="live-banner-error">poll failed</div>}
    </div>
  );
}
