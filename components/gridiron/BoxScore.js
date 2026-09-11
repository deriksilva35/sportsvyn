// components/gridiron/BoxScore.js - the BOX SCORE tab: one header row per
// team (helmet + abbreviation), then the four groups as compact tables in the
// LINE SCORE grammar (.gg-ls: mono numerals, quiet headers, the same rules).
// Server-rendered; on a live game it refreshes with the page, like the line
// score. Renders nothing without rows - the tab is not offered then.
import Helmet from '@/components/team/Helmet';

export default function BoxScore({ boxScore, teams = [] }) {
  if (!boxScore?.length) return null;
  const colorsOf = (id) => teams.find((t) => t?.id === id)?.colors ?? null;
  return (
    <section aria-label="Box score" className="gg-box">
      {boxScore.map((t) => (
        <div className="gg-boxteam" key={t.teamId}>
          <div className="gg-boxhead">
            <Helmet primary={colorsOf(t.teamId)?.primary} secondary={colorsOf(t.teamId)?.secondary} facing="right" size={22} className="gg-hm" />
            <span className="abbr">{t.abbr}</span>
          </div>
          {t.groups.map((g) => (
            <table className="gg-ls gg-boxgrp" key={g.key}>
              <thead>
                <tr>
                  <th className="t" scope="col">{g.label}</th>
                  {g.headings.map((h) => <th key={h} scope="col">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={`${g.key}-${r.name}`}>
                    <th className="t" scope="row">{r.name}{r.position ? <span className="gg-boxpos"> {r.position}</span> : null}</th>
                    {r.cells.map((c, i) => <td key={g.headings[i]}>{c}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
      ))}
    </section>
  );
}
