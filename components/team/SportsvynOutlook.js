/**
 * SportsvynOutlook — left col: editorial blurb (Source Serif italic, volt
 * left border). Right col: odds tiles (Tournament Winner + Next Match).
 *
 * Badge logic per spec: generation_tier='manual' renders "SPORTSVYN
 * EDITORIAL" in volt. Brief/draft tiers render "AUTO-GENERATED" in
 * paper-warm. This drives the trust signal in the byline.
 */

function relativeTime(date) {
  if (!date) return null;
  const then = new Date(date).getTime();
  const now = Date.now();
  const diffSec = Math.max(0, Math.round((now - then) / 1000));
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (diffSec < 60) return rtf.format(-diffSec, 'second');
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return rtf.format(-diffMin, 'minute');
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 48) return rtf.format(-diffHr, 'hour');
  const diffDay = Math.round(diffHr / 24);
  return rtf.format(-diffDay, 'day');
}

function BlurbCard({ team }) {
  if (!team.blurb_body) return null;

  const paragraphs = team.blurb_body
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const isManual = team.blurb_tier === 'manual';
  const badgeText = isManual ? 'Sportsvyn editorial' : 'Auto-generated';
  const badgeClass = isManual ? 'badge editorial' : 'badge';

  const updated = relativeTime(team.blurb_published_at);

  return (
    <div className="outlook-blurb">
      <div className="outlook-blurb-kicker">Sportsvyn Outlook</div>
      {paragraphs.map((p, i) => (
        <p key={i} className="outlook-blurb-prose">{p}</p>
      ))}
      <div className="outlook-blurb-byline">
        <span className={badgeClass}>{badgeText}</span>
        {updated && (
          <>
            <span className="sep">·</span>
            <span>Updated {updated}</span>
          </>
        )}
        {team.blurb_voice_version && (
          <>
            <span className="sep">·</span>
            <span>v{team.blurb_voice_version} voice model</span>
          </>
        )}
      </div>
    </div>
  );
}

function MovementChip({ movement }) {
  if (movement == null || movement === 0) {
    return <span className="val flat">— No change</span>;
  }
  if (movement > 0) {
    return <span className="val up">▲ +{movement}</span>;
  }
  return <span className="val down">▼ {movement}</span>;
}

function formatAmerican(n) {
  if (n == null) return '—';
  return n > 0 ? `+${n}` : `${n}`;
}

function OddsTile({ kicker, context, market, impliedLabel = 'Implied' }) {
  if (!market) return null;
  const books = market.source_books?.length
    ? `Avg of ${market.source_books.join(' · ')}`
    : null;
  return (
    <div className="odds-tile">
      <div className="odds-tile-kicker">{kicker}</div>
      {context && <div className="odds-tile-context">{context}</div>}
      <div className="odds-tile-row">
        <span className="odds-tile-american">{formatAmerican(market.american_odds)}</span>
        <div className="odds-tile-implied">
          <span className="odds-tile-implied-val">
            {market.implied_probability != null
              ? `${Number(market.implied_probability).toFixed(1)}%`
              : '—'}
          </span>
          <span className="odds-tile-implied-label">{impliedLabel}</span>
        </div>
      </div>
      <div className="odds-tile-mvmt">
        <span className="label">24h move</span>
        <MovementChip movement={market.movement_24h_odds} />
      </div>
      {books && <div className="odds-tile-source">{books}</div>}
    </div>
  );
}

export default function SportsvynOutlook({ team, odds, nextMatch }) {
  const hasBlurb = !!team.blurb_body;
  const hasOdds = !!(odds?.tournamentWinner || odds?.matchWinner);

  if (!hasBlurb && !hasOdds) return null;

  let matchContext = null;
  if (nextMatch) {
    const opp = nextMatch.opponent_short_name || nextMatch.opponent_name;
    const stageLabel = stageDisplay(nextMatch.stage);
    matchContext = opp ? `vs ${opp}${stageLabel ? ` · ${stageLabel}` : ''}` : stageLabel;
  }

  return (
    <section className="outlook-section">
      {hasBlurb && <BlurbCard team={team} />}
      {hasOdds && (
        <div className="outlook-odds">
          {odds.tournamentWinner && (
            <OddsTile
              kicker="Tournament Winner"
              context="Futures · Consensus"
              market={odds.tournamentWinner}
              impliedLabel="Implied"
            />
          )}
          {odds.matchWinner && (
            <OddsTile
              kicker={`Next Match${nextMatch?.stage ? ` · ${stageDisplay(nextMatch.stage)}` : ''}`}
              context={matchContext}
              market={odds.matchWinner}
              impliedLabel="To win"
            />
          )}
        </div>
      )}
    </section>
  );
}

export function stageDisplay(stage) {
  if (!stage) return null;
  const map = {
    group: 'Group',
    round_of_32: 'R32',
    round_of_16: 'R16',
    quarter: 'QF',
    semi: 'SF',
    third_place: '3rd Place',
    final: 'Final',
  };
  return map[stage] ?? stage;
}
