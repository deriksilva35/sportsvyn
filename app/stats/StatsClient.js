'use client';

// app/stats/StatsClient.js: tab routing, All Stats sort state, and the
// SV Points tooltip (hover on desktop, tap-to-toggle on touch). All
// data is pre-fetched server-side and passed in as props; this
// component is presentation + interaction only.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

const TABS = [
  { id: 'overview',   label: 'Overview' },
  { id: 'all-stats',  label: 'All Stats' },
  { id: 'scorers',    label: 'Scorers' },
  { id: 'assists',    label: 'Assists' },
  { id: 'ga',         label: 'G+A' },
  { id: 'sv',         label: 'SV Points' },
  { id: 'discipline', label: 'Discipline' },
  { id: 'keepers',    label: 'Keepers',  soon: true },
  { id: 'defense',    label: 'Defense',  soon: true },
];

const VALID_TABS = new Set(TABS.map((t) => t.id));

// ---------------------------------------------------------------------------
// SV Points tooltip (hover on desktop, tap on touch)
// ---------------------------------------------------------------------------
function SvPointsTooltip() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    function onEsc(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  // Tap-to-toggle on touch via pointerdown discrimination. Hover paths
  // (mouseenter/mouseleave) cover desktop; the click handler covers
  // touch since touch events always fire a click after the tap. To
  // keep both behaviors clean: hover OPENS on desktop, click TOGGLES
  // on touch. We treat any click as toggle, and rely on the click
  // outside / escape handlers to close.
  return (
    <span ref={wrapRef} className="sv-tip">
      <button
        type="button"
        className="sv-tip-btn"
        aria-expanded={open}
        aria-label="What is SV Points?"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        ?
      </button>
      <div
        className={`sv-tip-popover${open ? ' open' : ''}`}
        role="tooltip"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <h4>SV Points v1</h4>
        <dl>
          <dt>Goal (ATT / MID)</dt><dd>+5</dd>
          <dt>Goal (DEF / GK)</dt><dd>+6</dd>
          <dt>Penalty bonus</dt>  <dd>+2</dd>
          <dt>Assist</dt>         <dd>+3</dd>
          <dt>Own goal</dt>       <dd>{'−'}2</dd>
          <dt>Yellow card</dt>    <dd>{'−'}1</dd>
          <dt>Red card</dt>       <dd>{'−'}3</dd>
        </dl>
        <p className="sv-caveat">
          A Sportsvyn metric, not official fantasy. Minutes and keeper bonuses arrive with the next data layer.
        </p>
      </div>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function maxOf(rows, key) {
  let m = 0;
  for (const r of rows) if (Number(r[key]) > m) m = Number(r[key]);
  return m;
}

function TeamLine({ row }) {
  return (
    <span className="stats-pl">
      {row.player_slug
        ? <a href={`/player/${row.player_slug}`}>{row.player_name ?? '(unknown)'}</a>
        : (row.player_name ?? '(unknown)')}
      <span className="team">{row.team_name ?? row.team_abbr ?? ''}</span>
    </span>
  );
}

function PosPill({ row }) {
  if (!row.position) return null;
  return <span className="stats-pos">{row.position}</span>;
}

// ---------------------------------------------------------------------------
// Leaderboard renderers
// ---------------------------------------------------------------------------
function ScorersTable({ rows }) {
  const max = maxOf(rows, 'goals');
  return (
    <table className="stats-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Player</th>
          <th className="hidem">Pos</th>
          <th className="hidem stats-barcell">&nbsp;</th>
          <th className="num">Goals</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, idx) => (
          <tr key={`${r.player_api_id}-${idx}`}>
            <td className={`stats-rk${idx === 0 ? ' top' : ''}`}>{idx + 1}</td>
            <td><TeamLine row={r} /></td>
            <td className="hidem"><PosPill row={r} /></td>
            <td className="hidem stats-barcell">
              <div className="stats-bar"><i style={{ width: `${max > 0 ? Math.round((r.goals / max) * 100) : 0}%` }} /></div>
            </td>
            <td className="num big volt">{r.goals}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AssistsTable({ rows }) {
  const max = maxOf(rows, 'assists');
  return (
    <table className="stats-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Player</th>
          <th className="hidem">Pos</th>
          <th className="hidem stats-barcell">&nbsp;</th>
          <th className="num">Assists</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, idx) => (
          <tr key={`${r.player_api_id}-${idx}`}>
            <td className={`stats-rk${idx === 0 ? ' top' : ''}`}>{idx + 1}</td>
            <td><TeamLine row={r} /></td>
            <td className="hidem"><PosPill row={r} /></td>
            <td className="hidem stats-barcell">
              <div className="stats-bar"><i style={{ width: `${max > 0 ? Math.round((r.assists / max) * 100) : 0}%` }} /></div>
            </td>
            <td className="num big">{r.assists}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function GaTable({ rows }) {
  return (
    <table className="stats-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Player</th>
          <th className="hidem">Pos</th>
          <th className="num hidem">G</th>
          <th className="num hidem">A</th>
          <th className="num">G+A</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, idx) => (
          <tr key={`${r.player_api_id}-${idx}`}>
            <td className={`stats-rk${idx === 0 ? ' top' : ''}`}>{idx + 1}</td>
            <td><TeamLine row={r} /></td>
            <td className="hidem"><PosPill row={r} /></td>
            <td className="num hidem">{r.goals}</td>
            <td className="num hidem">{r.assists}</td>
            <td className="num big volt">{r.goal_contributions}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SvTable({ rows }) {
  return (
    <table className="stats-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Player</th>
          <th className="hidem">Pos</th>
          <th className="hidem">Breakdown</th>
          <th className="num">SV Pts</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, idx) => {
          const parts = [];
          if (r.goals > 0)         parts.push(`${r.goals}G`);
          if (r.assists > 0)       parts.push(`${r.assists}A`);
          if (r.penalty_goals > 0) parts.push(`${r.penalty_goals}P`);
          if (r.yellow_cards > 0)  parts.push(`${r.yellow_cards}Y`);
          if (r.red_cards > 0)     parts.push(`${r.red_cards}R`);
          if (r.own_goals > 0)     parts.push(`${r.own_goals}OG`);
          return (
            <tr key={`${r.player_api_id}-${idx}`}>
              <td className={`stats-rk${idx === 0 ? ' top' : ''}`}>{idx + 1}</td>
              <td><TeamLine row={r} /></td>
              <td className="hidem"><PosPill row={r} /></td>
              <td className="hidem stats-breakdown">{parts.join(' ')}</td>
              <td className="num big volt">{r.sv_points}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function DisciplineTable({ rows }) {
  return (
    <table className="stats-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Player</th>
          <th className="hidem">Pos</th>
          <th className="num">Y</th>
          <th className="num">R</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, idx) => (
          <tr key={`${r.player_api_id}-${idx}`}>
            <td className="stats-rk">{idx + 1}</td>
            <td><TeamLine row={r} /></td>
            <td className="hidem"><PosPill row={r} /></td>
            <td className="num">{r.yellow_cards}</td>
            <td className={`num${r.red_cards > 0 ? ' terra' : ''}`}>{r.red_cards}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// All Stats sortable table
// ---------------------------------------------------------------------------
const ALL_STATS_COLUMNS = [
  { key: 'player_name',        label: 'Player',  sort: (a, b) => String(a.player_name).localeCompare(String(b.player_name)), num: false },
  { key: 'position',           label: 'Pos',     sort: (a, b) => String(a.position ?? '').localeCompare(String(b.position ?? '')), num: false, hidemobile: true },
  { key: 'goals',              label: 'G',       sort: (a, b) => (a.goals ?? 0) - (b.goals ?? 0), num: true },
  { key: 'assists',            label: 'A',       sort: (a, b) => (a.assists ?? 0) - (b.assists ?? 0), num: true },
  { key: 'goal_contributions', label: 'G+A',     sort: (a, b) => (a.goal_contributions ?? 0) - (b.goal_contributions ?? 0), num: true },
  { key: 'yellow_cards',       label: 'Y',       sort: (a, b) => (a.yellow_cards ?? 0) - (b.yellow_cards ?? 0), num: true, hidemobile: true },
  { key: 'red_cards',          label: 'R',       sort: (a, b) => (a.red_cards ?? 0) - (b.red_cards ?? 0), num: true, hidemobile: true },
  { key: 'sv_points',          label: 'SV Pts',  sort: (a, b) => (a.sv_points ?? 0) - (b.sv_points ?? 0), num: true },
];

function AllStatsTable({ rows }) {
  const [sortKey, setSortKey] = useState('sv_points');
  const [sortDir, setSortDir] = useState('desc');

  const sorted = useMemo(() => {
    const col = ALL_STATS_COLUMNS.find((c) => c.key === sortKey) ?? ALL_STATS_COLUMNS[ALL_STATS_COLUMNS.length - 1];
    const base = [...rows].sort(col.sort);
    return sortDir === 'desc' ? base.reverse() : base;
  }, [rows, sortKey, sortDir]);

  function clickHeader(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'player_name' || key === 'position' ? 'asc' : 'desc');
    }
  }

  return (
    <table className="stats-table">
      <thead>
        <tr>
          <th>#</th>
          {ALL_STATS_COLUMNS.map((c) => (
            <th
              key={c.key}
              className={`sortable${c.num ? ' num' : ''}${c.hidemobile ? ' hidem' : ''}${sortKey === c.key ? ' sorted' : ''}`}
              data-arrow={sortKey === c.key ? (sortDir === 'desc' ? '↓' : '↑') : ''}
              onClick={() => clickHeader(c.key)}
            >
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map((r, idx) => (
          <tr key={`${r.player_api_id}-${idx}`}>
            <td className="stats-rk">{idx + 1}</td>
            <td><TeamLine row={r} /></td>
            <td className="hidem"><PosPill row={r} /></td>
            <td className="num">{r.goals}</td>
            <td className="num">{r.assists}</td>
            <td className="num">{r.goal_contributions}</td>
            <td className="num hidem">{r.yellow_cards}</td>
            <td className={`num hidem${r.red_cards > 0 ? ' terra' : ''}`}>{r.red_cards}</td>
            <td className="num volt">{r.sv_points}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Overview tile
// ---------------------------------------------------------------------------
function OverviewRow({ rank, name, team, value, valueClass }) {
  return (
    <div className="stats-ov-row">
      <span className="nm">
        <span className="rkn">{rank}</span>
        <span>{name}</span>
        {team ? <small>{team}</small> : null}
      </span>
      <span className={`vl${valueClass ? ' ' + valueClass : ''}`}>{value}</span>
    </div>
  );
}

function OverviewTile({ title, hrefAll, allLabel, children, extraHeading }) {
  return (
    <div className="stats-ov-cell">
      <h3>
        <span className="h3-left">
          {title}
          {extraHeading}
        </span>
        {hrefAll ? <a href={hrefAll}>{allLabel ?? 'All →'}</a> : null}
      </h3>
      {children}
    </div>
  );
}

function OverviewPanel({ overview, onTabSelect }) {
  const { totals, scorers, assists, goalContributions, svPoints, discipline } = overview;
  const subhead = `Matchday 1 · ${totals.live_matches > 0 ? 'live' : 'live snapshot'}`;
  return (
    <>
      <div className="stats-sec-head">
        <h2>Overview</h2>
        <span className="meta">{subhead}</span>
      </div>
      <div className="stats-ov-grid">
        <OverviewTile
          title="Top Scorers"
          hrefAll="?view=scorers"
          allLabel="All →"
        >
          {scorers.map((r, i) => (
            <OverviewRow
              key={r.player_api_id}
              rank={i + 1}
              name={r.player_name}
              team={r.team_name}
              value={r.goals}
              valueClass="volt"
            />
          ))}
        </OverviewTile>

        <OverviewTile title="Top Assists" hrefAll="?view=assists">
          {assists.map((r, i) => (
            <OverviewRow
              key={r.player_api_id}
              rank={i + 1}
              name={r.player_name}
              team={r.team_name}
              value={r.assists}
            />
          ))}
        </OverviewTile>

        <OverviewTile
          title="SV Points"
          hrefAll="?view=sv"
          extraHeading={<SvPointsTooltip />}
        >
          {svPoints.map((r, i) => (
            <OverviewRow
              key={r.player_api_id}
              rank={i + 1}
              name={r.player_name}
              team={r.team_name}
              value={r.sv_points}
              valueClass="volt"
            />
          ))}
        </OverviewTile>

        <OverviewTile title="Goal Contributions" hrefAll="?view=ga">
          {goalContributions.map((r, i) => (
            <OverviewRow
              key={r.player_api_id}
              rank={i + 1}
              name={r.player_name}
              team={r.team_name}
              value={r.goal_contributions}
            />
          ))}
        </OverviewTile>

        <OverviewTile title="Discipline" hrefAll="?view=discipline">
          {discipline.map((r, i) => (
            <OverviewRow
              key={r.player_api_id}
              rank={i + 1}
              name={r.player_name}
              team={r.team_name}
              value={`${r.yellow_cards}Y ${r.red_cards}R`}
            />
          ))}
        </OverviewTile>

        <OverviewTile title="Tournament">
          <OverviewRow rank=""  name="Goals scored"        value={totals.goals} />
          <OverviewRow rank=""  name="Matches played"      value={totals.matches_played} />
          <OverviewRow rank=""  name="Avg goals / match"   value={totals.avg_goals_per_match.toFixed(1)} />
          <OverviewRow rank=""  name="Assists recorded"    value={totals.assists_recorded} />
          <OverviewRow rank=""  name="Cards"               value={`${totals.yellow_cards}Y ${totals.red_cards}R`} />
        </OverviewTile>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main client component
// ---------------------------------------------------------------------------
export default function StatsClient({ initialTab, overview, allPlayers, leaderboards }) {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const [active, setActive] = useState(VALID_TABS.has(initialTab) ? initialTab : 'overview');
  const [allStatsSubview, setAllStatsSubview] = useState('players');

  // Keep the active tab in sync with the URL when the user uses back/forward.
  useEffect(() => {
    const fromUrl = searchParams.get('view');
    if (fromUrl && VALID_TABS.has(fromUrl) && fromUrl !== active) {
      setActive(fromUrl);
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  function selectTab(id) {
    if (!VALID_TABS.has(id)) return;
    setActive(id);
    const params = new URLSearchParams(searchParams.toString());
    if (id === 'overview') params.delete('view'); else params.set('view', id);
    const qs = params.toString();
    router.push(qs ? `/stats?${qs}` : '/stats', { scroll: false });
  }

  return (
    <>
      <nav className="stats-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`stats-tab${active === t.id ? ' active' : ''}`}
            onClick={() => selectTab(t.id)}
          >
            {t.label}
            {t.soon ? <span className="stats-soon">soon</span> : null}
          </button>
        ))}
      </nav>

      {active === 'overview' && (
        <div className="stats-panel show">
          <OverviewPanel overview={overview} onTabSelect={selectTab} />
        </div>
      )}

      {active === 'all-stats' && (
        <div className="stats-panel show">
          <div className="stats-sec-head">
            <h2>All Stats</h2>
            <span className="meta">Sortable {'·'} click any column</span>
          </div>
          <div className="stats-subtoggle">
            <button
              type="button"
              className={allStatsSubview === 'players' ? 'active' : ''}
              onClick={() => setAllStatsSubview('players')}
            >Players</button>
            <button
              type="button"
              className={allStatsSubview === 'teams' ? 'active' : ''}
              onClick={() => setAllStatsSubview('teams')}
            >Teams</button>
          </div>
          {allStatsSubview === 'players' ? (
            <AllStatsTable rows={allPlayers} />
          ) : (
            <div className="stats-soonpanel">
              <div className="tag">Coming soon</div>
              <h3>Teams</h3>
              <p>Team aggregates derive from match data; the pipeline ships with the next data layer. Until then this sub-view stays empty rather than guess.</p>
            </div>
          )}
        </div>
      )}

      {active === 'scorers' && (
        <div className="stats-panel show">
          <div className="stats-sec-head">
            <h2>Scorers</h2>
            <span className="meta">Goals {'·'} own goals excluded</span>
          </div>
          <ScorersTable rows={leaderboards.scorers} />
        </div>
      )}

      {active === 'assists' && (
        <div className="stats-panel show">
          <div className="stats-sec-head">
            <h2>Assists</h2>
            <span className="meta">Primary assists {'·'} 77% open-play coverage</span>
          </div>
          <AssistsTable rows={leaderboards.assists} />
        </div>
      )}

      {active === 'ga' && (
        <div className="stats-panel show">
          <div className="stats-sec-head">
            <h2>Goal Contributions</h2>
            <span className="meta">Goals + assists</span>
          </div>
          <GaTable rows={leaderboards.goalContributions} />
        </div>
      )}

      {active === 'sv' && (
        <div className="stats-panel show">
          <div className="stats-sec-head">
            <h2>SV Points <SvPointsTooltip /></h2>
            <span className="meta">Sportsvyn metric {'·'} v1</span>
          </div>
          <div className="stats-svnote">
            A <b>Sportsvyn-built</b> score, not an official fantasy number. v1 weights goals by position (defenders and keepers worth more), plus assists, minus cards. <b>Minutes and goalkeeper bonuses arrive with the next data layer</b>; for now it reads attack-forward. We show you the formula; we do not pretend it is complete.
          </div>
          <SvTable rows={leaderboards.svPoints} />
        </div>
      )}

      {active === 'discipline' && (
        <div className="stats-panel show">
          <div className="stats-sec-head">
            <h2>Discipline</h2>
            <span className="meta">Cards {'·'} second yellows arrive as red</span>
          </div>
          <DisciplineTable rows={leaderboards.discipline} />
        </div>
      )}

      {active === 'keepers' && (
        <div className="stats-panel show">
          <div className="stats-soonpanel">
            <div className="tag">Coming soon</div>
            <h3>Keepers</h3>
            <p>Per-keeper saves, clean sheets, and goals prevented need player-level match data. We have it at team level today; player attribution arrives with the next data layer.</p>
          </div>
        </div>
      )}

      {active === 'defense' && (
        <div className="stats-panel show">
          <div className="stats-soonpanel">
            <div className="tag">Coming soon</div>
            <h3>Defense</h3>
            <p>Tackles, interceptions, and blocks are not in the current feed at player level. This tab unlocks when the player-stats pipeline ships.</p>
          </div>
        </div>
      )}
    </>
  );
}
