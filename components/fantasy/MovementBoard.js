'use client';

// components/fantasy/MovementBoard.js — the interactive half of /nfl/fantasy.
//
// The route is a SERVER component: it does the reads and hands finished rows
// down. This client island owns only what the user changes - filters, sort, and
// which row is expanded. Format is the exception: switching format is a
// different query, so it is a LINK to ?format=..., not client state. That keeps
// each format a real, shareable URL and keeps four pools out of one payload.
//
// EVERY GATED VALUE ARRIVES AS null AND RENDERS AS A DASH. There is no
// formatting branch anywhere that invents a zero, and sorting puts nulls last in
// both directions rather than treating them as 0 - a dash must never sort as if
// it were a number.

import { useMemo, useState } from 'react';
import RookieChip from './RookieChip';
import {
  PAGE, COLUMNS, POSITION_CHIPS, ROUND_CHIPS, CLASS_CHIPS, FORMAT_CHIPS,
  SEARCH_PLACEHOLDER, MOVERS_ONLY, EMPTY, EM_DASH,
} from './boardCopy';

const fmtNum = (v) => (v == null ? null : v.toFixed(1));
const deltaClass = (v) => (v == null ? 'flat' : v > 0.05 ? 'pos' : v < -0.05 ? 'neg' : 'flat');
const deltaText = (v) => (v == null ? EM_DASH : (v > 0 ? '+' : '') + v.toFixed(1));

function Cell({ value, className = 'fb-num' }) {
  if (value == null) return <span className="fb-dash">{EM_DASH}</span>;
  return <span className={className}>{value}</span>;
}

