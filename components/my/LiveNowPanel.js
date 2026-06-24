/**
 * LiveNowPanel: server component.
 *
 * Only renders when at least one followed match is live. The page
 * caller is responsible for the visibility gate (it omits this panel
 * entirely when getLiveNow returns []), so this component does not
 * include its own empty state.
 *
 * Pulsing dot + LIVE label use the same .live-pulse motif as the
 * homepage Live Watch Score rail. Score text plain; team names volt
 * via .team-name-followed when followed.
 */

import FlagSlot from '@/components/FlagSlot';

function NameSpan({ team, followedSet }) {
  const followed = team?.id != null && followedSet?.has(team.id);
  return (
    <span className={followed ? 'team-name-followed' : undefined}>
      {team?.name ?? ''}
    </span>
  );
}

export default function LiveNowPanel({ matches, followedSet }) {
  return (
    <section className="panel panel-live">
      <h2 className="phead">
        <span className="ln-dot" aria-hidden="true" />
        Live Now
      </h2>
      <div className="pbody">
        <ul className="ln-list">
          {matches.map((m) => {
            const hs = m.home_score ?? 0;
            const as = m.away_score ?? 0;
            return (
              <li key={m.id} className="ln-row">
                <a className="ln-link" href={`/match/${m.slug}`}>
                  <div className="ln-teams">
                    <span className="ln-team">
                      <FlagSlot
                        flagSvgPath={m.home?.flag_svg_path}
                        colorPrimary={m.home?.flag_color_primary}
                        size="sm"
                      />
                      <NameSpan team={m.home} followedSet={followedSet} />
                    </span>
                    <span className="ln-score">{hs} to {as}</span>
                    <span className="ln-team">
                      <FlagSlot
                        flagSvgPath={m.away?.flag_svg_path}
                        colorPrimary={m.away?.flag_color_primary}
                        size="sm"
                      />
                      <NameSpan team={m.away} followedSet={followedSet} />
                    </span>
                  </div>
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
