// components/sim/MyLeagues.js — imported leagues, above the practice deck.
//
// ABOVE THE PRESETS BECAUSE A REAL LEAGUE OUTRANKS A REHEARSAL. The deck below
// is the practice range; this is the reader's actual draft, with their actual
// keepers in it.
//
// RENDERS NOTHING WHEN THERE ARE NONE. A frame reading "no leagues yet" on the
// app's most-visited screen would be a permanent advertisement for a feature
// most readers have not asked for.

import LeagueStart from './LeagueStart';
import { dayHeading, kickoffParts } from '@/lib/gridiron/kickoff';

export default function MyLeagues({ leagues, tz = null }) {
  if (!leagues?.length) return null;
  return (
    <section className="sim-myleagues">
      <div className="sim-kicker">My leagues</div>
      {leagues.map((l) => {
        const day = l.draft_date ? dayHeading(l.draft_date, tz ?? 'America/New_York') : null;
        const at = l.draft_date ? kickoffParts(l.draft_date, tz ?? 'America/New_York') : null;
        return (
          <div key={l.id} className="sml-card">
            <span className="sml-name">{l.name}</span>
            <span className="sml-meta">
              {l.teams_count} teams · {String(l.scoring_format).toUpperCase()}
              {/* A CHIP MAY ONLY CLAIM KNOWLEDGE: no keepers, no keeper chip -
                  never "0 keepers", which reads as a broken import. */}
              {l.keeper_count > 0 ? ` · ${l.keeper_count} keepers` : ''}
            </span>
            {day ? <span className="sml-when">Draft {day}{at ? ` · ${at.time}` : ''}</span> : null}
            {/* The real start action, not a link: see LeagueStart. The default
                seat is your own team (isMine); the strip lets this run play any
                franchise, each pill carrying that team's keeper count. */}
            <LeagueStart
              configId={l.id}
              teamsCount={l.teams_count}
              defaultSeat={(l.teams ?? []).find((t) => t.isMine === true)?.slot ?? null}
              keptBySeat={l.kept_by_seat ?? null}
            />
          </div>
        );
      })}
    </section>
  );
}
