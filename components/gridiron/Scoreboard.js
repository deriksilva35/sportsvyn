'use client';

// components/gridiron/Scoreboard.js - the /scores instrument. Client component:
// owns the filter state (all/nfl/cfb + live-only) and per-card expand state.
// Receives already-read slate data from the server page (plain serializable
// objects).
//
// THE CARD WAS REBUILT. What it used to be: abbreviations standing in for team
// names, a conference printed twice on an all-NFC game, an always-empty rank
// column, a Watch Score unit showing a permanent em-dash because there is no
// gridiron composite, and a caret opening two placeholder tabs beside a dead
// "Full match page" link pointing at "#".
//
// What it is now: full names with the abbreviation as a mono prefix, the winner
// in white and the loser muted, and the whole card tappable to reveal the one
// thing we actually store - the quarter-by-quarter line score. There is no
// gridiron match page, so the expand IS the destination rather than a stop on
// the way to one.

import { useState } from 'react';
import DriveStrip from './DriveStrip';
import OddsStrip from './OddsStrip';
import { isPreGame } from '@/lib/gridiron/oddsFormat';
import { lineScoreGrid, ABSENT } from '@/lib/gridiron/lineScore';

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

// THE ROW WAS THREE PROBLEMS. It showed the abbreviation as the team's name,
// so a scoreboard of "CAR / ARI" asked the reader to decode every line. It put
// t.conference in a slot classed `rec` - a record column showing a conference,
// which in an NFC-vs-NFC game rendered "NFC" twice and said nothing either
// time. And it opened with an always-empty 24px rank span, spending width on a
// column that has never had a value.
//
// Now: the abbreviation is a muted mono PREFIX (it is an identifier, so it gets
// the identifier typeface) and the full name is the name. The winner's name and
// score go full white; the loser drops to muted, so a glance at a finished card
// answers "who won" before it answers "what was the score".
function TeamLine({ t, score, isWinner, isLoser, final }) {
  const abbr = t.abbreviation || null;
  const name = t.name || t.label || 'TBD';
  return (
    <div className={`gi-team ${final && isWinner ? 'win' : ''} ${final && isLoser ? 'lose' : ''}`}>
      {abbr ? <span className="abbr">{abbr}</span> : <span className="abbr" />}
      <span className="nm">{name}</span>
      <span className="sc">{score ?? ABSENT}</span>
    </div>
  );
}

// The provider's prose week is only worth showing when it says something the
// mechanical "PRE W1" does not. "Week 1" alongside "PRE W1" is the same fact
// twice; "Hall of Fame Weekend" and "Wild Card" are names a reader recognises
// and a week number cannot carry.
function distinctLabel(g) {
  const l = g.weekLabel;
  if (!l) return null;
  return /^week\s+\d+$/i.test(l.trim()) ? null : l;
}

function Status({ g }) {
  if (g.status === 'live') return <span className="gi-status live"><span className="gi-dot" />LIVE</span>;
  if (g.status === 'final') {
    const ot = Array.isArray(g.lineScores?.home) && g.lineScores.home[4] != null;
    return <span className={`gi-final ${ot ? 'ot' : ''}`}>{ot ? 'F/OT' : 'FINAL'}</span>;
  }
  return <span className="gi-up">{fmtTime(g.kickoffAt)}<span className="net"> · TBD</span></span>;
}

// PRESEASON MARKER. A 24-17 preseason final looks exactly like a 24-17 real one,
// and the row's own FINAL chip is jade - the same affirmation a Week 1 result
// gets. So the phase is stated on the row itself, next to the status, rather
// than only in the small print at the foot of the card.
//
// Deliberately MUTED and mono: it is a qualifier on the result, not a second
// piece of news, so it must not compete with the score for attention. Rendered
// for PRE only - REG and POST rows are untouched, because "REG" on every row in
// September is noise that teaches the reader to stop seeing the badge.
function PhaseBadge({ phase }) {
  if (phase !== 'PRE') return null;
  return <span className="gi-phase-pre" title="Preseason">PRE</span>;
}

