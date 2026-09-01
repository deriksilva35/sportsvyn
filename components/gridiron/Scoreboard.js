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
import { kickoffParts, groupByDay } from '@/lib/gridiron/kickoff';
import { tzOrUtc } from '@/lib/gridiron/viewerTz';
import { useViewerTz } from './useViewerTz';
import TzCookie from './TzCookie';
import AlertBell from '@/components/alerts/AlertBell';

// The section list IS the chip list - one definition (scoresNav), so a
// league can never appear as a filter with no section or the reverse.
const SPORTS = SPORT_CHIPS;

// WHAT A PRE-GAME CARD SAYS ABOUT WHEN. Day of week, date, time - "Thu Sep 10
// · 5:20 PM" - in the READER'S zone, formatted by lib/gridiron/kickoff.
//
// IT USED TO SAY "5:20 PM ET", AND BOTH HALVES WERE WRONG FOR MOST READERS.
// The zone was hardcoded to America/New_York, so a reader in Denver got a time
// they had to convert on every card; and the day was missing entirely, so on a
// week-unit list running Thursday to Monday the card gave a time with no day
// attached - a number nobody can act on. There is no 'ET' literal anywhere in
// this file now, and a test forbids one coming back.
//
// THE DAY IS DROPPED INSIDE A GROUPED DAY. When the list carries a "Thursday ·
// Sep 10" header, every card under it repeating "Thu Sep 10" is the same fact
// three times on one screen, so the group passes withDay={false}.
function Kickoff({ iso, tz, withDay = true }) {
  const parts = kickoffParts(iso, tzOrUtc(tz));
  if (!parts) return null;
  return (
    <time dateTime={typeof iso === 'string' ? iso : undefined}>
      {withDay ? <span className="gi-kday">{parts.day}</span> : null}
      {withDay ? ' · ' : null}
      {parts.time}
    </time>
  );
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
function TeamLine({ t, score, isWinner, isLoser, final, live = false, record = null }) {
  const abbr = t.abbreviation || null;
  // A FAILED JOIN RENDERS AN ABSENCE, NOT A CLAIM. This said 'TBD', which is a
  // statement that the opponent is undetermined - and it fired not on an
  // undetermined opponent but on a team row we did not manage to join. The
  // abbreviation is still an identity and is the honest fallback; with neither,
  // the slot is empty, because a card that cannot name a side should say so by
  // saying nothing.
  //
  // RULED: a genuinely undetermined playoff opponent is a future problem with a
  // provider flag behind it, and when it arrives it earns its own honest label
  // rather than inheriting this one.
  const name = t.name || t.label || t.abbreviation || '';
  // TWO HOOKS THE ROW COULD NOT DERIVE FOR ITSELF. A score is live-red while
  // the game is running and muted while it is still a placeholder dash, and
  // neither fact is visible from `score` alone - null is not "unplayed" (a
  // scoreless live game is 0, not null) and a number is not "live". CSS cannot
  // select on content, so both arrive as classes or not at all.
  const scoreClass = `sc${live ? ' live' : ''}${score == null ? ' none' : ''}`;
  return (
    <div className={`gi-team ${final && isWinner ? 'win' : ''} ${final && isLoser ? 'lose' : ''}`}>
      {abbr ? <span className="abbr">{abbr}</span> : <span className="abbr" />}
      <RankBadge rank={t.apRank} />
      <span className="nm">{name}</span>
      {/* A CHIP MAY ONLY CLAIM KNOWLEDGE. No record, no chip - never a dash
          standing in for one. Records are not market data and carry no
          kickoff, so unlike the odds strip this renders in EVERY game state. */}
      {record ? <span className="gi-rec">{record}</span> : null}
      <span className={scoreClass}>{score ?? ABSENT}</span>
    </div>
  );
}

function Status({ g, tz, withDay = true }) {
  if (g.status === 'live') {
    // Where in the game, beside LIVE - the one formatter (lineScore.js owns
    // it, the numcols law). A snapshot of the last poll, rendered plainly:
    // no ticking, it moves when the poll does. PRE badge unchanged - it
    // answers 'what kind of game', this answers 'where in it'.
    const chip = liveChip(g.liveState);
    return (
      <span className="gi-status live">
        <span className="gi-dot" />
        {/* THE CLOCK LEADS AND 'LIVE' BECOMES A PILL - the v1.2 inversion. The
            quarter and clock are the news on a running game; LIVE is the
            category. The chip keeps its data and its formatter (lineScore.js
            still owns it) and wears the new skin. Bare text cannot be a pill,
            hence the span. */}
        {chip && <span className="gi-qc">{chip}</span>}
        <span className="gi-livepill">LIVE</span>
      </span>
    );
  }
  if (g.status === 'final') {
    const ot = Array.isArray(g.lineScores?.home) && g.lineScores.home[4] != null;
    return <span className={`gi-final ${ot ? 'ot' : ''}`}>{ot ? 'F/OT' : 'FINAL'}</span>;
  }
  // THE NETWORK, OR NOTHING - never "TBD".
  //
  // DIAGNOSED BEFORE IT WAS FIXED, because the string could have come from the
  // provider. It did not: it was a hardcoded literal right here, ` · TBD`,
  // printed on every pre-game card regardless of what we knew. The data was
  // never the problem - 248 of 272 upcoming NFL games carry a primary US
  // broadcaster, and NE at SEA has carried NBC the whole time. This line simply
  // never read g.network, while the card foot twelve lines below always did.
  //
  // DASH LAW. An unknown outlet omits the segment and the foot reads the time
  // alone. "TBD" is a claim that a decision is pending, which we are in no
  // position to make: we do not know whether the game is unlisted, or listed
  // somewhere we do not ingest, or genuinely undecided.
  return (
    <span className="gi-up">
      <Kickoff iso={g.kickoffAt} tz={tz} withDay={withDay} />
      {g.network ? <span className="net"> · {g.network}</span> : null}
    </span>
  );
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
function PreGamePane({ g, tz }) {
  const label = distinctLabel(g.weekLabel);
  const place = g.venueCity || g.venue;
  return (
    <>
      <dl className="gi-facts">
        <div><dt>Kickoff</dt><dd><Kickoff iso={g.kickoffAt} tz={tz} /></dd></div>
        {place ? <div><dt>Venue</dt><dd>{g.venue && g.venueCity ? `${g.venue}, ${g.venueCity}` : place}</dd></div> : null}
        {label ? <div><dt>Round</dt><dd>{label}</dd></div> : null}
      </dl>
      {isPreGame(g.status) && g.odds ? <OddsStrip odds={g.odds} /> : null}
    </>
  );
}

// WHAT THE BELL NEEDS, and nothing more. The sheet renders a matchup, a
// kickoff and two links; handing it the whole game object would let it grow a
// dependency on a field the card happens to carry today.
function alertMatch(g) {
  return {
    id: g.id, slug: g.slug, leagueSlug: g.leagueSlug,
    homeAbbr: g.home?.abbreviation ?? '', awayAbbr: g.away?.abbreviation ?? '',
    homeTeamId: g.home?.id ?? null, homeSlug: g.home?.slug ?? null,
    kickoffAt: g.kickoffAt,
  };
}

function Card({ g, records, tz, withDay = true, signedIn = false }) {
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
            <Status g={g} tz={tz} withDay={withDay} />
            <PhaseBadge phase={g.seasonPhase} />
          </span>
          <span className="gi-chev" aria-hidden="true">▾</span>
        </div>
        <TeamLine t={g.away} score={aw} isWinner={awayWin} isLoser={homeWin} final={final} live={g.status === 'live'} record={records?.get?.(g.away?.id) ?? null} />
        <TeamLine t={g.home} score={hw} isWinner={homeWin} isLoser={awayWin} final={final} live={g.status === 'live'} record={records?.get?.(g.home?.id) ?? null} />
        {/* The Watch unit is gone. Watch Score is a soccer instrument - there is
            no gridiron composite and never was one on this card, so it rendered
            a permanent placeholder on every row forever, which does not read as
            "not applicable", it reads as broken. */}
        <div className="gi-card-foot">
          <span className="gi-line">{g.leagueSlug.toUpperCase()} · {g.seasonPhase} W{g.week}</span>
          {/* THE NETWORK TAKES THE SECOND SLOT, replacing the city rather than
              sitting beside it. Both answer "where", and the network is the one
              a reader is scanning for on a card they are deciding whether to
              open; the stadium's city is the one they can infer from the home
              club. ABSENT STAYS ABSENT: no listing and the slot renders exactly
              what it always did, so a card we have no outlet for is unchanged
              rather than emptied. */}
          <span className="gi-line-alt">
            {g.network
              ? <span className="gi-net">{g.network}</span>
              : [distinctLabel(g.weekLabel), g.venueCity].filter(Boolean).join(' · ')}
          </span>
          {/* THE BELL SITS IN THE FOOT, RIGHT-ALIGNED (margin-left:auto on the
              pill). Its click stops propagating: the whole card is the expand
              control, and a reader reaching for Alerts must not also open the
              line score underneath it. */}
          <AlertBell match={alertMatch(g)} signedIn={signedIn} />
        </div>
      </div>

      {open && (
        <div className="gi-detail">
          {hasLine ? <LineScore g={g} /> : <PreGamePane g={g} tz={tz} />}
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
//
// NO WINNER-VOLT HERE, BY RULING (v1.2 restyle). The gridiron card lights the
// winning score volt on a final; this card does not, and that is deliberate
// rather than unfinished. A draw is a result, not a failure to win - 2-2 has no
// winner to light, and a scheme that can only say "someone won" would have to
// say nothing at all about the most ordinary soccer scoreline. Dimming a
// decided loser says the same thing in the one direction that survives a draw.
// The SHELL restyle (radius, border, foot rule, state pills) applies to both
// codes; scoreline semantics stay forked, which is what the Card-level fork is
// for.
// ---------------------------------------------------------------------------
// NO BELL ON THE SOCCER CARD THIS RELAY. The alert vocabulary is gridiron -
// quarters, a close-game rule written in Q4 and eight points - and a bell that
// opened a sheet offering "End of each quarter" on a football match would be
// worse than no bell. It gets its own rules or it gets none.
function SoccerCard({ g, records, tz, withDay = true }) {
  const final = g.status === 'final';
  const live = g.status === 'live';
  const chip = live ? soccerLiveChip(g.liveState) : null;
  const draw = (final || live) && g.homeScore != null && g.homeScore === g.awayScore;
  const side = (t, score, otherScore) => {
    // THE SOCCER CHIP IS A POSITION, NOT A RECORD. "3rd" is what a supporter
    // says; nobody describes a club as 5-2-1. recordChipMap() already speaks
    // that grammar, so the card just renders the string it is handed.
    const chipText = records?.get?.(t?.id) ?? null;
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
        {/* Same ruling as the gridiron row: the abbreviation, then nothing.
            Never 'TBD', which claims a decision we have not been told about. */}
        <span className="nm">{t?.name ?? t?.abbreviation ?? ''}</span>
        {chipText ? <span className="gi-rec">{chipText}</span> : null}
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
            <span className="gi-dot" />
            {/* The minute leads and LIVE is a pill, same as gridiron: state
                pills are SHELL, and the shell is shared. What stays forked is
                what the chip SAYS - soccerLiveChip renders a running minute,
                not a quarter and a clock. */}
            {chip && <span className="gi-qc">{chip}</span>}
            <span className="gi-livepill">LIVE</span>
          </span>
        ) : final ? (
          <span className="gi-final">FT</span>
        ) : (
          <span className="gi-up"><Kickoff iso={g.kickoffAt} tz={tz} withDay={withDay} /></span>
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

function Section({ sport, games, liveOnly, records, tz, signedIn }) {
  const shown = liveOnly ? games.filter((g) => g.status === 'live') : games;
  // PER-SPORT CARD, SHARED SHELL. The codes' cards disagree about what a game
  // IS - quarters and a line score vs halves and a running minute, a loser to
  // dim vs a draw that dims nobody - so the CARD forks and everything around
  // it (toolbar, sections, the never-vanish empty state, date rail) stays one
  // implementation. The gridiron Card below is untouched by this relay.
  const CardFor = sport.key === 'epl' ? SoccerCard : Card;
  // THE GROUPING IS DECIDED IN THE PURE MODULE (lib/gridiron/kickoff), which is
  // why "which day is this game on" can be tested without rendering anything -
  // and it matters here, because the answer is NOT the ISO string's date. A
  // Thursday 8:20pm Eastern kickoff is 00:20 UTC on Friday.
  const days = groupByDay(shown, tzOrUtc(tz));
  return (
    <div className="gi-sect">
      <div className="gi-sect-h">
        <span className="nm">{sport.label}</span>
        <span className="cnt">{shown.length} {shown.length === 1 ? (sport.key === 'epl' ? 'match' : 'game') : (sport.key === 'epl' ? 'matches' : 'games')}</span>
        <span className="rule" />
      </div>
      {shown.length === 0 ? (
        <div className="gi-empty gi-empty--slate">No {sport.label} {liveOnly ? 'live now' : 'on this day'} · sections keep their place, never vanish →</div>
      ) : days.length > 1 ? (
        // MORE THAN ONE DAY ON SCREEN, SO THE DAYS GET HEADERS. A week-unit
        // list ran Thursday to Monday as one undifferentiated column of cards;
        // the header is what turns it back into a schedule.
        //
        // GROUPED ONLY WHEN THERE IS SOMETHING TO GROUP. On /scores, which is
        // one day by construction, a lone "Sunday · Sep 13" header over the
        // whole list is a label for the thing the date rail directly above it
        // already says. So a single-day list renders exactly as it did, and the
        // cards keep their own day - the branch is on what is on screen, not on
        // which surface is rendering.
        days.map((d) => (
          <div className="gi-day" key={d.key ?? 'undated'}>
            {d.heading ? <h3 className="gi-day-h">{d.heading}</h3> : null}
            <div className="gi-cards">
              {d.games.map((g) => <CardFor key={g.id} g={g} records={records} tz={tz} withDay={false} signedIn={signedIn} />)}
            </div>
          </div>
        ))
      ) : (
        <div className="gi-cards">{shown.map((g) => <CardFor key={g.id} g={g} records={records} tz={tz} signedIn={signedIn} />)}</div>
      )}
    </div>
  );
}

// FILTERS ARE URL STATE (fix B), threaded from the page. They were useState
// here, which reset to ALL on every navigation - a date change wiped the CFB
// filter because the two features each held half the state. The chips are
// Links built by scoresHref, so every chip carries the date and every date
// arrow carries the chip; the reverse direction is the same one rule.
export default function Scoreboard({ byLeague, date, sport = 'all', live = false, records = new Map(), pinned = false, initialTz = null, signedIn = false }) {
  const visible = SPORTS.filter((s) => sport === 'all' || sport === s.key);
  // ONE READ OF THE READER'S ZONE FOR THE WHOLE BOARD, threaded down. Asking
  // per card would give every card its own subscription to answer a question
  // that is the same for all of them.
  //
  // initialTz is the SERVER's read of the sv_tz cookie. With it, the server
  // renders the reader's own zone and hydration changes nothing; without it (a
  // cold visit) the board renders UTC unlabelled and corrects on this tick.
  const tz = useViewerTz(initialTz);
  const chip = (want) => scoresHref(date, { sport: want, live });

  return (
    <div>
      {/* Writes sv_tz once so the NEXT server render is already right. */}
      <TzCookie />
      {/* THE LEAGUE CHIPS DISAPPEAR WHEN THE LEAGUE IS PINNED. Inside /nfl the
          reader is standing in a place, and a row offering ALL · CFB · EPL is a
          way out of it dressed as a filter. LIVE ONLY stays either way: it is
          STATE, not a league, and it is as useful pinned as unpinned. */}
      <div className="gi-toolbar">
        {pinned ? null : (
          <>
            <Link className={`gi-chip ${sport === 'all' ? 'active' : ''}`} href={chip('all')}>All</Link>
            {SPORT_CHIPS.map((s) => (
              <Link key={s.key} className={`gi-chip ${sport === s.key ? 'active' : ''}`} href={chip(s.key)}>{s.label}</Link>
            ))}
          </>
        )}
        <Link className={`gi-chip live ${live ? 'active' : ''}`}
          href={scoresHref(date, { sport, live: !live })}><span className="gi-dot" />Live only</Link>
      </div>

      {visible.map((s) => <Section key={s.key} sport={s} games={byLeague[s.key] ?? []} liveOnly={live} records={records} tz={tz} signedIn={signedIn} />)}

      {/* DriveStrip is built + ready but renders nowhere until live rows exist.
          Hidden demo so the component is exercised by the build. */}
      <div hidden aria-hidden="true">
        <DriveStrip yardsToEndzone={34} distance={6} driveStartYTE={75} possessionAbbr="KC" down={2} opponentSide="OPP 34" />
      </div>
    </div>
  );
}
