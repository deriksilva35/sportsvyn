// components/league/StandingsSnapshot.js — one group, top five.
//
// THE GROUP IS THE READER'S WHEN WE KNOW IT, and the default otherwise. Which
// one was chosen is decided in standingsSnapshot(); this only draws it.
//
// A COLUMN APPEARS ONLY WHEN SOMEBODY HAS A NUMBER IN IT. CFBD publishes no
// streak and no points for college, so the college table is narrower than the
// NFL's - not by preference, by what the provider sends.

import Link from 'next/link';
import { formatRecord } from '@/lib/standings/read';

const ABSENT = '–';
const rec = (w, l, t) => formatRecord(w, l, t) ?? ABSENT;
const strk = (n) => (n == null || n === 0 ? null : `${n > 0 ? 'W' : 'L'}${Math.abs(n)}`);

export default function StandingsSnapshot({ snapshot, leagueSlug, href }) {
  if (!snapshot?.rows?.length) return null;
  const { group, rows, hasStreak, hasPoints } = snapshot;
  const isCfb = leagueSlug === 'cfb';
  return (
    <section className="lgm" aria-label={`${group} standings`}>
      <div className="lgm-h"><h2>{group}</h2>
        <Link className="lgm-all" href={href}>Full standings →</Link>
      </div>
      <table className="lgm-tbl">
        <thead>
          <tr>
            <th className="l" scope="col">Team</th>
            <th scope="col">W-L</th>
            {isCfb ? <th scope="col">Conf</th> : null}
            {!isCfb && hasPoints ? <th scope="col">PF</th> : null}
            {!isCfb && hasPoints ? <th scope="col">PA</th> : null}
            {hasStreak ? <th scope="col">Strk</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const s = strk(r.streak);
            return (
              <tr key={r.team_id ?? r.abbreviation}>
                <th className="l" scope="row">
                  <span className="lgm-ab">{r.abbreviation ?? ''}</span>
                  <span className="lgm-nm">{r.short_name ?? r.name}</span>
                </th>
                <td className="n">{rec(r.wins, r.losses, r.ties)}</td>
                {isCfb ? <td className="n">{rec(r.conf_wins, r.conf_losses, r.conf_ties)}</td> : null}
                {!isCfb && hasPoints ? <td className="n">{r.points_for ?? ABSENT}</td> : null}
                {!isCfb && hasPoints ? <td className="n">{r.points_against ?? ABSENT}</td> : null}
                {hasStreak ? (
                  <td className={`n ${r.streak > 0 ? 'up' : 'down'}`}>{s ?? ABSENT}</td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
