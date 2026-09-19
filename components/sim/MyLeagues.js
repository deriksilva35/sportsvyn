// components/sim/MyLeagues.js — imported leagues, above the practice deck.
//
// ABOVE THE PRESETS BECAUSE A REAL LEAGUE OUTRANKS A REHEARSAL. The deck below
// is the practice range; this is the reader's actual draft, with their actual
// keepers in it.
//
// RENDERS NOTHING WHEN THERE ARE NONE - the lobby (app/sim/page.js) puts the
// JOIN-BY-CODE band in this slot instead, because a reader with no league of
// their own is exactly the reader holding a friend's code. With leagues, the
// same field sits as a small persistent row under the cards: a second league's
// code has somewhere to go without hunting.

import LeagueStart from './LeagueStart';
import LeagueShare from './LeagueShare';
import JoinByCode from './JoinByCode';
import Link from 'next/link';
import { dayHeading, kickoffParts } from '@/lib/gridiron/kickoff';
import { trackerHandoffHref } from '@/lib/fantasy/handoff';

export default function MyLeagues({ leagues, tz = null, userId = null }) {
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
                seat is YOUR franchise - the one you claimed (085), or for the
                owner the imported isMine team; an unclaimed member has none
                and the strip opens on seat 1. Each pill carries that team's
                keeper count. */}
            <LeagueStart
              configId={l.id}
              teamsCount={l.teams_count}
              defaultSeat={l.default_seat ?? null}
              keptBySeat={l.kept_by_seat ?? null}
            />
            {/* TRACK A LIVE DRAFT - the tracker's door, moved here from the
                Games tab (GAMES v3 addendum). It belongs on a LEAGUE row and
                nowhere else: the tracker's whole job is to follow a draft
                happening somewhere else, and "somewhere else" is a league you
                imported, not a practice preset.

                IT CARRIES THIS LEAGUE'S SHAPE, through the same handoff
                StartForm packs - teams, scoring and the roster - so the
                tracker opens on the board you are actually sitting at instead
                of asking you to re-describe it. A league row is the one place
                that shape is already known. */}
            <Link
              className="sml-track"
              href={trackerHandoffHref({
                teamsCount: l.teams_count,
                scoringFormat: l.scoring_format,
                rosterSlots: l.roster_slots ?? {},
              })}
            >
              Track a live draft &rarr;
            </Link>

            {/* Who is in, the invite (owner), the league's mocks. */}
            <LeagueShare
              configId={l.id}
              role={l.role}
              members={l.members ?? []}
              invite={l.invite ?? null}
              mocks={l.mocks ?? []}
              myUserId={userId}
            />
          </div>
        );
      })}
      {/* The persistent entry: a code typed here goes the same road as a
          tapped link (/join/{code}). */}
      <JoinByCode variant="row" />
    </section>
  );
}
