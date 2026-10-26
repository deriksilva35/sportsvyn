'use client';

// components/scores/StatsBoard.js - the Stats tab's board: tiles, search, chips,
// the Filters sheet and the ranked rows (sun-1, mon-1). The server hands it the
// day's rows once (cached 30 s) and the filter state parsed from the URL; every
// change re-runs lib/scores/statsFilter.js applyState in the browser - no round trip
// per keystroke - and writes the state back to the URL (history.replaceState), so
// the page is shareable and the next server render (the 30 s live refresh, a
// reload) lands on the same list.
//
// LIVE REFRESH is the Games tab's own (LiveRefresh: router.refresh() every 30 s,
// paused while the tab is hidden), mounted ONLY while a game in view is live.

import { useCallback, useMemo, useRef, useState } from 'react';
import LiveRefresh from '@/components/scores/LiveRefresh';
import StandaloneTime from '@/components/StandaloneTime';
import StatsFilters from '@/components/scores/StatsFilters';
import TeamMark from '@/components/team/TeamMark';
import {
  applyState, awayCount, defaultState, toQuery, tilesOf, SCORING_WORDS, SORT_OPTS, STATUS_CYCLE, STATUS_WORDS,
} from '@/lib/scores/statsFilter';

const PAGE = 60;
const MANAGED = ['sc', 'sort', 'st', 'win', 'q', 'tg', 'pos', 'only', 'min'];
const pts = (n) => (Math.round(n * 10) / 10).toFixed(1);
const SORT_UNIT = { yds: 'yds', td: 'TD', tgt: 'tgt', att: 'att', pts: 'pts', reb: 'reb', ast: 'ast', tpm: '3pm', stocks: 'stl+blk' };

/** A stat line as whole tokens: each one stays on a line (nowrap), the line wraps between them. */
function Tokens({ line }) {
  return String(line).split(' · ').map((t, i) => (
    <span key={i} className="tk">{i > 0 ? <i className="sep" aria-hidden="true">{'\u00b7'}</i> : null}{t}</span>
  ));
}

function Row({ r, league, state }) {
  const dressed = Boolean(r.c1 && r.c2);
  const byPos = state.pos !== 'All' && r.posRank != null;
  const raw = state.sc === 'raw';
  return (
    <li className={`svs-row${r.inMine ? ' mine' : ''}`} data-pos={r.pos} data-status={r.status} data-key={r.key}>
      {byPos
        ? <span className="rkn pr" data-rank="pos"><b>{state.pos}{r.posRank}</b><small>#{r.rank}</small></span>
        : <span className="rkn" data-rank="overall">{r.rank}</span>}
      <TeamMark primary={dressed ? r.c1 : null} secondary={dressed ? r.c2 : null} abbr={r.team} size={34}
        title={r.team} leagueSlug={league} headgear={r.headgear} />
      <div className="bd">
        <div className="l1"><span className="nm">{r.name}</span>{r.inMine ? <span className="tag">In your games</span> : null}</div>
        <div className="l2">
          <b className="pos">{r.pos}</b>
          <span className="gm">{r.tag}</span>
          <span className={`pill ${r.status}`}>{r.status === 'live' ? <i className="dot" /> : null}{r.pill}</span>
        </div>
        <div className="l3 tks"><Tokens line={r.line} /></div>
      </div>
      {raw
        ? <div className="pt"><b>{r.sv?.[state.sort] ?? 0}</b><small>{SORT_UNIT[state.sort] ?? ''}</small></div>
        : <div className="pt"><b>{pts(r.pts)}</b><small>pts</small></div>}
    </li>
  );
}

