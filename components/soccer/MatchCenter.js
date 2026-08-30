'use client';

// components/soccer/MatchCenter.js - the EPL match center (mock v0_1).
//
// ASSEMBLY, NOT INGESTION. Every number here comes from a reader the platform
// already runs: team statistics, match_events, match_lineups. The client
// boundary exists for one reason - the tab row - and every value it renders
// was computed on the server by lib/soccer/matchCenter.
//
// NO MODEL COPY REACHES THIS SURFACE, by construction: it reads no article,
// no gloss, no analyst row. The false-promise law is satisfied by there being
// nothing here to promise.

import { useState } from 'react';
import './matchcenter.css';

function StatBar({ rows }) {
  if (!rows.length) return null;
  return (
    <div className="mc-statbar">
      {rows.map((r) => (
        <div key={r.key}>
          <div className="mc-srow">
            <span className="mc-v">{r.home}</span>
            <span className="mc-lbl">{r.label}</span>
            <span className="mc-v">{r.away}</span>
          </div>
          <div className="mc-bar">
            <i className="home" style={{ width: `${r.homePct}%` }} />
            <i className="away" style={{ width: `${r.awayPct}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Timeline({ rows }) {
  if (!rows.length) {
    return <div className="mc-empty">No events recorded yet.</div>;
  }
  return (
    <div className="mc-tl">
      {rows.map((r) => (
        <div className={`mc-tlrow${r.kind === 'goal' ? ' goal' : ''}`} key={r.id}>
          <span className="mc-tlmin">{r.minute}</span>
          <span className="mc-tlicon" aria-hidden="true">{r.icon}</span>
          <span className="mc-tlbody">
            <span className="mc-tlname">{r.name}</span>
            {r.note && <span className="mc-tlsub">{r.note}</span>}
          </span>
          {r.side && <span className="mc-tlside">{r.side}</span>}
        </div>
      ))}
    </div>
  );
}

function Pitch({ side, team }) {
  if (!side?.rows?.length) return null;
  return (
    <div className="mc-lineup">
      <div className="mc-formrow">
        <span className="mc-formtag">{team}{side.formation ? <b> {side.formation}</b> : null}</span>
      </div>
      <div className="mc-pitch">
        <span className="mc-pcircle" />
        <span className="mc-pline" />
        {side.rows.map((row, i) => (
          <div className="mc-prow" key={i}>
            {row.map((p) => (
              <span className="mc-pp" key={`${p.number}-${p.name}`}>
                <span className="mc-pdot">{p.number ?? '·'}</span>
                <span className="mc-pnm">{p.name}</span>
              </span>
            ))}
          </div>
        ))}
      </div>
      {side.bench?.length > 0 && (
        <div className="mc-bench">
          <div className="mc-benchlbl">Bench</div>
          {side.bench.map((p) => (
            <span className="mc-benchp" key={`${p.number}-${p.name}`}>
              <b>{p.number ?? '·'}</b>{p.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MatchCenter({ header, compare, timeline, lineups, fullStats }) {
  const [tab, setTab] = useState('timeline');
  const TABS = [
    ['timeline', 'Timeline'],
    ['lineups', 'Lineups'],
    ['stats', 'Full stats'],
  ];

  return (
    <>
      <section className="mc-head">
        <div className="mc-gstat">
          {header.live ? (
            <>
              <span className="mc-livedot" /><span className="mc-livetxt">LIVE</span>
              {header.chip && <span className="mc-minchip">{header.chip}</span>}
            </>
          ) : header.final ? (
            <span className="mc-ftlbl">Full time</span>
          ) : (
            <span className="mc-ftlbl">{header.kickoffLabel}</span>
          )}
        </div>
        <div className="mc-vs">
          <div className="mc-side">
            <div className="mc-crest">{header.homeAbbr}</div>
            <div className="mc-cname">{header.homeName}</div>
            {/* A POSITION, NOT A RECORD - the soccer grammar. Absent when we
                hold no table for the season, never a dash. */}
            {header.homeRank ? <div className="mc-rank">{header.homeRank}</div> : null}
          </div>
          <div className="mc-scorebig">
            {header.homeScore ?? '–'}<span className="mc-dash">–</span>{header.awayScore ?? '–'}
          </div>
          <div className="mc-side">
            <div className="mc-crest">{header.awayAbbr}</div>
            <div className="mc-cname">{header.awayName}</div>
            {header.awayRank ? <div className="mc-rank">{header.awayRank}</div> : null}
          </div>
        </div>
        {header.venue && <div className="mc-venue">{header.venue}</div>}
      </section>

      <StatBar rows={compare} />

      <div className="mc-tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k}
            className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {tab === 'timeline' && <Timeline rows={timeline} />}
      {tab === 'lineups' && (
        lineups.home || lineups.away ? (
          <>
            <Pitch side={lineups.home} team={header.homeName} />
            <Pitch side={lineups.away} team={header.awayName} />
          </>
        ) : <div className="mc-empty">Lineups land about an hour before kickoff.</div>
      )}
      {tab === 'stats' && (
        fullStats.length ? (
          <div className="mc-full">
            {fullStats.map((r) => (
              <div className="mc-fullrow" key={r.key}>
                <span className="mc-fv">{r.home}</span>
                <span className="mc-flbl">{r.label}</span>
                <span className="mc-fv">{r.away}</span>
              </div>
            ))}
          </div>
        ) : <div className="mc-empty">Team stats arrive with kickoff.</div>
      )}
    </>
  );
}
