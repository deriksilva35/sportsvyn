'use client';

/**
 * BoardSection — the interactive Board: a filter row + the client-filtered grid.
 *
 * The board is small (tens of rows), so every row is serialized from the server
 * and filtered in the browser — no searchParams, no round trips; the page stays
 * force-dynamic and server-fetched. Filters compose (AND):
 *   · match OR team (one combined select)
 *   · market type (match_winner / total)
 *   · reads-only (generous / rich / wide)
 *
 * Row renderers (BoardRow / TotalsRow) live here rather than in the server page
 * because the client owns show/hide. Scorer prices are a SEPARATE section on the
 * page and are not filtered here.
 */

import { useMemo, useState } from 'react';

const PT_TZ = 'America/Los_Angeles';

function fmtAmerican(odds) {
  if (odds == null) return '';
  return odds > 0 ? `+${odds}` : String(odds);
}
function fmtDatePt(iso) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', timeZone: PT_TZ,
    }).format(new Date(iso)).replace(',', '');
  } catch {
    return '';
  }
}
function sinceOpen(openAmerican, american) {
  return openAmerican != null
    ? `${fmtAmerican(openAmerican)} → ${fmtAmerican(american)}`
    : fmtAmerican(american);
}

const TAG_CHIP = { generous: 'gen', rich: 'rich', fair: 'fair', wide: 'wide' };
const TAG_LABEL = { generous: 'Generous', rich: 'Rich', fair: 'Fair', wide: 'Wide' };
const TAG_GAP = { generous: 'pos', rich: 'neg', fair: 'flat', wide: 'wide' };
const READ_TAGS = new Set(['generous', 'rich', 'wide']);

function mwSideLabel(row) {
  if (row.selection === 'home') return `${row.home_name} to win`;
  if (row.selection === 'away') return `${row.away_name} to win`;
  return 'Draw';
}

function BoardRow({ row }) {
  const matchLabel = `${row.home_abbr} v ${row.away_abbr} · ${fmtDatePt(row.kickoff_at)}`;
  const gapStr = `${row.gap >= 0 ? '+' : ''}${row.gap.toFixed(1)}`;
  const sub = row.selection === 'draw'
    ? `Match winner · ${row.home_abbr} v ${row.away_abbr}` : 'Match winner';
  return (
    <div className="brow">
      <span className="b-side">{mwSideLabel(row)}<span className="sub">{sub}</span></span>
      <span className="b-match">{matchLabel}</span>
      <span className="b-num price">{fmtAmerican(row.american)}<span className="dec">{row.decimal != null ? row.decimal.toFixed(2) : ''}</span></span>
      <span className="b-pct">{row.market_pct.toFixed(1)}%</span>
      <span className="b-pct model">{row.model_pct.toFixed(1)}%</span>
      <span className={`b-gap ${TAG_GAP[row.tag]}`}>{gapStr}</span>
      <span className="b-open">{sinceOpen(row.open_american, row.american)}</span>
      <span className="b-tag"><span className={`tag ${TAG_CHIP[row.tag]}`}>{TAG_LABEL[row.tag]}</span></span>
    </div>
  );
}

function TotalsRow({ row }) {
  const matchLabel = `${row.home_abbr} v ${row.away_abbr} · ${fmtDatePt(row.kickoff_at)}`;
  const side = row.selection === 'over' ? `Over ${row.line} goals` : `Under ${row.line} goals`;
  const isTail = row.kind === 'tail';
  return (
    <div className="brow">
      <span className="b-side">{side}<span className="sub">Total goals</span></span>
      <span className="b-match">{matchLabel}</span>
      <span className="b-num price">{fmtAmerican(row.american)}<span className="dec">{row.decimal != null ? row.decimal.toFixed(2) : ''}</span></span>
      <span className="b-pct">{row.market_pct.toFixed(1)}%</span>
      {isTail
        ? <span className="b-pct model">{row.model_pct.toFixed(1)}%</span>
        : <span className="b-pct model dash">-</span>}
      {isTail
        ? <span className={`b-gap ${TAG_GAP[row.tag]}`}>{`${row.gap >= 0 ? '+' : ''}${row.gap.toFixed(1)}`}</span>
        : <span className="b-gap flat dash">-</span>}
      <span className="b-open">{sinceOpen(row.open_american, row.american)}</span>
      <span className="b-tag">
        {isTail
          ? <span className={`tag ${TAG_CHIP[row.tag]}`}>{TAG_LABEL[row.tag]}</span>
          : <span className="tag market">Market</span>}
      </span>
    </div>
  );
}

