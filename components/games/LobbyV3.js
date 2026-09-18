// components/games/LobbyV3.js - the Games tab, v3 (docs/design/mocks/games-v3.html).
//
// ============================================================================
// ONE THING TO DO NOW, FOUR GAMES, FOUR CHIPS
// ============================================================================
// v2 answered "what is there" and not "what should I do": a reader arriving at
// nine in the morning met a graded Daily, an unplayed board, a room on the
// clock and a live lineup, all equally loud, under a headline that counted
// them. v3 leads with ONE card and lets the rest be a list.
//
// THE CHIPS ARE URL STATE (?pane=), not an island, for the three reasons v2's
// panes were: server-rendered complete so there is no hydration flash, each
// pane's payload testable on its own, and a shareable link to any of them.
// normalizeChip() in lib/games/lobby.js maps every v2 pane onto a chip, so
// every bookmark that exists today still lands somewhere sensible.
//
// EVERY NUMBER COMES FROM THE VIEW. This file computes nothing: the shapes are
// lib/games/nowCard.js and lib/games/v3Rows.js, both pure, both tested against
// fixtures. R1 - every number on screen is one the site already computes - is
// therefore true by construction here, not by review.
//
// THE BOTTOM NAV IS UNTOUCHED. This is the Play tab's content and nothing else.

import Link from 'next/link';
import HouseTag from '@/components/house/HouseTag';
import StandaloneTime from '@/components/StandaloneTime';
import { V3_CHIPS, V3_CHIP_LABEL } from '@/lib/games/lobby';

