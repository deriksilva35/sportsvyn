// components/coins/ResultsView.js - THE TUESDAY REVEAL (coins-2 B5; mock screen 4).
//
// Your result first (signed in), then every drum's winners - handle, and the
// state once the first-win sheet has it (Rules s7: handle and state, never a
// city) - then THE DRAW, SHOWN: coins, players, the seed, and "Check it", the
// published tickets and order anyone can rerun (lib/coins/draw.js).

import Link from 'next/link';
import { tileLabel, drumTitle } from '@/lib/coins/copy';

export default function ResultsView({ r, me = null, nextLabel = null, checkHref = null, preview = false }) {
  const won = me?.won ?? null;
  return (
    <>
      {preview && <div className="cn-note" role="note" style={{ marginBottom: 12 }}>DRY RUN: the open week drawn as if it closed now. Nothing was written and nobody was told.</div>}
      <div className="cn-result">
        <div className="cn-eyebrow cn-mono">WEEK {r.ordinal} · DRAWN TUE 9:00 AM PT</div>
        {me ? (
          <>
            <h2 className="cn-mono">{won ? 'YOU WON' : 'NOT THIS WEEK'}</h2>
            <p>{won
              ? `A coin of yours won ${won}. Confirm your details to claim it within 14 days.`
              : me.coins ? `Your ${me.coins} coin${me.coins === 1 ? ' was' : 's were'} in. Week ${r.ordinal + 1} coins start now: play any game for your first.` : 'You had no coins in this week. Play any game for your first coin.'}</p>
          </>
        ) : <h2 className="cn-mono">THE RESULTS</h2>}
        <Link href="/coins" className="cn-go cn-mono" style={{ maxWidth: 240, minHeight: 44, marginTop: 6 }}>{won ? 'OPEN THE DRUM' : `START WEEK ${r.ordinal + 1}`}</Link>
      </div>

      <div className="cn-sub"><span className="cn-mono">WEEK {r.ordinal} WINNERS</span></div>
      <div className="cn-list">
        {r.drums.map((d) => (
          <div key={d.prize_key}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span className={`cn-tile cn-mono${d.kind === 'merch' ? ' merch' : ''}`} style={{ width: 48, height: 34 }}>{tileLabel(d)}</span>
              <div>
                <b>{d.winners.length ? d.winners.map((w) => w.label).join(' · ') : 'No coins in this drum'}</b>
                <small>{drumTitle(d)} · {d.coins} coin{d.coins === 1 ? '' : 's'} in, {d.players} player{d.players === 1 ? '' : 's'}</small>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="cn-sub"><span className="cn-mono">THE DRAW, SHOWN</span></div>
      <div className="cn-list cn-shown">
        <div><small>Coins in all drums</small><span className="cn-mono">{r.coins}</span></div>
        <div><small>Players entered</small><span className="cn-mono">{r.players}</span></div>
        <div><small>Seed</small><span className="cn-mono cn-seed">{r.seed}</span></div>
      </div>
      <div className="cn-fine">
        Each coin is one ticket. The tickets of each drum are shuffled from the seed above, so anyone can rerun the draw and get the same winners.
        {checkHref ? <> <a href={checkHref}>Check it</a></> : null} <Link href="/coins/rules">How the draw works</Link>
      </div>
      {nextLabel && <div className="cn-note" style={{ marginTop: 12 }}><b>Week {r.ordinal + 1} drum is open</b><br />Drawn {nextLabel}, 9:00 am PT</div>}
    </>
  );
}
