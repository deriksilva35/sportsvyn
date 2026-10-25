// components/scores/ScoresTabs.js - Games | Stats, under the Scoreboard's head.
// Server component; the links are TabLinks, which write the sv_scores_tab cookie.
import TabLink from '@/components/scores/TabLink';

export default function ScoresTabs({ active = 'games', sport = 'all' }) {
  const s = sport && sport !== 'all' ? `&sport=${sport}` : '';
  return (
    <div className="svs-tabs" role="tablist" aria-label="Scoreboard view" data-section="tabs">
      <TabLink tab="games" role="tab" aria-selected={active === 'games'} className={`svs-tab${active === 'games' ? ' on' : ''}`} href={`/scores?tab=games${s}`} data-tab="games">Games</TabLink>
      <TabLink tab="stats" role="tab" aria-selected={active === 'stats'} className={`svs-tab${active === 'stats' ? ' on' : ''}`} href={`/scores?tab=stats${s}`} data-tab="stats">Stats</TabLink>
    </div>
  );
}
