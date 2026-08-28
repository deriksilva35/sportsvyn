// components/my/WatchBoard.js - the slate, filterable by league.
//
// THE PANEL FORMERLY KNOWN AS WATCH SCORES. It no longer reads a watchability
// score, and that is the ruling rather than a shortcut:
// match_watch_score_history holds 12,724 World Cup rows, 6,826 friendlies and
// 114 EPL - and ZERO for nfl or cfb. A panel ordered by a number that does not
// exist for the two leagues that matter would render empty or arbitrary. It
// orders by slateRow's live-upcoming-final rule instead, like every other game
// list in the app.
//
// A CLIENT COMPONENT ONLY FOR THE CHIPS. The slate is loaded once on the
// server and filtered in the browser - four leagues is a few dozen rows, and a
// filter that round-trips feels broken in a way one that does not never does.

'use client';

import { useState } from 'react';
import SlateRow from '@/components/slate/SlateRow';

const LG = { cfb: 'CFB', nfl: 'NFL', epl: 'EPL' };
const CHIPS = [['all', 'ALL'], ['cfb', 'CFB'], ['nfl', 'NFL'], ['epl', 'EPL']];

export default function WatchBoard({ games = [] }) {
  const [on, setOn] = useState('all');
  const shown = (on === 'all' ? games : games.filter((g) => g.leagueSlug === on)).slice(0, 6);

  return (
    <section className="mod">
      <span className="tag">Watch Scores - the slate</span>
      <div className="chips">
        {CHIPS.map(([id, label]) => (
          <button key={id} type="button" aria-pressed={on === id}
            className={`ch${on === id ? ' on' : ''}`} onClick={() => setOn(id)}>
            {label}
          </button>
        ))}
      </div>
      {shown.length === 0
        ? <p className="empty">Nothing on the slate for that league.</p>
        : shown.map((g) => (
          // THE SAME ROW THE FRONT PAGE USES. This hand-rolled a matchup line,
          // a live dot and a score column - all three of which SlateRow already
          // owns, and owned differently enough that the two surfaces disagreed
          // on type. The chips, the cap and the empty state above are this
          // panel's own and are untouched; only the ROW converged.
          <SlateRow key={g.id} g={g} tag={LG[g.leagueSlug] ?? g.leagueSlug} />
        ))}
      <a className="cta2" href="/scores">Full scoreboard &rarr;</a>
    </section>
  );
}
