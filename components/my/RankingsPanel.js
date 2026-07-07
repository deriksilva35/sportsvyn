/**
 * RankingsPanel: server component.
 *
 * Team Power board context for My Sportsvyn. Shows the top 3 (always, for
 * context) plus every followed team's row, deduped and ordered by rank.
 * Followed rows render volt (.team-name-followed + volt value); context rows
 * are dimmed. Movement label is a small muted glyph when present.
 *
 * Data is the full ordered board (getTopN, ~48 rows) — follow-independent; the
 * component does the top-3 + followed selection so a followed team anywhere in
 * the board still surfaces.
 */

import FlagSlot from '@/components/FlagSlot';

function MoveGlyph({ label }) {
  if (label === 'up') return <span className="rk-move up" aria-hidden="true">{'▲'}</span>;
  if (label === 'down') return <span className="rk-move down" aria-hidden="true">{'▼'}</span>;
  return <span className="rk-move" aria-hidden="true" />;
}

export default function RankingsPanel({ board, followedSet }) {
  const rows = Array.isArray(board) ? board : [];

  if (rows.length === 0) {
    return (
      <section className="panel panel-rankings">
        <h2 className="phead">Rankings</h2>
        <div className="pbody">
          <p className="grp-empty">No rankings yet.</p>
        </div>
      </section>
    );
  }

  // Top 3 (context) + every followed team's row, deduped by team_id, by rank.
  const seen = new Set();
  const picked = [];
  for (const r of rows) {
    const followed = followedSet?.has(r.team_id);
    if ((r.rank <= 3 || followed) && !seen.has(r.team_id)) {
      seen.add(r.team_id);
      picked.push(r);
    }
  }
  picked.sort((a, b) => a.rank - b.rank);

  return (
    <section className="panel panel-rankings">
      <h2 className="phead">
        Rankings
        <a className="phead-action" href="/world-cup-2026/rankings/power">Full board {'→'}</a>
      </h2>
      <div className="pbody">
        {picked.map((r) => {
          const followed = followedSet?.has(r.team_id);
          return (
            <a
              key={r.team_id}
              href={`/team/${r.team_slug}`}
              className={`rk-row${followed ? '' : ' dim'}`}
            >
              <span className="rk-pos">{r.rank}</span>
              <FlagSlot flagSvgPath={r.team_flag_svg_path} colorPrimary={r.team_flag_color_primary} size="sm" />
              <span className={`rk-name${followed ? ' team-name-followed' : ''}`}>{r.team_name}</span>
              <MoveGlyph label={r.movement_label} />
              <span className={`rk-val${followed ? ' fav' : ''}`}>
                {r.score != null ? Number(r.score).toFixed(2) : '—'}
              </span>
            </a>
          );
        })}
      </div>
    </section>
  );
}
