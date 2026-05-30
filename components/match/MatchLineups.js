/**
 * MatchLineups — body of the "Lineups & Injuries" tab.
 *
 * Renders the current home + away lineups from match_lineups (cron-fed
 * via /api/cron/poll-lineups). Each side: formation chip, starting XI,
 * bench. Two-column grid on desktop, stacks on narrow widths via the
 * .match-lineups responsive rules in match.css.
 *
 * Injuries deferred — the tab label still says "Lineups & Injuries" but
 * only lineups are present until the injuries slice lands. Acceptable
 * honest degradation; no fake injury data.
 *
 * Graceful empty: when lineups === null (cron hasn't seen API-Sports
 * publish them yet, or the match is far from kickoff), renders the
 * existing tab-stub treatment.
 */

function relativeTime(date) {
  if (!date) return null;
  const then = new Date(date).getTime();
  if (Number.isNaN(then)) return null;
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

function PlayerRow({ player }) {
  return (
    <div className="lineup-player">
      <span className="num">{player.number ?? '—'}</span>
      <span className="name">{player.name}</span>
      {player.pos && <span className="pos">{player.pos}</span>}
    </div>
  );
}

function LineupColumn({ teamName, side }) {
  const players = side?.players ?? [];
  const starting = players.filter((p) => p.role === 'starting');
  const bench = players.filter((p) => p.role === 'bench');
  return (
    <div className="lineup-column">
      <div className="lineup-header">
        <div className="lineup-team">{teamName ?? '—'}</div>
        {side?.formation && <div className="lineup-formation">{side.formation}</div>}
      </div>
      <div className="lineup-section">
        <div className="lineup-section-label">Starting XI</div>
        {starting.length === 0 ? (
          <div className="lineup-empty">—</div>
        ) : (
          starting.map((p, i) => <PlayerRow key={`s-${i}`} player={p} />)
        )}
      </div>
      {bench.length > 0 && (
        <div className="lineup-section">
          <div className="lineup-section-label">Bench</div>
          {bench.map((p, i) => <PlayerRow key={`b-${i}`} player={p} />)}
        </div>
      )}
    </div>
  );
}

export default function MatchLineups({ lineups = null, homeName, awayName }) {
  if (!lineups) {
    return (
      <div className="tab-stub">Lineups &amp; injuries publish ~60 minutes before kickoff.</div>
    );
  }

  const reltime = relativeTime(lineups.fetched_at);

  return (
    <div className="match-lineups">
      <div className="match-lineups-meta">
        Confirmed lineups{reltime ? ` · published ${reltime}` : ''}
      </div>
      <div className="match-lineups-grid">
        <LineupColumn teamName={homeName} side={lineups.home} />
        <LineupColumn teamName={awayName} side={lineups.away} />
      </div>
    </div>
  );
}