function rowKey(row) {
  return row._kind === 'mw'
    ? `mw-${row.match_id}-${row.selection}`
    : `tot-${row.match_id}-${row.kind}-${row.line}-${row.selection}`;
}

export default function BoardSection({ rows, matchOptions, teamOptions, marketOptions, updatedLabel }) {
  const [pick, setPick] = useState('');       // '' | 'm:<matchId>' | 't:<abbr>'
  const [market, setMarket] = useState('');   // '' | 'match_winner' | 'total'
  const [readsOnly, setReadsOnly] = useState(false);

  const reset = () => { setPick(''); setMarket(''); setReadsOnly(false); };

  const filtered = useMemo(() => rows.filter((row) => {
    if (pick.startsWith('m:')) {
      if (String(row.match_id) !== pick.slice(2)) return false;
    } else if (pick.startsWith('t:')) {
      const abbr = pick.slice(2);
      if (row.home_abbr !== abbr && row.away_abbr !== abbr) return false;
    }
    if (market && row.market_type !== market) return false;
    if (readsOnly && !READ_TAGS.has(row.tag)) return false;
    return true;
  }), [rows, pick, market, readsOnly]);

  return (
    <>
      <div className="bfilter">
        <select
          className={`pickselect${pick ? ' on' : ''}`}
          value={pick}
          onChange={(e) => setPick(e.target.value)}
          aria-label="Filter by match or team"
        >
          <option value="">All matches &amp; teams</option>
          {matchOptions.length > 0 && (
            <optgroup label="Matches">
              {matchOptions.map((m) => <option key={m.id} value={`m:${m.id}`}>{m.label}</option>)}
            </optgroup>
          )}
          {teamOptions.length > 0 && (
            <optgroup label="Teams">
              {teamOptions.map((t) => <option key={t.abbr} value={`t:${t.abbr}`}>{t.name}</option>)}
            </optgroup>
          )}
        </select>

        <select
          className={`pickselect${market ? ' on' : ''}`}
          value={market}
          onChange={(e) => setMarket(e.target.value)}
          aria-label="Filter by market type"
        >
          <option value="">All markets</option>
          {marketOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <button
          type="button"
          className={`pickpill${readsOnly ? ' on' : ''}`}
          aria-pressed={readsOnly}
          onClick={() => setReadsOnly((v) => !v)}
        >
          Reads only
        </button>

        {updatedLabel && <span className="bupdated">{updatedLabel}</span>}
      </div>

      <div className="board">
        <div className="brow-head">
          <span>Side</span><span>Match</span>
          <span style={{ textAlign: 'right' }}>Price</span>
          <span style={{ textAlign: 'right' }}>Market</span>
          <span style={{ textAlign: 'right' }}>Model</span>
          <span style={{ textAlign: 'right' }}>Gap</span>
          <span style={{ textAlign: 'right' }}>Since open</span>
          <span style={{ textAlign: 'right' }}>Tag</span>
        </div>
        {filtered.length === 0 ? (
          <div className="brow bempty">
            <span>
              Nothing on the board matches the filter.{' '}
              <button type="button" className="blink" onClick={reset}>Reset filters</button>
            </span>
          </div>
        ) : (
          filtered.map((row) => (
            row._kind === 'mw'
              ? <BoardRow key={rowKey(row)} row={row} />
              : <TotalsRow key={rowKey(row)} row={row} />
          ))
        )}
      </div>
    </>
  );
}