export default function MovementBoard({ board, format }) {
  const [pos, setPos] = useState('ALL');
  const [round, setRound] = useState('ALL');
  const [cls, setCls] = useState('ALL');
  const [q, setQ] = useState('');
  const [moversOnly, setMoversOnly] = useState(false);
  const [sortKey, setSortKey] = useState('d3');
  const [sortDir, setSortDir] = useState(-1);
  const [open, setOpen] = useState(null);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = board.players.filter((p) => {
      if (pos !== 'ALL' && p.position !== pos) return false;
      if (cls === 'ROOKIE' && !p.isRookie) return false;
      if (cls === 'VET' && p.isRookie) return false;
      if (round !== 'ALL') {
        // Rounds are derived from ADP against this format's own size.
        const r = Math.ceil((p.adp ?? 0) / board.size);
        if (round === '1-5' && !(r >= 1 && r <= 5)) return false;
        if (round === '6-10' && !(r >= 6 && r <= 10)) return false;
        if (round === '11+' && !(r >= 11)) return false;
      }
      if (needle && !(`${p.name} ${p.team ?? ''}`.toLowerCase().includes(needle))) return false;
      // Movers-only reads the SAME eligibility the band uses, so it can never
      // surface a player whose movement we have declined to call signal.
      if (moversOnly && !(p.bandEligible && p.band.key !== 'quiet')) return false;
      return true;
    });
    out = [...out].sort((a, b) => {
      const av = a[sortKey]; const bv = b[sortKey];
      // Nulls last in BOTH directions - a dash is not a small number.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av - bv) * sortDir;
    });
    return out;
  }, [board, pos, round, cls, q, moversOnly, sortKey, sortDir]);

  function sortBy(key) {
    if (key === sortKey) setSortDir((d) => -d);
    else { setSortKey(key); setSortDir(-1); }
  }

  const SORTABLE = [
    ['adp', COLUMNS.adp], ['open', COLUMNS.open], ['d3', COLUMNS.d3],
    ['d7', COLUMNS.d7], ['drift', COLUMNS.drift],
  ];

  return (
    <>
      <div className="fb-filters">
        <span className="fb-flabel">Pos</span>
        {POSITION_CHIPS.map((c) => (
          <button key={c.key} type="button" className={`fb-chip${pos === c.key ? ' on' : ''}`} onClick={() => setPos(c.key)}>{c.label}</button>
        ))}
        <span className="fb-sep" />
        <span className="fb-flabel">Round</span>
        {ROUND_CHIPS.map((c) => (
          <button key={c.key} type="button" className={`fb-chip${round === c.key ? ' on' : ''}`} onClick={() => setRound(c.key)}>{c.label}</button>
        ))}
        <span className="fb-sep" />
        <span className="fb-flabel">Class</span>
        {CLASS_CHIPS.map((c) => (
          <button key={c.key} type="button" className={`fb-chip${cls === c.key ? ' on' : ''}`} onClick={() => setCls(c.key)}>{c.label}</button>
        ))}
      </div>

      <div className="fb-filters">
        {/* Scoring is a LINK per format - a different format is a different
            query and a different URL. There is no size selector: FFC publishes
            one league size per format, so the chip carries it. */}
        <span className="fb-flabel">Scoring</span>
        {FORMAT_CHIPS.map((c) => (
          <a key={c.key} href={`/nfl/fantasy?format=${encodeURIComponent(c.key)}`}
             className={`fb-chip${format === c.key ? ' on' : ''}`}>{c.label} · {c.size}</a>
        ))}
        <span className="fb-sep" />
        <input className="fb-search" placeholder={SEARCH_PLACEHOLDER} value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="fb-sep" />
        <button type="button" className={`fb-chip${moversOnly ? ' on' : ''}`} onClick={() => setMoversOnly((v) => !v)}>{MOVERS_ONLY}</button>
      </div>

      <div className="fb-scroll">
        <div className="fb-sheet">
          <div className="fb-shead">
            <div>{COLUMNS.band}</div>
            <div>{COLUMNS.player}</div>
            {SORTABLE.map(([key, label]) => (
              <div key={key} className="r">
                <button type="button" className={`sortable${sortKey === key ? ' act' : ''}`} onClick={() => sortBy(key)}>
                  {label}{sortKey === key ? <span className="caret">{sortDir === -1 ? '▼' : '▲'}</span> : null}
                </button>
              </div>
            ))}
            <div className="r">{COLUMNS.range}</div>
            <div className="r">{COLUMNS.sv}</div>
            <div className="r">{COLUMNS.div}</div>
          </div>

          {rows.length === 0 ? (
            <div className="fb-empty">
              <div className="h">{EMPTY.head}</div>
              <div className="p">{EMPTY.body}</div>
            </div>
          ) : rows.map((p) => (
            <div key={p.ffcPlayerId}>
              <button type="button" className={`fb-row ${p.band.key}`} onClick={() => setOpen(open === p.ffcPlayerId ? null : p.ffcPlayerId)}>
                <div><span className={`fb-band ${p.band.key}`}>{p.band.label}</span></div>
                <div>
                  <div className="fb-nm">{p.name}<RookieChip rookie={p.isRookie} /></div>
                  <div className="fb-pt">{p.position} · {p.team ?? EM_DASH}</div>
                </div>
                <div className="r"><Cell value={fmtNum(p.adp)} /></div>
                <div className="r"><Cell value={fmtNum(p.open)} className="fb-num dim" /></div>
                <div className="r"><span className={`fb-delta big ${deltaClass(p.d3)}`}>{deltaText(p.d3)}</span></div>
                <div className="r"><span className={`fb-delta ${deltaClass(p.d7)}`}>{deltaText(p.d7)}</span></div>
                <div className="r">
                  {p.drift == null ? <span className="fb-dash">{EM_DASH}</span>
                    : <span className={`fb-drift ${p.drift > 0 ? 'pos' : p.drift < 0 ? 'neg' : ''}`}>{p.drift > 0 ? '+' : ''}{p.drift}</span>}
                </div>
                <div className="r">
                  {p.lo == null || p.hi == null ? <span className="fb-dash">{EM_DASH}</span>
                    : <span className="fb-rng">{p.lo.toFixed(1)} - {p.hi.toFixed(1)}</span>}
                </div>
                <div className="r"><Cell value={p.svAdp == null ? null : p.svAdp.toFixed(1)} /></div>
                <div className="r">
                  {p.div == null ? <span className="fb-dash">{EM_DASH}</span>
                    : <span className={`fb-delta ${p.div > 0 ? 'neg' : 'pos'}`}>{p.div > 0 ? '+' : ''}{p.div.toFixed(1)}</span>}
                </div>
              </button>
              {/* v1 detail is the meta line only. The editorial read paragraph is
                  an editorial-pipeline question, not a board one - deferred. */}
              <div className={`fb-detail${open === p.ffcPlayerId ? ' open' : ''}`}>
                <div className="fb-meta">
                  <span>24h <b>{deltaText(p.d1)}</b></span>
                  <span>Format <b>{format} · {board.size}-team</b></span>
                  <span>Snapshots <b>{p.snapshots}</b></span>
                  <span>Sportsvyn drafts <b>{p.svAppearances ?? 0}</b></span>
                  <span>Class <b>{p.isRookie ? 'Rookie' : 'Veteran'}</b></span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="fb-panel-head" style={{ borderBottom: 'none', borderTop: '1px solid var(--rule-dim)' }}>
        <div className="fb-panel-note">{PAGE.panelNote}</div>
        <div className="fb-panel-head-count"><span className="mono">{rows.length} of {board.players.length} players</span></div>
      </div>
    </>
  );
}
