// components/gridiron/PlayoffPicture.js — the preseason title-odds edition inside
// The Playoff Picture frame. Renders the de-vigged championship field (top-N),
// team + implied % + a movement chip (hidden until a baseline accrues). Blank
// state (a dormant frame) when there are no futures rows — absence over inference.
// Ink surface, JetBrains Mono numbers.

import { probDirection, formatSignedPct } from '@/lib/gridiron/oddsFormat';

export default function PlayoffPicture({ contenders = [], leagueLabel = '', limit = null, href = null }) {
  const shown = limit ? contenders.slice(0, limit) : contenders;
  const has = shown.length > 0;
  const numBooks = has ? (shown.find((c) => c.numBooks)?.numBooks ?? null) : null;

  return (
    <section className="gi-instrument gi-pp" data-surface="ink">
      <div className="gi-instrument-h">The Playoff Picture</div>
      <div className="gi-pp-kicker">Preseason · the market&rsquo;s field</div>

      {!has ? (
        <div className="gi-pp-blank">The title market opens here once the books post {leagueLabel} futures.</div>
      ) : (
        <>
          <ol className="gi-pp-list">
            {shown.map((c) => {
              const dir = probDirection(c.moveProb);
              return (
                <li key={c.rank} className="gi-pp-row">
                  <span className="gi-pp-rank">{c.rank}</span>
                  <span className="gi-pp-team">{c.abbr || c.name}</span>
                  <span className="gi-pp-pct">
                    {c.impliedPct != null ? `${c.impliedPct.toFixed(1)}%` : '—'}
                    {dir !== 'flat' && (
                      <span className={`gi-pp-mv ${dir}`}>{dir === 'up' ? '▲' : '▼'} {formatSignedPct(c.moveProb)}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
          <div className="gi-pp-fine">
            De-vigged title odds{numBooks ? `, ${numBooks} books` : ''}. The projection turns results-driven after Week 1.
          </div>
          {href && <a className="gi-ed-full" href={href}>Full board →</a>}
        </>
      )}
    </section>
  );
}