// ---------------------------------------------------------------------------
// the now card
// ---------------------------------------------------------------------------
function NowCard({ card, signedIn, signinHref }) {
  if (!card) return null;
  const href = signedIn ? card.href : signinHref(card.href);
  return (
    <Link className={`gv-now${card.done ? ' done' : ''}`} href={href} data-kind={card.kind}>
      <span className="gv-now-t">
        <span className="gv-now-l">{card.label}</span>
        <b>{card.title}</b>
        {card.line && <small>{card.line}</small>}
      </span>
      <span className="gv-now-go">{signedIn ? card.cta : 'Sign in'}</span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// one game row - the mock's shape: mark, name, one line, number + label, chevron
// ---------------------------------------------------------------------------
function GameRow({ row, signedIn, signinHref }) {
  if (!row) return null;
  const href = signedIn ? row.href : signinHref(row.href);
  return (
    <Link className="gv-g" href={href} data-row={row.key}>
      <span className={`gv-ic${row.tone === 'live' ? ' live' : row.tone === 'done' ? ' done' : ''}`}>{row.mark}</span>
      <span className="gv-t">
        <b>{row.name}</b>
        {row.line && <small>{row.line}</small>}
      </span>
      <span className="gv-r">
        {row.right != null && <b className={row.tone === 'live' || row.tone === 'done' ? 'v' : undefined}>{row.right}</b>}
        {row.rightLabel && <span>{row.rightLabel}</span>}
      </span>
      <span className="gv-chev" aria-hidden="true">&rsaquo;</span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// THIS WEEK
// ---------------------------------------------------------------------------
function WeekPane({ v, signedIn, signinHref }) {
  const { now, rows, practice, week } = v;
  return (
    <>
      <NowCard card={now} signedIn={signedIn} signinHref={signinHref} />

      <div className="gv-sh">
        <h3>This week</h3>
        {week != null && <span>NFL WEEK {week}</span>}
      </div>
      <div className="gv-list">
        {rows.map((r) => <GameRow key={r.key} row={r} signedIn={signedIn} signinHref={signinHref} />)}
      </div>

      {/* PRACTICE IS TWO TILES AND STAYS TWO (addendum 6). The tracker's door
          moves to the Mock setup, where a league row carries "Track a live
          draft" - not here. */}
      <div className="gv-sh"><h3>Practice</h3><span>UNLIMITED · FREE</span></div>
      <div className="gv-two">
        {practice.map((t) => (
          <Link className="gv-tile" key={t.key} href={signedIn ? t.href : signinHref(t.href)}>
            <span className="gv-tl">{t.label}</span>
            <b>{t.title}</b>
            {t.sub && <small>{t.sub}</small>}
          </Link>
        ))}
      </div>

      <p className="gv-foot">{v.foot}</p>
      {/* THE LEGAL LINE STAYS, as the last line of This week (addendum 5). */}
      <p className="gv-legal">
        One account · one handle · one leaderboard spine. Not affiliated with the
        NFL. nflverse data CC-BY-4.0.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// BOARDS - week boards here, season standings on Rankings
// ---------------------------------------------------------------------------
function BoardsPane({ v, userId }) {
  const { boards = [], boardKey = null } = v;
  const board = boards.find((b) => b.key === boardKey) ?? boards[0] ?? null;
  return (
    <>
      <div className="gv-lb">
        <div className="gv-lbh">
          {boards.map((b) => (
            <Link key={b.key} href={`/games?pane=boards&b=${b.key}`}
              className={b.key === board?.key ? 'on' : undefined}>{b.label}</Link>
          ))}
        </div>
        {!board || !board.rows?.length ? (
          // THE BY-DAY RULE, STATED RATHER THAN DRAWN EMPTY (addendum 3). A
          // Thursday Weekly board has entries and no scores; Pick'em has no
          // live board at all until its contest settles.
          <div className="gv-tr"><span className="gv-hn q">{board?.empty ?? 'No board yet'}</span></div>
        ) : (
          <>
            {board.rows.map((r) => (
              <div className={`gv-tr${r.you ? ' you' : ''}`} key={r.userId ?? r.rank}>
                <span className="gv-rk">{r.rank ?? '-'}</span>
                <span className="gv-hn">{r.name}<HouseTag row={r} /></span>
                <span className="gv-sc n">{r.value}</span>
              </div>
            ))}
            {board.footer && (
              <div className="gv-tr"><span className="gv-rk q">&hellip;</span><span className="gv-hn q">{board.footer}</span><span className="gv-sc" /></div>
            )}
          </>
        )}
      </div>
      <p className="gv-foot">Season standings on <b>Rankings</b> · week boards here</p>
    </>
  );
}

// ---------------------------------------------------------------------------
// RESULTS - the Daily day by day, then the graded week
// ---------------------------------------------------------------------------
function ResultsPane({ v }) {
  const { dailyDays = [], dailySummary = null, gradedWeek = [] } = v;
  return (
    <>
      <div className="gv-lb">
        <div className="gv-lbh"><span className="on">DAILY</span></div>
        {dailyDays.length === 0 ? (
          <div className="gv-tr"><span className="gv-hn q">Nothing played yet this week</span></div>
        ) : dailyDays.map((d) => (
          <div className={`gv-tr${d.you ? ' you' : ''}`} key={d.date}>
            <span className="gv-rk">{d.day}</span>
            <span className="gv-hn">
              {/* THE SEASON APPEARS ONLY ON A GRADED ROW (addendum 7 / the
                  mock's own rule): before you play, the season is the thing
                  you are guessing at. */}
              {d.season != null ? `${d.season} season` : 'not played'}
              <small>{[d.matched, d.elapsed].filter(Boolean).join(' · ')}</small>
            </span>
            <span className="gv-sc n">{d.pct ?? '-'}</span>
          </div>
        ))}
        {dailySummary && (
          <div className="gv-tr"><span className="gv-rk q">&hellip;</span><span className="gv-hn q">{dailySummary}</span><span className="gv-sc" /></div>
        )}
      </div>

      {gradedWeek.length > 0 && (
        <div className="gv-lb" style={{ marginTop: '8px' }}>
          <div className="gv-lbh"><span className="on">{v.gradedWeekLabel ?? 'LAST WEEK'}</span></div>
          {gradedWeek.map((g) => (
            <Link className="gv-tr" key={g.key} href={g.href}>
              <span className="gv-rk">{g.mark}</span>
              <span className="gv-hn">{g.name}<small>{g.sub}</small></span>
              <span className="gv-sc n">{g.value}</span>
            </Link>
          ))}
        </div>
      )}
      <p className="gv-foot">Tap a row for the graded screen</p>
    </>
  );
}

// ---------------------------------------------------------------------------
// ALERTS - what exists today, and nothing that does not
// ---------------------------------------------------------------------------
function AlertsPane({ v, signedIn, signinHref }) {
  const { follows = [], matchAlerts = [] } = v;
  return (
    <>
      <div className="gv-al">
        {!signedIn ? (
          <div className="gv-alrow"><div className="gv-t"><b>Alerts</b><small>Sign in to set them</small></div>
            <Link className="gv-now-go" href={signinHref('/games?pane=alerts')}>Sign in</Link></div>
        ) : (
          <>
            {/* PER-GAME SWITCHES DO NOT EXIST YET, and no placeholder stands in
                for them. alert_prefs carries scope 'team' | 'match' only
                (migration 082), so a row per game would be a control that
                writes nowhere. It is its own relay. */}
            {follows.length === 0 && matchAlerts.length === 0 ? (
              <div className="gv-alrow"><div className="gv-t">
                <b>No alerts set</b>
                <small>Follow a team, or set alerts on a game from its page</small>
              </div></div>
            ) : null}
            {follows.map((f) => (
              <Link className="gv-alrow" key={`t${f.teamId}`} href={`/team/${f.slug ?? f.teamId}`}>
                <div className="gv-t"><b>{f.name}</b><small>kickoff · scores · final</small></div>
                <span className="gv-chev" aria-hidden="true">&rsaquo;</span>
              </Link>
            ))}
            {matchAlerts.map((m) => (
              <Link className="gv-alrow" key={`m${m.matchId}`} href={m.href}>
                <div className="gv-t"><b>{m.label}</b><small>{m.detail}</small></div>
                <span className="gv-chev" aria-hidden="true">&rsaquo;</span>
              </Link>
            ))}
          </>
        )}
      </div>
      <p className="gv-foot">
        Game alerts follow your teams and any game you set them on.
        {v.nextAlertAt && <> Next: <StandaloneTime iso={v.nextAlertAt} weekday /></>}
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
export default function LobbyV3({ v, chip = 'week', signedIn = false, signinHref = (h) => h, userId = null }) {
  const initial = (v.handle ?? '').trim().charAt(0).toUpperCase() || 'Ȳ';
  return (
    <div className="gv">
      <div className="gv-top">
        <h1>Games</h1>
        <span className="gv-me">
          <b>{initial}</b>{v.handle ? `@${v.handle}` : ''}
        </span>
      </div>

      <div className="gv-chips">
        {V3_CHIPS.map((c) => (
          <Link key={c} href={c === 'week' ? '/games' : `/games?pane=${c}`}
            className={`gv-chip${chip === c ? ' on' : ''}`} data-chip={c}>
            {V3_CHIP_LABEL[c]}
          </Link>
        ))}
      </div>

      {chip === 'week' && <WeekPane v={v.week} signedIn={signedIn} signinHref={signinHref} />}
      {chip === 'boards' && <BoardsPane v={v.boards} userId={userId} />}
      {chip === 'results' && <ResultsPane v={v.results} />}
      {chip === 'alerts' && <AlertsPane v={v.alerts} signedIn={signedIn} signinHref={signinHref} />}
    </div>
  );
}
