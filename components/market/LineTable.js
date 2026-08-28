// components/market/LineTable.js — the LINES and FUTURES spreadsheets.
//
// ONE COMPONENT, TWO TABS. Both tables are the same object: a header row of
// sort links, dense mono rows, dashes where there is nothing honest to print.
// The columns differ and the cells differ; the grammar does not, which is why
// it is not worth two components that would drift apart.
//
// THE SECONDARY VIEW HERE, the reverse of props. Cards stay the unmarked
// default so every shipped link renders exactly as it does today.
//
// ZERO CLIENT COMPONENTS, like the rest of this surface. Headers are Links and
// sorting happens on the server, so a sorted table is linkable, back-
// buttonable and identical on reload.

import Link from 'next/link';
import { nextDir } from '@/lib/market/marketUrl';

const WHEN = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit',
});
const GAME_ROUTE = { nfl: '/nfl/game', cfb: '/cfb/game' };
const american = (n) => (n == null ? '—' : n > 0 ? `+${n}` : `${n}`);

function Move({ v }) {
  if (v == null || v === 0) return <span className="mut">—</span>;
  return (
    <span className={v > 0 ? 'jade' : 'terra'}>
      {v > 0 ? '▲' : '▼'}{Math.abs(v).toFixed(1)}
    </span>
  );
}

function Head({ columns, sort, dir, hrefFor }) {
  return (
    <thead>
      <tr>
        {columns.map((c) => {
          const on = sort === c.key;
          // THE DIRECTION TOGGLE LIVES IN THE HELPER, not in two table
          // components that could disagree: the active column flips, a new
          // column takes its own sensible default.
          const next = nextDir(c.key, sort, dir);
          return (
            <th key={c.key} className={`${c.align === 'l' ? 'l' : ''}${on ? ' sorted' : ''}`}>
              <Link href={hrefFor({ sort: c.key, dir: next })}>
                {c.label}
                {on ? <span className="arr">{dir === 'asc' ? '▲' : '▼'}</span> : null}
              </Link>
            </th>
          );
        })}
      </tr>
    </thead>
  );
}

export function LinesTable({ rows, total, columns, sort, dir, hrefFor }) {
  return (
    <div className="pt-wrap">
      <table className="pt">
        <Head columns={columns} sort={sort} dir={dir} hrefFor={hrefFor} />
        <tbody>
          {rows.map((r, i) => {
            const route = GAME_ROUTE[r.leagueSlug];
            // ABBREVIATION, THEN NAME, THEN A DASH. 127 CFB games have an away
            // team with no abbreviation - Bethune-Cookman, UAlbany, Merrimack,
            // the FCS visitors - and we hold their NAMES. Dashing them would
            // discard information we have to honour a column width; the name
            // is longer and true. A dash means we know nothing, and that is
            // the only thing it should ever mean.
            const side = (t) => t?.abbreviation || t?.name || '—';
            const game = `${side(r.away)} at ${side(r.home)}`;
            return (
              <tr key={`${r.matchId}|${r.marketLabel}|${r.selection}|${i}`}>
                <td className="l gm">
                  {route && r.matchSlug
                    ? <Link href={`${route}/${r.matchSlug}`}>{game}</Link>
                    : game}
                  {r.kickoffAt ? ` · ${WHEN.format(new Date(r.kickoffAt)).toUpperCase()}` : ''}
                  {r.onBoard ? <span className="boardpill">Board</span> : null}
                </td>
                <td className="l mkt">{r.leagueSlug}</td>
                <td className="l mkt">{r.marketLabel}</td>
                <td className="l">{r.selection}</td>
                <td>{r.line == null ? <span className="mut">—</span> : r.line}</td>
                <td className="px">{american(r.american)}</td>
                {/* A BLANK IMP% IS THE CARD'S OWN CLAIM, not a new one: the
                    ingest de-vigs the pair, and spread and total rows never
                    carried a de-vigged number on the card either. */}
                <td className={r.impliedPct == null ? 'mut' : ''}>
                  {r.impliedPct == null ? '—' : `${r.impliedPct.toFixed(1)}%`}
                </td>
                <td><Move v={r.moveProb} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="pt-foot">
        Showing {rows.length} of {total.toLocaleString('en-US')} selections · one row per
        priced side · IMP% is the de-vigged two-way price; spread and total juice carries none ·
        Not a pick. Not a recommendation.
      </div>
    </div>
  );
}

export function FuturesTable({ rows, total, columns, sort, dir, hrefFor, counts }) {
  return (
    <div className="pt-wrap">
      <table className="pt">
        <Head columns={columns} sort={sort} dir={dir} hrefFor={hrefFor} />
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.leagueSlug}|${r.selection}|${i}`}>
              <td className="l mkt">{r.leagueSlug}</td>
              <td className="l mkt">{r.marketLabel}</td>
              <td className="l">{r.selection}</td>
              <td className="px">{american(r.american)}</td>
              <td className={r.impliedPct == null ? 'mut' : ''}>
                {r.impliedPct == null ? '—' : `${r.impliedPct.toFixed(1)}%`}
              </td>
              <td><Move v={r.moveProb} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pt-foot">
        {/* THE WHOLE FIELD. The cards show five because a card is a glance;
            this is where the rest of it lives, and the count says how much
            "the rest" is. */}
        Showing {rows.length} of {total.toLocaleString('en-US')} priced selections
        {counts?.length ? ` · ${counts.map((c) => `${c.leagueSlug.toUpperCase()} ${c.priced}`).join(' · ')}` : ''}
        {' '}· a title field does not sum to 100 across books · Not a pick. Not a recommendation.
      </div>
    </div>
  );
}
