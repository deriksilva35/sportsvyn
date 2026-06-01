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

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const res = await fetch(`/api/sync/fixture/${fixtureId}`, { cache: 'no-store' });
        if (!res.ok) { if (!cancelled) setError(true); return; }
        const data = await res.json();
        if (!cancelled) {
          setError(false);
          setState((prev) => ({ ...prev, ...data }));
        }
      } catch {
        if (!cancelled) setError(true);
      }
    }
    const interval = setInterval(tick, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [fixtureId]);

  const home = state.home_score ?? 0;
  const away = state.away_score ?? 0;
  // Leading side derives from the live score, not from pre-match
  // probability. Equal scores → no leading highlight on either side.
  const leading = home > away ? 'home' : away > home ? 'away' : null;
  const period = periodLabel(state.status_short);

  return (
    <div className="live-banner">
      <div className="live-indicator">
        <span className="live-dot" />
        <span>Live</span>
      </div>

      <div className="live-score-row">
        <TeamCell name={homeName} flagSvg={homeFlagSvg} leading={leading === 'home'} />
        <div className="live-score-block">
          <div className="live-score">
            <span className={leading === 'home' ? 'leading' : undefined}>{home}</span>
            <span className="sep">—</span>
            <span className={leading === 'away' ? 'leading' : undefined}>{away}</span>
          </div>
          <div className="live-period">
            <span className="minute">{state.minute != null ? `${state.minute}'` : '—'}</span>
            {period && <span> · {period}</span>}
          </div>
        </div>
        <TeamCell name={awayName} flagSvg={awayFlagSvg} leading={leading === 'away'} />
      </div>

      {winProbability && (
        <div className="winprob-banner">
          <div className="winprob-banner-label">
            <div>Win Probability</div>
          </div>
          <div
            className="winprob-banner-bars"
            role="img"
            aria-label="Pre-kickoff market win probability"
          >
            <div className="winprob-bar home" style={{ width: `${winProbability.home_pct}%` }}>
              {shortLabel(homeAbbr, homeName)} {winProbability.home_pct.toFixed(0)}%
            </div>
            <div className="winprob-bar draw" style={{ width: `${winProbability.draw_pct}%` }}>
              Draw {winProbability.draw_pct.toFixed(0)}%
            </div>
            <div className="winprob-bar away" style={{ width: `${winProbability.away_pct}%` }}>
              {shortLabel(awayAbbr, awayName)} {winProbability.away_pct.toFixed(0)}%
            </div>
          </div>
          <div className="winprob-banner-source">Market · Pre-kickoff consensus</div>
        </div>
      )}

      {error && <div className="live-banner-error">poll failed</div>}
    </div>
  );
}