// The quarter grid. The DERIVATION lives in lib/gridiron/lineScore.js and is
// pure, because the expand is client state and a server render cannot reach it -
// without that split the only way to check a line score would be to open a
// browser and look, which is a hope rather than a gate.
function LineScore({ g }) {
  const grid = lineScoreGrid(g);
  if (!grid) return null;
  return (
    <table className="gi-ls">
      <thead>
        <tr>
          <th className="tm" scope="col"><span className="sr">Team</span></th>
          {grid.columns.map((c) => <th key={c} scope="col">{c}</th>)}
          <th className="tot" scope="col">T</th>
        </tr>
      </thead>
      <tbody>
        {grid.rows.map((r) => (
          <tr key={r.abbr}>
            <th className="tm" scope="row">{r.abbr}</th>
            {r.cells.map((v, j) => <td key={grid.columns[j]}>{v}</td>)}
            <td className="tot">{r.total}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// What a game that has not kicked off can honestly say about itself: when,
// where, and what it is called. Plus the odds strip where a market exists -
// which for preseason it never does, by ruling.
function PreGamePane({ g }) {
  const label = distinctLabel(g);
  const place = g.venueCity || g.venue;
  return (
    <>
      <dl className="gi-facts">
        <div><dt>Kickoff</dt><dd>{fmtTime(g.kickoffAt)}</dd></div>
        {place ? <div><dt>Venue</dt><dd>{g.venue && g.venueCity ? `${g.venue}, ${g.venueCity}` : place}</dd></div> : null}
        {label ? <div><dt>Round</dt><dd>{label}</dd></div> : null}
      </dl>
      {isPreGame(g.status) && g.odds ? <OddsStrip odds={g.odds} /> : null}
    </>
  );
}

function Card({ g }) {
  const [open, setOpen] = useState(false);
  const final = g.status === 'final';
  const hw = g.homeScore, aw = g.awayScore;
  const homeWin = final && hw > aw, awayWin = final && aw > hw;
  const hasLine = Array.isArray(g.lineScores?.home);

  // THE WHOLE CARD IS THE CONTROL. It used to be the caret alone - a 12px
  // glyph - while the card it belonged to sat inert next to a dead "Full match
  // page" link pointing at "#". There is no gridiron match page to send anyone
  // to, so the expand IS the destination, and it should be as easy to reach as
  // the thing it opens is worth.
  const toggle = () => setOpen((v) => !v);
  const onKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
  };

  return (
    <div className={`gi-card ${open ? 'expanded' : ''}`}>
      <div
        className="gi-card-body"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={onKey}
      >
        <div className="gi-card-top">
          <span className="gi-status-group">
            <Status g={g} />
            <PhaseBadge phase={g.seasonPhase} />
          </span>
          <span className="gi-chev" aria-hidden="true">▾</span>
        </div>
        <TeamLine t={g.away} score={aw} isWinner={awayWin} isLoser={homeWin} final={final} />
        <TeamLine t={g.home} score={hw} isWinner={homeWin} isLoser={awayWin} final={final} />
        {/* The Watch unit is gone. Watch Score is a soccer instrument - there is
            no gridiron composite and never was one on this card, so it rendered
            a permanent placeholder on every row forever, which does not read as
            "not applicable", it reads as broken. */}
        <div className="gi-card-foot">
          <span className="gi-line">{g.leagueSlug.toUpperCase()} · {g.seasonPhase} W{g.week}</span>
          <span className="gi-line-alt">
            {[distinctLabel(g), g.venueCity].filter(Boolean).join(' · ')}
          </span>
        </div>
      </div>

      {open && (
        <div className="gi-detail">
          {hasLine ? <LineScore g={g} /> : <PreGamePane g={g} />}
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
