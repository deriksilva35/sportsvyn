// components/standings/StandingsPage.js — one shell, two codes.
//
// A SIBLING SHELL, NOT A CONDITIONAL PAGE. The two codes share chrome — the
// sub-nav, the lede, the section grammar — and differ in exactly two ways: how
// rows are grouped, and which columns a reader of that sport expects. Those two
// differences arrive as PROPS, so neither route carries an `if (league ===` and
// a third code can be added by passing a column set rather than by editing a
// branch.
//
// COLLEGE SHOWS A NEUTRAL-SITE COLUMN because a neutral-site game is ordinary
// there — UNC and TCU opened this season in Dublin. The NFL shows points for
// and against, and a playoff seed, because those are what its races are argued
// from. Neither is a special case of the other.
//
// THE ORDER IS A READABLE DEFAULT, NOT A TIEBREAK, and the page says so at the
// foot. Real tiebreaks are head-to-head, common games and conference record;
// the leagues publish them and inventing our own would mean disagreeing with
// the league on the one week it matters.

import Link from 'next/link';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import BackToAppBar from '@/components/BackToAppBar';
import { getLeagueRecords } from '@/lib/standings/read';
import { groupRecords } from '@/lib/standings/view';
import '@/components/gridiron/gridiron.css';
import './standings.css';

export default async function StandingsPage({
  leagueSlug, leagueLabel, season, tabs, groupBy, columns, classification = null,
  divisionToggle = null, note,
}) {
  const rows = await getLeagueRecords(leagueSlug, season, { classification }).catch(() => []);
  const groups = groupRecords(rows, groupBy);

  return (
    <div className="gi" data-surface="ink">
      <BackToAppBar />
      <GlobalHeaderServer activeNav={leagueSlug} />

      <nav className="gi-subnav">
        {tabs.map((t) => (
          <a key={t.label} className={t.active ? 'active' : ''} href={t.href}>{t.label}</a>
        ))}
        <span className="gi-season">{season} SEASON · <b>STANDINGS</b></span>
      </nav>

      <section className="gi-lede">
        <div className="gi-lede-in">
          <div className="kick"><span className="sq" />{leagueLabel} · {season} SEASON</div>
          <h1>{leagueLabel} Standings</h1>
          {note ? <p>{note}</p> : null}
        </div>
      </section>

      <div className="st-wrap">
        {divisionToggle ? (
          <div className="st-toggle" role="group" aria-label="Division">
            {divisionToggle.options.map((o) => (
              <Link
                key={o.value}
                href={o.href}
                className={`st-tab${o.active ? ' on' : ''}`}
                aria-current={o.active ? 'page' : undefined}
              >
                {o.label}
              </Link>
            ))}
          </div>
        ) : null}

        {/* PRESENT BUT EMPTY, NEVER MISSING. A season that has not started has
            no rows, and a page that vanishes is indistinguishable from a page
            that broke. */}
        {groups.length === 0 ? (
          <div className="st-empty">
            Standings open once games go final.
          </div>
        ) : groups.map((g) => (
          <section className="st-sect" key={g.label} aria-label={g.label}>
            <div className="st-sect-h"><h2>{g.label}</h2><span className="rule" /></div>
            <div className="st-scroll">
              <table className="st-tbl">
                <thead>
                  <tr>
                    <th className="l" scope="col">Team</th>
                    {columns.map((c) => (
                      <th key={c.key} scope="col" title={c.title ?? undefined}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r) => (
                    <tr key={r.id}>
                      <th className="l" scope="row">
                        <span className="st-abbr">{r.abbreviation ?? ''}</span>
                        <span className="st-nm">{r.short_name ?? r.name}</span>
                      </th>
                      {columns.map((c) => (
                        <td key={c.key} className={c.numeric ? 'n' : undefined}>{c.cell(r)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}

        <p className="st-note">
          Ordered by win percentage, then wins, then losses. That is a readable
          default, not a tiebreak - head-to-head, common games and conference
          record decide real ties, and the league publishes those.
        </p>
      </div>

      <SiteFooter />
    </div>
  );
}
