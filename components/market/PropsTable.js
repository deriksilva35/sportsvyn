// components/market/PropsTable.js — the props TABLE, per mock v0.7.
//
// THE DEFAULT VIEW of the PROPS tab. Charts are the alternate at ?view=charts,
// so every existing props deep link lands here without carrying a param.
//
// ZERO CLIENT COMPONENTS. Column headers are LINKS and sorting happens on the
// server, which is not a compromise - it is the only way a sort can mean what
// it says. Sorting forty loaded rows client-side would return the best of
// whatever arrived first and call it the top of the board; sorting on the
// server returns the true top of all 3,156. It also keeps a sorted board
// linkable, back-buttonable and identical on reload, which client state is not.
//
// The board's interactivity class is unchanged: still no 'use client', still no
// fetch, still nothing that behaves differently on a cold load.

import Link from 'next/link';
import { shortName, TABLE_COLUMNS } from '@/lib/market/propsBoard';
import { nextDir } from '@/lib/market/marketUrl';

const WHEN = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit',
});
const american = (n) => (n == null ? '—' : n > 0 ? `+${n}` : `${n}`);

/** A cell with nothing in it says so, and says it the same way every time. */
function Dash() { return <span className="mut">—</span>; }

export default function PropsTable({ rows, total, sort, dir, hrefFor }) {
  return (
    <div className="pt-wrap">
      <table className="pt">
        <thead>
          <tr>
            {TABLE_COLUMNS.map((c) => {
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
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.matchId}|${r.marketType}|${r.selection}|${r.side ?? ''}`}>
              <td className="l">
                <span className="nm">
                  {r.playerSlug
                    ? <Link href={`/player/${r.playerSlug}`}>{shortName(r.selection)}</Link>
                    : shortName(r.selection)}
                </span>
                {r.onBoard ? <span className="boardpill">Board</span> : null}
              </td>
              <td className="l gm">
                {r.away.abbr ?? '—'} at {r.home.abbr ?? '—'}
                {r.kickoffAt ? ` · ${WHEN.format(new Date(r.kickoffAt)).toUpperCase()}` : ''}
              </td>
              <td className="l mkt">{r.marketRowLabel}{r.side ? ` ${r.side[0]}` : ''}</td>
              <td>{r.line == null ? <Dash /> : r.line}</td>
              <td className="px">{american(r.american)}</td>
              {/* AS-OFFERED CARRIES NO IMPLIED %: it was never de-vigged, and a
                  raw number in the de-vigged column would imply a
                  normalisation that did not happen. */}
              <td className={r.asOffered ? 'asoff' : ''}>
                {r.asOffered ? 'as offered' : `${r.impliedPct?.toFixed(1) ?? '—'}%`}
              </td>
              <td className={r.moveProb == null || r.moveProb === 0 ? 'mut'
                : r.moveProb > 0 ? 'jade' : 'terra'}>
                {r.moveProb == null || r.moveProb === 0
                  ? '—'
                  : `${r.moveProb > 0 ? '▲' : '▼'}${Math.abs(r.moveProb).toFixed(1)}`}
              </td>
              {/* HIT and AVG are dashes on two kinds of row and for one reason:
                  we have nothing honest to put there. An UNLINKED player is our
                  gap; a FIRST/LAST SCORER row is a question our logs cannot
                  answer, because goal_minutes is empty across every scoring row
                  we hold. Neither row is demoted for it. */}
              <td className="hit">
                {r.hit ? <><b>{r.hit.cleared}</b>/{r.hit.games}</> : <Dash />}
              </td>
              <td className={r.avg == null ? 'mut' : ''}>
                {r.avg == null ? '—' : r.avg.toFixed(1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pt-foot">
        Showing {rows.length} of {total.toLocaleString('en-US')} · HIT is games clearing
        today&apos;s line (season) · AVG is per game · as-offered prices are not de-vigged ·
        unlinked players and first/last scorer markets carry no stats - our gap, not theirs.
        Not a pick. Not a recommendation.
      </div>
    </div>
  );
}
