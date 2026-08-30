'use client';

/**
 * GameTabs - the only client island on /nfl/game/[slug].
 *
 * It owns exactly two pieces of state: which panel is showing, and which
 * scoring format the FPTS columns read from. Every panel's content was rendered
 * on the server and shipped in the first response, so switching tabs is a CSS
 * change rather than a fetch.
 *
 * THE FANTASY NUMBERS ARE NOT COMPUTED HERE. Each row arrives carrying its
 * points in all three formats, produced server-side by lib/fantasy/scoring.js -
 * the same function the sim grades picks with. The toggle picks between three
 * numbers that module already produced. A browser-side recompute would be the
 * second implementation of the scoring rules, and it would be the one readers
 * actually see.
 *
 * THE RAIL IS BUILT FROM DATA, NOT FROM A LIST OF SECTIONS. The `panels` prop
 * only contains tabs whose panel has something in it, so a game with no scoring
 * plays has no SCORING tab rather than a SCORING tab with an empty frame.
 */

import { useState } from 'react';

const FORMATS = [
  { key: 'ppr', label: 'PPR' },
  { key: 'half-ppr', label: 'HALF' },
  { key: 'standard', label: 'STD' },
];

const fmtPts = (n) => (n == null ? '' : n.toFixed(1));

/**
 * @param {object[]} panels  [{key, label}] - only the tabs that have data
 * @param {object}   nodes   server-rendered panel content, KEYED rather than
 *   positional. An array would have silently paired the wrong panel with the
 *   wrong tab the first time a game had a brief but no scoring plays.
 */
export default function GameTabs({ panels, nodes, leaders, teams, boxLabel = null }) {
  const [active, setActive] = useState(panels[0]?.key);
  const [format, setFormat] = useState('ppr');
  const [team, setTeam] = useState(teams[0]?.id);
  const [allGroups, setAllGroups] = useState(false);

  const current = teams.find((t) => t.id === team) ?? teams[0];
  const tables = (current?.tables ?? []).filter((t) => allGroups || t.primary);
  const hasSecondary = (current?.tables ?? []).some((t) => !t.primary);

  return (
    <>
      <div className="gg-tabs" role="tablist" aria-label="Game sections">
        {panels.map((p) => (
          <button
            key={p.key}
            type="button"
            role="tab"
            aria-selected={active === p.key}
            className={`gg-tab${active === p.key ? ' on' : ''}`}
            onClick={() => setActive(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {panels.map((p) => (
        <div key={p.key} className={`gg-panel${active === p.key ? ' on' : ''}`} role="tabpanel">
          {p.key === 'players' ? (
            <section aria-label="Player statistics">
              {/* WHAT THIS BOX SCORE IS. A live one has to say so - every
                  number in it is going to change - and a bridge one has to say
                  what is still missing, or four groups read as the whole
                  night's work. A settled final carries no caveat at all: the
                  absence of the badge is the claim. The reader decides which;
                  this only draws it. */}
              <div className="gg-kick">
                <h2>PLAYER LINES</h2>
                {boxLabel ? (
                  <span className={`gg-boxstate${boxLabel.live ? ' live' : ''}`}>{boxLabel.text}</span>
                ) : null}
                <div className="rule" />
              </div>

              {leaders[format]?.length ? (
                <div className="gg-grp gg-lead-grp">
                  <div className="gg-grp-head">
                    <h3>FANTASY · {FORMATS.find((f) => f.key === format).label}</h3>
                    <div className="gg-fmt" role="group" aria-label="Scoring format">
                      {FORMATS.map((f) => (
                        <button
                          key={f.key}
                          type="button"
                          className={`gg-fmt-b${format === f.key ? ' on' : ''}`}
                          aria-pressed={format === f.key}
                          onClick={() => setFormat(f.key)}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <table className="gg-st">
                    <thead>
                      <tr><th className="p" scope="col">PLAYER</th><th className="l" scope="col">LINE</th><th scope="col">FPTS</th></tr>
                    </thead>
                    <tbody>
                      {leaders[format].map((p2, n) => (
                        <tr key={`${p2.teamId}-${p2.name}`} className={n === 0 ? 'lead' : ''}>
                          <td className="p">{p2.name}</td>
                          <td className="l">{p2.line}</td>
                          <td>{fmtPts(p2.pts[format])}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="gg-note">
                    Both squads, ranked by the same scoring module the draft sim uses. Kickers and
                    defenders are absent from this table on purpose - that module scores field goals
                    without distances and defensive plays without points allowed, so their totals are
                    short by a known amount and do not belong in a ranking.
                  </p>
                </div>
              ) : null}

              {teams.length > 1 ? (
                <div className="gg-teamtabs" role="tablist" aria-label="Team">
                  {teams.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      role="tab"
                      aria-selected={team === t.id}
                      className={`gg-ttab${team === t.id ? ' on' : ''}`}
                      onClick={() => setTeam(t.id)}
                    >
                      {t.abbr}
                    </button>
                  ))}
                </div>
              ) : null}

              {tables.map((tb) => (
                <StatTable key={tb.group} table={tb} format={format} />
              ))}

              {hasSecondary ? (
                <button type="button" className="gg-more" onClick={() => setAllGroups((v) => !v)}>
                  {allGroups ? 'Fewer groups' : 'All groups'}
                </button>
              ) : null}

              <p className="gg-note">
                Stat groups appear only when something happened in them - a night with no
                interceptions has no interceptions table. The volt tick marks the game leader.
              </p>
            </section>
          ) : nodes[p.key]}
        </div>
      ))}
    </>
  );
}

function StatTable({ table, format }) {
  // Sorted here rather than on the server because the sort key IS the toggle:
  // a receiving table ordered by PPR reads as mis-sorted the moment somebody
  // switches to standard. The numbers themselves still come from the server.
  const rows = table.showFpts
    ? [...table.rows].sort((a, b) => b.pts[format] - a.pts[format] || a.name.localeCompare(b.name))
    : table.rows;

  return (
    <div className="gg-grp">
      <h3>{table.label}</h3>
      <table className="gg-st">
        <thead>
          <tr>
            <th className="p" scope="col">PLAYER</th>
            {table.headings.map((h) => <th key={h} scope="col">{h}</th>)}
            {table.showFpts ? <th scope="col">FPTS</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, n) => (
            <tr key={r.name} className={table.showFpts && n === 0 ? 'lead' : ''}>
              {/* IDENTICAL GRAMMAR, LINKED OR NOT. A player whose profile we
                  hold gets an anchor; one we do not get the same name in the
                  same place with no marker, no footnote and no grey. The link
                  is a convenience, not a status. */}
              <td className="p">
                {r.slug ? <a className="gg-pl" href={`/player/${r.slug}`}>{r.name}</a> : r.name}
                {r.position || r.jersey ? (
                  <span className="gg-pmeta">
                    {[r.position, r.jersey != null ? `#${r.jersey}` : null].filter(Boolean).join(' ')}
                  </span>
                ) : null}
              </td>
              {r.cells.map((c, j) => <td key={table.headings[j]}>{c}</td>)}
              {table.showFpts ? <td>{fmtPts(r.pts[format])}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
