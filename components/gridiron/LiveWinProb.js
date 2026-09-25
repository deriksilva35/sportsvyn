// components/gridiron/LiveWinProb.js - OUR live win probability, NFL game page
// only. It takes the pre-kickoff market strip's place once the game is live
// (components/gridiron/OddsStrip.js keeps the pre-kickoff read), in the same
// two-way form: away left, home right, no draw row.
//
// THE RULES IT DRAWS BY (Derik, 26 Sep, carried from the soccer draft):
//   - captioned "Win Probability · our live read" with a CALIBRATING tag and
//     one line of gloss - the model shipped by override (GATE-nfl.md)
//   - no number, no bar: a game with no line has no live_state.win_prob and
//     this renders nothing - never a 50/50
//   - the feed stale past 90 s: dimmed, captioned "Paused - feed reconnecting"
//   - past 5 minutes: gone
//   - at the final whistle it retires; the recap owns full time (the page only
//     mounts this while the game is live)

export const STALE_SEC = 90;
export const DEAD_SEC = 300;

/**
 * PURE. What the block should be, from the stored value and its stamp.
 * @returns null (render nothing) | { home, away, stale }
 */
export function liveWinProbView(liveState, now = new Date()) {
  const home = liveState?.win_prob;
  if (!Number.isInteger(home) || home < 0 || home > 100) return null;
  const at = Date.parse(liveState?.win_prob_at ?? '');
  if (!Number.isFinite(at)) return null;
  const age = (new Date(now).getTime() - at) / 1000;
  if (age > DEAD_SEC) return null;
  return { home, away: 100 - home, stale: age > STALE_SEC };
}

export default function LiveWinProb({ liveState, awayAbbr, homeAbbr, now = new Date() }) {
  const v = liveWinProbView(liveState, now);
  if (!v) return null;
  const homeFav = v.home >= v.away;
  return (
    <div className={`gi-odds gi-wp-live${v.stale ? ' stale' : ''}`} data-winprob="live" data-stale={v.stale ? '1' : '0'}>
      <div className="gi-odds-h gi-wp-h">
        <span className="lbl">Win Probability · our live read</span>
        <span className="gi-wp-cal">Calibrating</span>
      </div>
      {/* ITS OWN LINE, AT FULL STRENGTH: the words that say the number is old
          are the one thing on the block that must not fade with it. */}
      {v.stale ? <div className="gi-wp-paused">Paused — feed reconnecting</div> : null}
      <div className="gi-odds-bar" role="img" aria-label={`Win probability: ${awayAbbr} ${v.away}%, ${homeAbbr} ${v.home}%`}>
        <div className={`seg away ${!homeFav ? 'fav' : ''}`} style={{ width: `${v.away}%` }} />
        <div className={`seg home ${homeFav ? 'fav' : ''}`} style={{ width: `${v.home}%` }} />
      </div>
      <div className="gi-odds-sides">
        <div className={`gi-odds-side ${!homeFav ? 'fav' : ''}`}><div className="abbr">{awayAbbr}</div><div className="pct">{v.away}%</div></div>
        <div className={`gi-odds-side ${homeFav ? 'fav' : ''}`}><div className="abbr">{homeAbbr}</div><div className="pct">{v.home}%</div></div>
      </div>
      <div className="gi-odds-fine">Our live model, still being validated against results.</div>
    </div>
  );
}
