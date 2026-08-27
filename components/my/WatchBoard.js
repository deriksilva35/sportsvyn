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
import { rowState } from '@/lib/today/slateRow';

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
        : shown.map((g) => {
          const { live, final, played, when } = rowState(g);
          return (
            <div className="row" key={g.id}>
              <div className="l">
                {live ? <span className="livedot" /> : null}
                {g.away?.abbreviation ?? g.away?.name} at {g.home?.abbreviation ?? g.home?.name}
                <div className="sub">{LG[g.leagueSlug] ?? g.leagueSlug} &middot; {when}</div>
              </div>
              <div className={`r${live ? ' livec' : final ? '' : ' mut'}`}>
                {played ? `${g.awayScore ?? '-'}-${g.homeScore ?? '-'}` : when}
              </div>
            </div>
          );
        })}
      <a className="cta2" href="/scores">Full scoreboard &rarr;</a>
    </section>
  );
}
