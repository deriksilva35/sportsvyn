// components/gridiron/PowerZBoard.js - the nfl-power-z table: the dark page's
// NFL Power tab (served since tue-13; the arcade page draws ArcadeBoard).
// Server component; the numbers arrive computed (lib/rankings/nflPowerZ.js).

const sign = (x, d = 1) => (x == null ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(d)}`);
const pct = (x) => (x == null ? '—' : x.toFixed(3).replace(/^0/, ''));

export default function PowerZBoard({ board }) {
  if (!board) {
    return <div className="gi-pz"><p className="gi-pz-note">No edition yet. It publishes after each week&rsquo;s last game.</p></div>;
  }
  return (
    <div className="gi-pz">
      <div className="gi-pz-kick">{board.editionLabel}</div>
      <p className="gi-pz-note">Based on this season&rsquo;s games only; early weeks are small samples.</p>
      <table className="gi-pz-table">
        <thead>
          <tr>
            <th scope="col">#</th><th scope="col">Team</th><th scope="col">Record</th>
            <th scope="col">PF adj</th><th scope="col">PA adj</th><th scope="col">Win%</th>
            <th scope="col">QoR</th><th scope="col">Power</th>
          </tr>
        </thead>
        <tbody>
          {board.rows.map((r) => (
            <tr key={r.team}>
              <td>{r.rank}</td>
              <td><a href={`/team/${r.slug}`}>{r.name}</a></td>
              <td>{r.record ?? '—'}</td>
              <td>{sign(r.adjPF)}</td>
              <td>{sign(r.adjPAShown)}</td>
              <td>{pct(r.win)}</td>
              <td>{sign(r.qor, 3)}</td>
              <td>{sign(r.power, 3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="gi-pz-how"><a href="/methodology#power-ranking">How this ranking works</a></p>
    </div>
  );
}
