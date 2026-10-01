// components/soccer/EplTableArcade.js - /epl/standings under the ARCADE theme
// (thu-24): #, club, P, W, D, L, GD, Pts and the last five, newest last. The
// stored document, never the provider (lib/soccer/standings.js). Club names
// wrap; nothing ellipsizes. The rails (Champions League, Europa/Conference,
// relegation) are the row's left edge, as on the dark table.

import Link from 'next/link';
import { railFor } from '@/lib/soccer/standings';

const gd = (n) => (Number(n) > 0 ? `+${n}` : String(n ?? 0));

function Form({ form }) {
  if (!form) return <span className="ept-form" />;
  const five = String(form).slice(-5).split('');
  return (
    <span className="ept-form" aria-label={`Last five: ${five.join(' ')}`}>
      {five.map((c, i) => <i key={i} className={`ept-f ${c.toLowerCase()}`} aria-hidden="true">{c}</i>)}
    </span>
  );
}

export default function EplTableArcade({ table }) {
  return (
    <div className="ept">
      <div className="ept-head">
        <span className="ept-eb">Premier League</span>
        <h1 className="ept-title">The table</h1>
        <p className="ept-ed">{table ? `Matchweek ${Math.max(...table.rows.map((r) => Number(r.played) || 0))}` : ''}
          <Link href="/scores?sport=epl">Scores &rsaquo;</Link></p>
      </div>
      {!table ? <p className="ept-empty">The table lands with the first sync.</p> : (
        <>
          <table className="ept-tbl" aria-label="Premier League table">
            <thead>
              <tr>
                <th scope="col" className="rk">#</th><th scope="col" className="club">Club</th>
                <th scope="col">P</th><th scope="col">W</th><th scope="col">D</th><th scope="col">L</th>
                <th scope="col">GD</th><th scope="col" className="pts">Pts</th><th scope="col" className="fm">Form</th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r) => (
                <tr key={r.teamId ?? r.rank} data-rail={railFor(r.note) ?? undefined}>
                  <td className="rk">{r.rank}</td>
                  <th scope="row" className="club">{r.team}</th>
                  <td>{r.played}</td><td>{r.win}</td><td>{r.draw}</td><td>{r.lose}</td>
                  <td>{gd(r.goalsDiff)}</td><td className="pts">{r.points}</td>
                  <td className="fm"><Form form={r.form} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="ept-key">
            <i className="sw ucl" /> Champions League <i className="sw uel" /> Europa / Conference <i className="sw drop" /> Relegation
          </p>
        </>
      )}
    </div>
  );
}
