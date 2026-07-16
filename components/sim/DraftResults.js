// components/sim/DraftResults.js — results scaffold (THE READ ships next session).
// Presentational; consumes lib/fantasy/drafts.getResults output.
//
// VALUE SIGN (adapted here, in ONE place): the engine stores perPickValue =
// adp_at_pick - overall_pick (negative = value). The reader UI flips it so value
// reads POSITIVE-GOOD: display = overall_pick - adp_at_pick (fell to you = +,
// reach = - / terra).

function expandSlots(rosterSlots) {
  const out = [];
  for (const [k, n] of Object.entries(rosterSlots)) for (let i = 0; i < n; i++) out.push(k);
  return out;
}
function buildRoster(userPicks, rosterSlots) {
  const slots = expandSlots(rosterSlots).map((label) => ({ label, pick: null }));
  for (const pk of [...userPicks].sort((a, b) => a.overallPick - b.overallPick)) {
    const s = slots.find((x) => x.label === pk.rosterSlot && !x.pick) || slots.find((x) => x.label === 'BN' && !x.pick);
    if (s) s.pick = pk;
  }
  return slots;
}
const disp = (pk) => Math.round(pk.overallPick - pk.adpAtPick); // positive-good, whole picks
const nameOf = (pk) => (pk.synthetic ? `Replacement ${pk.slotPos}` : pk.playerName);

export default function DraftResults({ data }) {
  const { config, userPicks, rosterValueTotal, bestValue, biggestReach, pivot, byeStackWarnings } = data;
  const roster = buildRoster(userPicks, config.roster_slots);
  const ledger = [...userPicks].sort((a, b) => a.overallPick - b.overallPick);
  const totalDisplay = -rosterValueTotal; // rosterValueTotal is engine-signed; flip for display

  return (
    <div>
      <div className="sim-kicker">Draft complete · {config.name}</div>

      <h2 style={{ fontFamily: 'var(--font-saira)', fontStyle: 'italic', fontWeight: 900, textTransform: 'uppercase', fontSize: 26, color: 'var(--paper)', margin: '0 0 14px' }}>Your Roster</h2>
      <div className="res-grid">
        {roster.map((s, i) => (
          <div key={i} className="res-slot">
            <span className="lbl">{s.label}</span>
            {s.pick ? <span className="nm">{nameOf(s.pick)}{s.pick.team ? ` · ${s.pick.team}` : ''}</span> : <span className="nm" style={{ color: 'var(--muted-dim)', fontStyle: 'italic' }}>empty</span>}
          </div>
        ))}
      </div>

      {/* callouts — skill only (K/DST never the headline) */}
      <div className="callouts">
        {bestValue && <div className="callout"><div className="k">Best Value</div><div className="nm">{nameOf(bestValue)}</div><div className="sub">R{bestValue.round} · pick {bestValue.overallPick} · ADP {Math.round(bestValue.adpAtPick)} · +{disp(bestValue)} value</div></div>}
        {biggestReach && <div className="callout"><div className="k">Biggest Reach</div><div className="nm">{nameOf(biggestReach)}</div><div className="sub">R{biggestReach.round} · pick {biggestReach.overallPick} · ADP {Math.round(biggestReach.adpAtPick)} · {disp(biggestReach)} </div></div>}
        {pivot && <div className="callout"><div className="k">The Pivot</div><div className="nm">{nameOf(pivot)}</div><div className="sub">R{pivot.round} · the most need-driven pick</div></div>}
      </div>

      {byeStackWarnings.length > 0 && byeStackWarnings.map((w) => (
        <div key={w.bye} className="bye-warn"><b>Bye stack (week {w.bye}):</b> {w.count} starters — {w.players.join(', ')}</div>
      ))}

      {/* value ledger */}
      <table className="ledger">
        <thead><tr><th>Rd</th><th>Ovr</th><th>Player</th><th>Slot</th><th>ADP</th><th>Value</th></tr></thead>
        <tbody>
          {ledger.map((pk) => {
            const v = disp(pk);
            return (
              <tr key={pk.overallPick}>
                <td>{pk.round}</td><td>{pk.overallPick}</td>
                <td style={{ color: 'var(--paper)' }}>{nameOf(pk)}{pk.team ? ` · ${pk.team}` : ''}</td>
                <td>{pk.rosterSlot}</td><td>{Math.round(pk.adpAtPick)}</td>
                <td className={`val ${v > 0 ? 'pos' : v < 0 ? 'neg' : ''}`}>{v > 0 ? `+${v}` : v}</td>
              </tr>
            );
          })}
          <tr><td colSpan={5} style={{ textAlign: 'right', color: 'var(--muted)' }}>Roster value total</td><td className={`val ${totalDisplay > 0 ? 'pos' : totalDisplay < 0 ? 'neg' : ''}`}>{totalDisplay > 0 ? `+${totalDisplay.toFixed(1)}` : totalDisplay.toFixed(1)}</td></tr>
        </tbody>
      </table>

      <div className="read-ph">THE READ — grade + voice-bible prose ships next session.</div>

      <div style={{ display: 'flex', gap: 12, marginTop: 18 }}>
        <a className="sim-cta" href="/sim">Draft again</a>
        <a href="/sim" style={{ alignSelf: 'center', fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)', textDecoration: 'none' }}>History (soon)</a>
      </div>
    </div>
  );
}