export default function StatsBoard({ view, signedIn = false, initial, serverTz = null }) {
  const { league, rows, pos: posList, showMine, anyLive, empty, firstTip } = view;
  const [state, setState] = useState(() => initial ?? defaultState(league));
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState(false);
  const openerRef = useRef(null);

  const { all, list } = useMemo(() => applyState(rows, state), [rows, state]);
  const raw = state.sc === 'raw';
  const tiles = useMemo(() => {
    if (raw) return null;
    return tilesOf([...all].sort((a, b) => b.pts - a.pts || a.name.localeCompare(b.name)), { signedIn, state });
  }, [all, raw, signedIn, state]);

  const set = useCallback((patch) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      // Raw stats show no points: a points sort has nothing to sort by.
      if (next.sc === 'raw' && next.sort === 'fp') next.sort = SORT_OPTS[league === 'nba' ? 'nba' : 'nfl'][1][0];
      try {
        const url = new URL(window.location.href);
        for (const k of MANAGED) url.searchParams.delete(k);
        for (const [k, v] of toQuery(league, next)) url.searchParams.set(k, v);
        window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
      } catch { /* the board still works without the URL */ }
      return next;
    });
    setShown(PAGE);
  }, [league]);
  const reset = useCallback(() => set({ ...defaultState(league), q: '' }), [set, league]);
  const close = useCallback(() => setOpen(false), []);
  const away = awayCount(league, state);
  const nextStatus = () => set({ st: STATUS_CYCLE[(Math.max(0, STATUS_CYCLE.indexOf(state.st)) + 1) % STATUS_CYCLE.length] });
  const head = raw ? (SORT_OPTS[league === 'nba' ? 'nba' : 'nfl'].find(([k]) => k === state.sort)?.[1] ?? '') : SCORING_WORDS[state.sc];

  return (
    <div className="svs-board" data-league={league} data-signed-in={signedIn ? '1' : '0'}>
      {anyLive && <LiveRefresh />}
      {firstTip ? (
        <p className="svs-empty" data-empty="first">{firstTip.lead} <StandaloneTime iso={firstTip.iso} serverTz={serverTz} /> {'·'} {firstTip.tail}</p>
      ) : empty ? <p className="svs-empty" data-empty="1">{empty}</p> : (
        <>
          <div className="svs-ctl">
            <label className="svs-search">
              <span className="svs-lbl">Search players</span>
              <input type="search" value={state.q} onChange={(e) => set({ q: e.target.value })} placeholder="Name, team or game" autoComplete="off" />
            </label>
            <div className="svs-chips" data-section="filters">
              <button type="button" ref={openerRef} className={`svs-chip dk${away ? ' on' : ''}`} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} data-chip="filters">
                Filters{away ? ` · ${away}` : ''}
              </button>
              <button type="button" className="svs-chip" onClick={nextStatus} data-chip="status">{STATUS_WORDS[state.st]}</button>
              {showMine && <button type="button" className={`svs-chip${state.only === 'mine' ? ' on' : ''}`} aria-pressed={state.only === 'mine'} onClick={() => set({ only: state.only === 'mine' ? 'all' : 'mine' })} data-chip="mine">My players</button>}
            </div>
            <div className="svs-chips" data-section="positions">
              {posList.map((p) => (
                <button key={p} type="button" className={`svs-chip${state.pos === p ? ' on' : ''}`} aria-pressed={state.pos === p} onClick={() => set({ pos: p })} data-chip={`pos:${p}`}>{p}</button>
              ))}
            </div>
          </div>

          {tiles && (
            <div className="svs-tiles" data-section="tiles">
              <div className="svs-tile dk" data-tile="top">
                <small>{tiles.topLabel}</small>
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
          )}

          <div className="svs-hd"><span>Player · game · line</span><span>{head}</span></div>
          {state.st === 'pending'
            ? <p className="svs-empty" data-empty="pending">Games that have not started have no stats to list yet.</p>
            : list.length === 0
              ? <p className="svs-empty" data-empty="filter">No players match these filters.</p>
              : <ol className="svs-list">{list.slice(0, shown).map((r) => <Row key={r.key + r.gameId} r={r} league={league} state={state} />)}</ol>}
          <p className="svs-foot">
            Showing {Math.min(shown, list.length)} of {rows.length} players{anyLive ? ' · updates every 30 s while games are live' : ''}
            {league === 'nfl' && !raw && state.sc !== 'weekly' ? ' · D/ST counts sacks, INTs, fumble recoveries, TDs and points allowed' : ''}
            {state.sc === 'weekly' ? ' · the Weekly scores QB, RB, WR and TE only' : ''}
          </p>
          {list.length > shown && <button type="button" className="svs-more" onClick={() => setShown(shown + PAGE)}>Show more</button>}
          {open && (
            <StatsFilters league={league} state={state} set={set} onReset={reset} onClose={close}
              count={state.st === 'pending' ? 0 : list.length} posList={posList} signedIn={signedIn && showMine} />
          )}
        </>
      )}
    </div>
  );
}
