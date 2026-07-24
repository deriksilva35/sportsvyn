'use client';

// components/gridiron/Scoreboard.js — /scores instrument. Client component: owns
// the filter state (all/nfl/cfb + live-only) and per-card expand state. Receives
// already-read slate data from the server page (plain serializable objects).
// Detail panes (Key Moments / Play by Play) are placeholders this session — no
// events/PBP tables exist yet — but the full card + tab grammar ships now.

import { useState } from 'react';
import DriveStrip from './DriveStrip';
import OddsStrip from './OddsStrip';
import { isPreGame } from '@/lib/gridiron/oddsFormat';

const SPORTS = [
  { key: 'nfl', label: 'NFL' },
  { key: 'cfb', label: 'CFB' },
];

function fmtTime(iso) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit',
    }).format(new Date(iso)) + ' ET';
  } catch { return ''; }
}

function TeamLine({ t, score, isWinner, isLoser, final }) {
  return (
    <div className={`gi-team ${final && isWinner ? 'win' : ''} ${final && isLoser ? 'lose' : ''}`}>
      <span className="rk" />
      <span className="nm">{t.abbreviation || t.name || t.label || 'TBD'}</span>
      <span className="rec">{t.conference || ''}</span>
      <span className="sc">{score ?? '—'}</span>
    </div>
  );
}

function Status({ g }) {
  if (g.status === 'live') return <span className="gi-status live"><span className="gi-dot" />LIVE</span>;
  if (g.status === 'final') {
    const ot = Array.isArray(g.lineScores?.home) && g.lineScores.home[4] != null;
    return <span className={`gi-final ${ot ? 'ot' : ''}`}>{ot ? 'F/OT' : 'FINAL'}</span>;
  }
  return <span className="gi-up">{fmtTime(g.kickoffAt)}<span className="net"> · TBD</span></span>;
}

function Card({ g }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('moments');
  const final = g.status === 'final';
  const hw = g.homeScore, aw = g.awayScore;
  const homeWin = final && hw > aw, awayWin = final && aw > hw;

  return (
    <div className={`gi-card ${open ? 'expanded' : ''}`}>
      <div className="gi-card-body">
        <div className="gi-card-top">
          <Status g={g} />
          <button className="gi-chev" onClick={() => setOpen((v) => !v)} aria-label="expand">▾</button>
        </div>
        <TeamLine t={g.away} score={aw} isWinner={awayWin} isLoser={homeWin} final={final} />
        <TeamLine t={g.home} score={hw} isWinner={homeWin} isLoser={awayWin} final={final} />
        <div className="gi-card-foot">
          <span className="gi-line">{g.leagueSlug.toUpperCase()} · {g.seasonPhase} W{g.week}</span>
          <span className={`gi-watch ${final ? 'dim' : ''}`}>
            <span className="lbl">Watch</span>
            <span className="val">—</span>
          </span>
        </div>
      </div>

      {open && (
        <div className="gi-detail">
          <div className="gi-tabs">
            {final || g.status === 'live' ? (
              <>
                <button className={`gi-tab ${tab === 'moments' ? 'active' : ''}`} onClick={() => setTab('moments')}>Key Moments</button>
                <button className={`gi-tab ${tab === 'pbp' ? 'active' : ''}`} onClick={() => setTab('pbp')}>Play by Play</button>
              </>
            ) : (
              <button className="gi-tab active">Why Watch</button>
            )}
            <a className="full" href="#">Full match page →</a>
          </div>
          <div className="gi-pane">
            {final || g.status === 'live'
              ? <span className="gi-placeholder">{tab === 'moments' ? 'Key Moments' : 'Play by Play'} — coming with live data (events / PBP ingest not wired yet).</span>
              : (
                <>
                  {isPreGame(g.status) && g.odds
                    ? <OddsStrip odds={g.odds} />
                    : <div className="why-val">—</div>}
                  <div className="why-read">Watch Score and the one-line read arrive with the live-data poller.</div>
                </>
              )}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ sport, games, liveOnly }) {
  const shown = liveOnly ? games.filter((g) => g.status === 'live') : games;
  return (
    <div className="gi-sect">
      <div className="gi-sect-h">
        <span className="nm">{sport.label}</span>
        <span className="cnt">{shown.length} {shown.length === 1 ? 'game' : 'games'}</span>
        <span className="rule" />
      </div>
      {shown.length === 0 ? (
        <div className="gi-empty">No {sport.label} {liveOnly ? 'live now' : 'on this day'} · sections keep their place, never vanish →</div>
      ) : (
        <div className="gi-cards">{shown.map((g) => <Card key={g.id} g={g} />)}</div>
      )}
    </div>
  );
}

export default function Scoreboard({ byLeague }) {
  const [filter, setFilter] = useState('all');   // all | nfl | cfb
  const [liveOnly, setLiveOnly] = useState(false);
  const visible = SPORTS.filter((s) => filter === 'all' || filter === s.key);

  return (
    <div>
      <div className="gi-toolbar">
        <button className={`gi-chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All</button>
        <button className={`gi-chip ${filter === 'nfl' ? 'active' : ''}`} onClick={() => setFilter('nfl')}>NFL</button>
        <button className={`gi-chip ${filter === 'cfb' ? 'active' : ''}`} onClick={() => setFilter('cfb')}>CFB</button>
        <button className={`gi-chip live ${liveOnly ? 'active' : ''}`} onClick={() => setLiveOnly((v) => !v)}>Live only</button>
      </div>

      {visible.map((s) => <Section key={s.key} sport={s} games={byLeague[s.key] ?? []} liveOnly={liveOnly} />)}

      {/* DriveStrip is built + ready but renders nowhere until live rows exist.
          Hidden demo so the component is exercised by the build. */}
      <div hidden aria-hidden="true">
        <DriveStrip yardsToEndzone={34} distance={6} driveStartYTE={75} possessionAbbr="KC" down={2} opponentSide="OPP 34" />
      </div>
    </div>
  );
}
