/**
 * SquadList — full team roster as a compact list, grouped by position.
 *
 * Stats-independent: reads only players-by-current_team_id (lib/players
 * .getTeamSquad). Every name links to /player/{slug}. Coexists with
 * TopPlayers — TopPlayers becomes "featured 3" once stats land; this
 * stays as the canonical full-roster surface.
 *
 * Net-new to the team mock — the mock's "Full squad →" CTA pointed at
 * a roster surface that didn't exist. Built to the locked design
 * system: § section head (Saira italic title), position-group subheads
 * in JetBrains Mono, rows are jersey-number + name (mono number, Saira
 * italic name). NO 26-photo grid. The list shape is the point.
 */

const POSITION_BUCKETS = [
  { key: 'GK',    label: 'Goalkeepers' },
  { key: 'DEF',   label: 'Defenders'   },
  { key: 'MID',   label: 'Midfielders' },
  { key: 'ATT',   label: 'Forwards'    },
  { key: 'OTHER', label: 'Other'       },
];

function bucketFor(position) {
  if (position === 'GK' || position === 'DEF' || position === 'MID' || position === 'ATT') return position;
  return 'OTHER';
}

function SquadRow({ player }) {
  const num = player.current_team_jersey_number;
  return (
    <a className="squad-row" href={`/player/${player.slug}`}>
      <span className="squad-row-num">{num != null ? num : '—'}</span>
      <span className="squad-row-name">{player.full_name}</span>
    </a>
  );
}

export default function SquadList({ players, teamName }) {
  if (!players || players.length === 0) return null;

  // Bucket without losing any rows; the SQL ORDER BY already places
  // GK→DEF→MID→ATT→OTHER and sorts within each by jersey + name.
  const byBucket = { GK: [], DEF: [], MID: [], ATT: [], OTHER: [] };
  for (const p of players) byBucket[bucketFor(p.position)].push(p);

  return (
    <section className="page-section" id="squad">
      <div className="section-head">
        <div className="section-head-left">
          <span className="section-head-num">§ Squad</span>
          <h2 className="section-head-title">
            The <span className="accent">{players.length}</span>
          </h2>
        </div>
      </div>

      <div className="squad-list">
        {POSITION_BUCKETS.map(({ key, label }) => {
          const group = byBucket[key];
          if (!group || group.length === 0) return null;
          return (
            <div key={key} className="squad-group">
              <div className="squad-group-head">
                <span className="squad-group-label">{label}</span>
                <span className="squad-group-count">{group.length}</span>
              </div>
              <div className="squad-group-rows">
                {group.map((p) => (
                  <SquadRow key={p.slug} player={p} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
