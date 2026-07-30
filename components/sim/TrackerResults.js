// components/sim/TrackerResults.js — results for a completed TRACKER draft.
//
// NO LETTER GRADE ANYWHERE, by design and not by omission. grade.js's bands are
// calibrated on 300 seeded MOCK auto-drafts; a real draft room is a different
// population, so a letter here would extend a calibrated claim to data it was
// never calibrated against. What this shows instead is the VALUE LEDGER: every
// pick, its ADP at the moment it was taken, and the arithmetic difference. Each
// number is a fact, not a judgement — which is why the fine print says so.
//
// Server component: getTrackerResults + getOrCreateTrackerRead run on the server
// and the shape arrives whole.

import { FFC_ATTRIBUTION } from '@/lib/fantasy/attribution';
import { seatLabel } from '@/lib/fantasy/tracker';

const val = (pk) => Math.round((pk.overallPick - pk.adpAtPick) * 10) / 10;
const cls = (v) => (v > 1 ? 'val' : (v < -1 ? 'rch' : 'even'));
const sign = (v) => `${v > 0 ? '+' : ''}${v}`;

export default function TrackerResults({ data }) {
  if (!data) return null;
  const { results, prose } = data;
  if (data.notComplete) {
    return <div className="trk-empty">This draft is still in progress.</div>;
  }
  const { config, userPicks, rosterValueTotal, bestValue, biggestReach, byeStackWarnings, teamLabels, userTeamIndex } = results;
  // engine sign is adp - pick (negative = value); flip it so positive reads good,
  // matching every other value figure in the product.
  const total = Math.round(-Number(rosterValueTotal ?? 0) * 10) / 10;
  const scoring = String(config.scoring_format ?? '').toUpperCase();

  return (
    <div className="trk" data-surface="ink">
      <div className="trk-in">
        <div className="trk-sec">
          TRACKED DRAFT · {config.teams_count} TEAM {scoring}
          <span className="r">{seatLabel(teamLabels, userTeamIndex, userTeamIndex)}</span>
        </div>

        {/* THE READ — grade-free prose over the ledger. */}
        {prose && (
          <section className="trk-need">
            <div className="trk-k">THE READ</div>
            <div className="line" style={{ fontStyle: 'normal' }}>{prose}</div>
          </section>
        )}

        {/* Headline figure: the whole roster against the market. No letter. */}
        <section className="trk-need">
          <div className="trk-k">AGAINST THE MARKET</div>
          <div className="line">
            Across {userPicks.length} picks this roster came in{' '}
            <b>{sign(total)}</b>{' '}
            {total >= 0 ? 'picks under where the market had it.' : 'picks ahead of where the market had it.'}
          </div>
          {bestValue && (
            <div className="trk-ba">
              <span className="nm">{bestValue.playerName}</span>
              <span className="tag">BEST VALUE · RD {bestValue.round}</span>
              <span className="gap">{sign(val(bestValue))}</span>
            </div>
          )}
          {biggestReach && (
            <div className="trk-ba">
              <span className="nm">{biggestReach.playerName}</span>
              <span className="tag">EARLIEST VS ADP · RD {biggestReach.round}</span>
              <span className="gap gone">{sign(val(biggestReach))}</span>
            </div>
          )}
        </section>

        {/* THE LEDGER — every pick, pick number vs frozen ADP. */}
        <div className="trk-sec">THE LEDGER<span className="r">PICK VS ADP</span></div>
        {userPicks.slice().sort((a, b) => a.overallPick - b.overallPick).map((pk) => {
          const v = val(pk);
          return (
            <div className="trk-b" key={pk.overallPick}>
              <span className="n">{pk.round}</span>
              <span className="team">{pk.slotPos}</span>
              <div>
                <span className="nm">{pk.synthetic ? `Replacement ${pk.slotPos}` : pk.playerName}</span>{' '}
                <span className="pt">ADP {Number(pk.adpAtPick).toFixed(1)} · PICK {pk.overallPick}</span>
              </div>
              <span className={`v ${cls(v)}`}>{sign(v)}</span>
            </div>
          );
        })}

        {byeStackWarnings?.length > 0 && (
          <>
            <div className="trk-sec">BYE STACKS</div>
            {byeStackWarnings.map((w) => (
              <div className="trk-slot" key={w.bye}>
                <span className="pos-t">WK {w.bye}</span>
                <span className="nm">{w.players.join(', ')}</span>
              </div>
            ))}
          </>
        )}

        <div className="trk-fine">
          Value shown is pick number vs the ADP frozen at the moment of the pick - an observation, not a verdict.
          Tracked drafts are not graded: the sim&apos;s grade bands are calibrated on mock drafts and do not describe a real room.{' '}
          {FFC_ATTRIBUTION.text} <a href={FFC_ATTRIBUTION.url} target="_blank" rel="noopener noreferrer">{FFC_ATTRIBUTION.host}</a>.
        </div>

        <div style={{ padding: '4px 16px 32px' }}>
          <a className="sim-cta" href="/sim">Back to lobby</a>
        </div>
      </div>
    </div>
  );
}
