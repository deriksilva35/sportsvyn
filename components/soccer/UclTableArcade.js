// components/soccer/UclTableArcade.js - /ucl/standings under the ARCADE theme
// (fri-3): the Champions League's league phase, ONE table of 36 - #, club,
// P, W, D, L, GD, Pts and the last five, newest last - on the EPL table's
// grid (.ept, components/soccer/eplArcade.css). The stored document, never
// the provider (lib/soccer/standings.js).
//
// THE BANDS ARE THE COMPETITION'S RULE, BY RANK (lib/soccer/leagues.js
// uclBand): 1-8 go straight to the round of 16, 9-24 to the knockout
// play-off, 25-36 are out. Each is a quiet rail on the row's left edge and a
// hairline where one band gives way to the next - a marker, not a fill.

import Link from 'next/link';
import { uclBand, UCL_BAND_NAME } from '@/lib/soccer/leagues';
import { matchdayLabel } from '@/lib/soccer/roundLabel';

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

/** Rows with their band, and whether each opens a new band (the hairline). PURE. */
export function bandedRows(rows = []) {
  return rows.map((r, i) => {
    const band = uclBand(r.rank);
    return { ...r, band, bandStart: i > 0 && band !== uclBand(rows[i - 1].rank) };
  });
}

export default function UclTableArcade({ table }) {
  const played = table ? Math.max(...table.rows.map((r) => Number(r.played) || 0)) : 0;
  return (
    <div className="ept ucl-t">
      <div className="ept-head">
        <span className="ept-eb">Champions League</span>
        <h1 className="ept-title">League phase</h1>
        <p className="ept-ed">{played ? `After ${matchdayLabel(played)}` : ''}
          <Link href="/scores?sport=ucl">Scores &rsaquo;</Link></p>
      </div>
      {!table ? <p className="ept-empty">The table lands with the first sync.</p> : (
        <>
          <table className="ept-tbl" aria-label="Champions League league phase table">
            <thead>
              <tr>
                <th scope="col" className="ept-rk">#</th><th scope="col" className="ept-club">Club</th>
                <th scope="col">P</th><th scope="col">W</th><th scope="col">D</th><th scope="col">L</th>
                <th scope="col" className="ept-gd">GD</th><th scope="col" className="ept-pts">Pts</th><th scope="col" className="ept-fm">Form</th>
              </tr>
            </thead>
            <tbody>
              {bandedRows(table.rows).map((r) => (
                <tr key={r.teamId ?? r.rank} data-band={r.band ?? undefined} data-band-start={r.bandStart ? '1' : undefined}>
                  <td className="ept-rk">{r.rank}</td>
                  <th scope="row" className="ept-club">{r.team}</th>
                  <td>{r.played}</td><td>{r.win}</td><td>{r.draw}</td><td>{r.lose}</td>
                  <td className="ept-gd">{gd(r.goalsDiff)}</td><td className="ept-pts">{r.points}</td>
                  <td className="ept-fm"><Form form={r.form} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="ept-key">
            <i className="sw r16" /> 1-8 {UCL_BAND_NAME.r16}
            <i className="sw playoff" /> 9-24 {UCL_BAND_NAME.playoff}
            <i className="sw out" /> 25-36 {UCL_BAND_NAME.out}
          </p>
        </>
      )}
    </div>
  );
}
