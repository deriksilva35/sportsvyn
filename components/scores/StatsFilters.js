'use client';

// components/scores/StatsFilters.js - the Stats tab's Filters sheet (mon-1).
//
// A DIALOG, NOT A POPOVER: role="dialog" aria-modal, focus moves into it on open and
// is handed back to the "Filters" chip on close, Tab cycles inside it, Escape and the
// backdrop close it. Every control is a real <button> (aria-pressed) or a labelled
// <input>. Changes apply to the board behind it as they are made (the state is the
// URL); "Show N players" is the length of the list that state gives, and closes.

import { useEffect, useRef } from 'react';
import {
  SCORING_OPTS, SORT_OPTS, STATUS_OPTS, WINDOW_OPTS, onlyOpts, MIN_PTS_MAX,
} from '@/lib/scores/statsFilter';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

function Group({ label, id, children }) {
  return (
    <div className="svs-grp" role="group" aria-labelledby={id}>
      <div className="svs-grp-h" id={id}>{label}</div>
      <div className="svs-grp-b">{children}</div>
    </div>
  );
}

function Opt({ on, onClick, children, ...rest }) {
  return <button type="button" className={`svs-chip${on ? ' on' : ''}`} aria-pressed={on} onClick={onClick} {...rest}>{children}</button>;
}

export default function StatsFilters({ league, state, set, onReset, onClose, count, posList, signedIn }) {
  const ref = useRef(null);
  const raw = state.sc === 'raw';
  const lg = league === 'nba' ? 'nba' : 'nfl';

  useEffect(() => {
    const el = ref.current;
    const opener = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    el?.querySelector('[data-autofocus]')?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab' || !el) return;
      const items = [...el.querySelectorAll(FOCUSABLE)];
      if (!items.length) return;
      const first = items[0]; const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      if (opener && typeof opener.focus === 'function') opener.focus();
    };
  }, [onClose]);

  const only = onlyOpts(league, signedIn);
  return (
    <div className="svs-sheet-wrap" data-sheet="1">
      <div className="svs-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="svs-sheet" role="dialog" aria-modal="true" aria-labelledby="svs-sheet-title" ref={ref}>
        <div className="svs-grab" aria-hidden="true" />
        <div className="svs-sheet-top">
          <h2 id="svs-sheet-title">Filters</h2>
          <button type="button" className="svs-reset" onClick={onReset} data-act="reset">Reset</button>
          <button type="button" className="svs-x" onClick={onClose} aria-label="Close filters" data-autofocus="1">Close</button>
        </div>

        <Group label="Scoring" id="svs-g-sc">
          {SCORING_OPTS[lg].map(([k, w]) => <Opt key={k} on={state.sc === k} onClick={() => set({ sc: k })} data-opt={`sc:${k}`}>{w}</Opt>)}
        </Group>

        <Group label="Sort by" id="svs-g-sort">
          {SORT_OPTS[lg].filter(([k]) => !(raw && k === 'fp')).map(([k, w]) => <Opt key={k} on={state.sort === k} onClick={() => set({ sort: k })} data-opt={`sort:${k}`}>{w}</Opt>)}
        </Group>

        <Group label="Position" id="svs-g-pos">
          {posList.map((p) => <Opt key={p} on={state.pos === p} onClick={() => set({ pos: p })} data-opt={`pos:${p}`}>{p}</Opt>)}
        </Group>

        <Group label="Game status" id="svs-g-st">
          {STATUS_OPTS.map(([k, w]) => <Opt key={k} on={state.st === k} onClick={() => set({ st: k })} data-opt={`st:${k}`}>{w}</Opt>)}
        </Group>

        {lg === 'nfl' && (
          <Group label="Window" id="svs-g-win">
            {WINDOW_OPTS.map(([k, w]) => <Opt key={k} on={state.win === k} onClick={() => set({ win: k })} data-opt={`win:${k}`}>{w}</Opt>)}
          </Group>
        )}

        <div className="svs-grp">
          <label className="svs-grp-h" htmlFor="svs-tg">Team or game</label>
          <input id="svs-tg" className="svs-in" type="text" value={state.tg} onChange={(e) => set({ tg: e.target.value })}
            placeholder={lg === 'nba' ? 'DEN, OKC @ DEN' : 'BUF, MIA @ BUF'} autoComplete="off" />
        </div>

        {only.length > 0 && (
          <Group label="Only" id="svs-g-only">
            {only.map(([k, w]) => <Opt key={k} on={state.only === k} onClick={() => set({ only: state.only === k ? 'all' : k })} data-opt={`only:${k}`}>{w}</Opt>)}
          </Group>
        )}

        <div className="svs-grp">
          <label className="svs-grp-h" htmlFor="svs-min">Minimum points · {raw ? 'off (Raw stats)' : state.min}</label>
          <input id="svs-min" className="svs-range" type="range" min="0" max={MIN_PTS_MAX} step="1" value={state.min} disabled={raw}
            onChange={(e) => set({ min: Number(e.target.value) })} />
        </div>

        <button type="button" className="svs-apply" onClick={onClose} data-act="apply">Show {count} player{count === 1 ? '' : 's'}</button>
      </div>
    </div>
  );
}
