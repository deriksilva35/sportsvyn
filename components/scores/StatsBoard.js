'use client';

// components/scores/StatsBoard.js - the Stats tab's board: tiles, search, chips
// and the ranked rows (sun-1). The server hands it the day's rows once (cached
// 30 s); search, position, status and My players narrow them here, in the
// browser, with lib/scores/statsFilter.js filterRows - no round trip per keystroke.
//
// LIVE REFRESH is the Games tab's own (LiveRefresh: router.refresh() every 30 s,
// paused while the tab is hidden), mounted ONLY while a game in view is live.

import { useMemo, useState } from 'react';
import LiveRefresh from '@/components/scores/LiveRefresh';
import TeamMark from '@/components/team/TeamMark';
import { filterRows, STATUS_CYCLE, STATUS_WORDS } from '@/lib/scores/statsFilter';

const PAGE = 60;
const pts = (n) => (Math.round(n * 10) / 10).toFixed(1);

function Row({ r, league }) {
  const dressed = Boolean(r.c1 && r.c2);
  return (
    <li className={`svs-row${r.inMine ? ' mine' : ''}`} data-pos={r.pos} data-status={r.status} data-key={r.key}>
      <span className="rkn">{r.rank}</span>
      <TeamMark primary={dressed ? r.c1 : null} secondary={dressed ? r.c2 : null} abbr={r.team} size={34}
        title={r.team} leagueSlug={league} headgear={r.headgear} />
      <div className="bd">
        <div className="l1"><span className="nm">{r.name}</span>{r.inMine ? <span className="tag">In your games</span> : null}</div>
        <div className="l2">
          <b className="pos">{r.pos}</b>
          <span className="gm">{r.tag}</span>
          <span className={`pill ${r.status}`}>{r.status === 'live' ? <i className="dot" /> : null}{r.pill}</span>
        </div>
        <div className="l3">{r.line}</div>
      </div>
      <div className="pt"><b>{pts(r.pts)}</b><small>pts</small></div>
    </li>
  );
}

export default function StatsBoard({ view, signedIn = false }) {
  const { league, rows, tiles, pos: posList, showMine, anyLive, scoring, empty } = view;
  const [q, setQ] = useState('');
  const [pos, setPos] = useState('All');
  const [status, setStatus] = useState('all');
  const [mine, setMine] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const list = useMemo(() => filterRows(rows, { q, pos, status, mine }), [rows, q, pos, status, mine]);
  const reset = (fn) => (v) => { fn(v); setShown(PAGE); };
  const nextStatus = () => reset(setStatus)(STATUS_CYCLE[(STATUS_CYCLE.indexOf(status) + 1) % STATUS_CYCLE.length]);
  return (
    <div className="svs-board" data-league={league} data-signed-in={signedIn ? '1' : '0'}>
      {anyLive && <LiveRefresh />}
      {empty ? <p className="svs-empty" data-empty="1">{empty}</p> : (
        <>
          <div className="svs-ctl">
            <label className="svs-search">
              <span className="svs-lbl">Search players</span>
              <input type="search" value={q} onChange={(e) => reset(setQ)(e.target.value)} placeholder="Name, team or game" autoComplete="off" />
            </label>
            <div className="svs-chips" data-section="filters">
              <button type="button" className="svs-chip" onClick={nextStatus} data-chip="status">{STATUS_WORDS[status]}</button>
              {showMine && <button type="button" className={`svs-chip${mine ? ' on' : ''}`} aria-pressed={mine} onClick={() => reset(setMine)(!mine)} data-chip="mine">My players</button>}
            </div>
            <div className="svs-chips" data-section="positions">
              {posList.map((p) => (
                <button key={p} type="button" className={`svs-chip${pos === p ? ' on' : ''}`} aria-pressed={pos === p} onClick={() => reset(setPos)(p)} data-chip={`pos:${p}`}>{p}</button>
              ))}
            </div>
          </div>

          <div className="svs-tiles" data-section="tiles">
            <div className="svs-tile dk" data-tile="top">
              <small>Top scorer</small>
              <b className="t">{tiles.top?.name ?? '—'}</b>
              <em>{tiles.top ? pts(tiles.top.pts) : ''}</em>
            </div>
            {tiles.yours && (
              <div className="svs-tile" data-tile="yours">
                <small>Your players</small>
                <em>{tiles.yours.count}</em>
                <span>{pts(tiles.yours.pts)} pts so far</span>
              </div>
            )}
            <div className="svs-tile" data-tile="biggest">
              <small>Biggest game</small>
              <b className="t">{tiles.biggest?.tag ?? '—'}</b>
              <span>{tiles.biggest ? `${pts(tiles.biggest.pts)} pts` : ''}</span>
            </div>
          </div>

          <div className="svs-hd"><span>Player · game · line</span><span>{scoring}</span></div>
          {list.length === 0
            ? <p className="svs-empty" data-empty="filter">No players match these filters.</p>
            : <ol className="svs-list">{list.slice(0, shown).map((r) => <Row key={r.key + r.gameId} r={r} league={league} />)}</ol>}
          <p className="svs-foot">
            Showing {Math.min(shown, list.length)} of {rows.length} players{anyLive ? ' · updates every 30 s while games are live' : ''}
            {league === 'nfl' ? ' · D/ST counts sacks, INTs, fumble recoveries and TDs only' : ''}
          </p>
          {list.length > shown && <button type="button" className="svs-more" onClick={() => setShown(shown + PAGE)}>Show more</button>}
        </>
      )}
    </div>
  );
}
