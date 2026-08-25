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
import Link from 'next/link';
import DriveStrip from './DriveStrip';
import { scoresHref, SPORT_CHIPS } from '@/lib/gridiron/scoresNav';

// Where a gridiron card's "Full game" link points, per league. A map rather
// than a conditional: each code owns a sibling route, and a fourth would
// otherwise mean remembering to edit an if-chain.
const GAME_ROUTE = { nfl: '/nfl/game', cfb: '/cfb/game' };
import { soccerLiveChip } from '@/lib/soccer/liveChip';
import OddsStrip from './OddsStrip';
import RankBadge from './RankBadge';
import { isPreGame } from '@/lib/gridiron/oddsFormat';
import { lineScoreGrid, liveChip, ABSENT } from '@/lib/gridiron/lineScore';
import { distinctLabel } from '@/lib/gridiron/labels';

// The section list IS the chip list - one definition (scoresNav), so a
// league can never appear as a filter with no section or the reverse.
const SPORTS = SPORT_CHIPS;

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
      <RankBadge rank={t.apRank} />
      <span className="nm">{name}</span>
      <span className="sc">{score ?? ABSENT}</span>
    </div>
  );
}

function Status({ g }) {
  if (g.status === 'live') {
    // Where in the game, beside LIVE - the one formatter (lineScore.js owns
    // it, the numcols law). A snapshot of the last poll, rendered plainly:
    // no ticking, it moves when the poll does. PRE badge unchanged - it
    // answers 'what kind of game', this answers 'where in it'.
    const chip = liveChip(g.liveState);
    return (
      <span className="gi-status live">
        <span className="gi-dot" />LIVE
        {chip && <span className="gi-qc">{chip}</span>}
      </span>
    );
  }
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
  const label = distinctLabel(g.weekLabel);
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
            {[distinctLabel(g.weekLabel), g.venueCity].filter(Boolean).join(' · ')}
          </span>
        </div>
      </div>

      {open && (
        <div className="gi-detail">
          {hasLine ? <LineScore g={g} /> : <PreGamePane g={g} />}
          {/* The expand stays LINE-SCORE-ONLY. It is a glance, and it now has
              somewhere to go: one link, at the bottom, to the page that holds
              the rest. BOTH CODES NOW - /cfb/game/[slug] exists, so the old
              "NFL only, a link to a 404 is worse than no link" gate is gone
              along with the 404 it was protecting against. Each league gets its
              own route, which is why this reads the league rather than
              assuming one. */}
          {GAME_ROUTE[g.leagueSlug] ? (
            <Link className="gi-full" href={`${GAME_ROUTE[g.leagueSlug]}/${g.slug}`}>Full game →</Link>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// THE SOCCER CARD. A different game, and the differences are the point:
//
// A DRAW IS A RESULT, NOT A FAILURE TO WIN. The gridiron card dims the loser
// and brightens the winner; 2-2 has neither, so nobody dims - both sides read
// equal, which is what the scoreline means.
//
// NO LINE SCORE, so no expand: soccer has halves, not quarters, and a
// two-column half table is a worse version of the scoreline already shown.
// The card is a link straight to the match page instead.
//
// The minute rides beside LIVE from lib/soccer/liveChip - a poll snapshot,
// rendered plainly.
// ---------------------------------------------------------------------------
function SoccerCard({ g }) {
  const final = g.status === 'final';
  const live = g.status === 'live';
  const chip = live ? soccerLiveChip(g.liveState) : null;
  const draw = (final || live) && g.homeScore != null && g.homeScore === g.awayScore;
  const side = (t, score, otherScore) => {
    // Dim ONLY a decided loser. A draw dims neither; a live match dims
    // nobody, because it is not over.
    const lost = final && !draw && score != null && otherScore != null && score < otherScore;
    return (
      <div className={`gi-team${lost ? ' loser' : ''}`}>
        {/* The club code, left of the name - gridiron's BUF/TEN pattern in
            soccer's own markup. Sourced from teams.abbreviation, which
            squadImport fills from the provider's `code` (all 20 EPL clubs
            carry one); no new derivation. */}
        <span className="abbr">{t?.abbreviation ?? ''}</span>
        <span className="nm">{t?.name ?? 'TBD'}</span>
        <span className="sc">{score ?? ABSENT}</span>
      </div>
    );
  };
  // League · matchweek left, venue right - the two-piece row gridiron
  // renders as 'NFL · PRE W2' / city. Every field already rides the DTO.
  const compLabel = [g.leagueName, g.week != null ? `Matchweek ${g.week}` : null]
    .filter(Boolean).join(' · ');
  return (
    <div className="gi-card gi-card--soccer">
      <div className="gi-card-h">
        {live ? (
          <span className="gi-status live">
            <span className="gi-dot" />LIVE
            {chip && <span className="gi-qc">{chip}</span>}
          </span>
        ) : final ? (
          <span className="gi-final">FT</span>
        ) : (
          <span className="gi-up">{fmtTime(g.kickoffAt)}</span>
        )}
      </div>
      {/* Straight to the league's own match center - /match would only 308
          here anyway, and a card should not spend a redirect. */}
      <Link className="gi-soccer-teams" href={`/epl/match/${g.slug}`}>
        {side(g.away, g.awayScore, g.homeScore)}
        {side(g.home, g.homeScore, g.awayScore)}
      </Link>
      {(compLabel || g.venue) && (
        <div className="gi-soccer-meta">
          <span className="comp">{compLabel}</span>
          {g.venue && <span className="venue">{g.venue}</span>}
        </div>
      )}
    </div>
  );
}

function Section({ sport, games, liveOnly }) {
  const shown = liveOnly ? games.filter((g) => g.status === 'live') : games;
  // PER-SPORT CARD, SHARED SHELL. The codes' cards disagree about what a game
  // IS - quarters and a line score vs halves and a running minute, a loser to
  // dim vs a draw that dims nobody - so the CARD forks and everything around
  // it (toolbar, sections, the never-vanish empty state, date rail) stays one
  // implementation. The gridiron Card below is untouched by this relay.
  const CardFor = sport.key === 'epl' ? SoccerCard : Card;
  return (
    <div className="gi-sect">
      <div className="gi-sect-h">
        <span className="nm">{sport.label}</span>
        <span className="cnt">{shown.length} {shown.length === 1 ? (sport.key === 'epl' ? 'match' : 'game') : (sport.key === 'epl' ? 'matches' : 'games')}</span>
        <span className="rule" />
      </div>
      {shown.length === 0 ? (
        <div className="gi-empty">No {sport.label} {liveOnly ? 'live now' : 'on this day'} · sections keep their place, never vanish →</div>
      ) : (
        <div className="gi-cards">{shown.map((g) => <CardFor key={g.id} g={g} />)}</div>
      )}
    </div>
  );
}

// FILTERS ARE URL STATE (fix B), threaded from the page. They were useState
// here, which reset to ALL on every navigation - a date change wiped the CFB
// filter because the two features each held half the state. The chips are
// Links built by scoresHref, so every chip carries the date and every date
// arrow carries the chip; the reverse direction is the same one rule.
export default function Scoreboard({ byLeague, date, sport = 'all', live = false }) {
  const visible = SPORTS.filter((s) => sport === 'all' || sport === s.key);
  const chip = (want) => scoresHref(date, { sport: want, live });

  return (
    <div>
      <div className="gi-toolbar">
        <Link className={`gi-chip ${sport === 'all' ? 'active' : ''}`} href={chip('all')}>All</Link>
        {SPORT_CHIPS.map((s) => (
          <Link key={s.key} className={`gi-chip ${sport === s.key ? 'active' : ''}`} href={chip(s.key)}>{s.label}</Link>
        ))}
        <Link className={`gi-chip live ${live ? 'active' : ''}`}
          href={scoresHref(date, { sport, live: !live })}>Live only</Link>
      </div>

      {visible.map((s) => <Section key={s.key} sport={s} games={byLeague[s.key] ?? []} liveOnly={live} />)}

      {/* DriveStrip is built + ready but renders nowhere until live rows exist.
          Hidden demo so the component is exercised by the build. */}
      <div hidden aria-hidden="true">
        <DriveStrip yardsToEndzone={34} distance={6} driveStartYTE={75} possessionAbbr="KC" down={2} opponentSide="OPP 34" />
      </div>
    </div>
  );
}
