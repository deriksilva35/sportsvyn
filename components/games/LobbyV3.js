// components/games/LobbyV3.js - the Games tab: the Play lobby, and three panes.
//
// ============================================================================
// THE PLAY LOBBY IS THE DEFAULT SCREEN (thu-38 + fri-1)
// ============================================================================
// The approved canvas "Play tab lobby": YOUR MOVE first (the entries the
// reader can act on, soonest lock first), then a chip per sport with a game in
// the next fourteen days, then a card per sport, then the reader's leagues and
// practice. SINCE sun-19 EACH SPORT IS ONE COLLAPSED CARD (components/games/
// PlayCollapse.js): ?sport= opens one in place rather than filtering the page. It replaced v3's "This week" pane - one now card over four
// football rows - because the arcade now runs five sports on five clocks, and
// a list of one league's week could not say which of them needed you first.
//
// THE CHIPS ARE URL STATE (?sport= on the lobby, ?pane= for the panes), not an
// island, for the three reasons v2's panes were: server-rendered complete so
// there is no hydration flash, each payload testable on its own, and a
// shareable link to any of them. normalizeChip() in lib/games/lobby.js maps
// every v2 pane onto a chip, so every bookmark that exists today still lands.
//
// EVERY NUMBER COMES FROM THE VIEW. This file computes nothing: the shapes are
// lib/games/playLobby.js and lib/games/playRegistry.js (the lobby) and
// lib/games/lobbyV3.js (the panes). R1 - every number on screen is one the
// site already computes - is therefore true by construction here.
//
// THE BOTTOM NAV IS UNTOUCHED. This is the Play tab's content and nothing else.

import Link from 'next/link';
import HouseTag from '@/components/house/HouseTag';
import '@/components/house/house.css';
import StandaloneTime from '@/components/StandaloneTime';
import { V3_CHIPS, V3_CHIP_LABEL } from '@/lib/games/lobby';
import { SPORT_LABEL } from '@/lib/games/playLobby';
import { zoneNameOf } from '@/lib/time/zoneName';
import SeasonBoard from '@/components/games/SeasonBoard';
import PlayWhen from '@/components/games/PlayWhen';
import PlayCloses from '@/components/games/PlayCloses';
import ZoneLabel from '@/components/scores/ZoneLabel';
import { PlayOpenProvider, PlayChip, PlayCard, PlayMore } from '@/components/games/PlayCollapse';
import DailyBanner from '@/components/games/DailyBanner';

/** The games with an always-on board page (lib/boards/live.js, lib/boards/mlb.js). */
const FULL_BOARD = { weekly: '/weekly/board', draft: '/draft/board', october: '/october/board', run: '/run/board' };
import '@/components/games/season.css';
import '@/components/games/play.css';
import '@/components/games/playCollapse.css';
import '@/components/games/moveGrid.css';

// ---------------------------------------------------------------------------
// THE PLAY LOBBY (thu-38 + fri-1) - the approved canvas "Play tab lobby"
// ---------------------------------------------------------------------------
// EVERYTHING ON IT COMES FROM THE VIEW. lib/games/playLobby.js decided which
// items are YOUR MOVE, which carry LOCKS SOON, which sports get a chip and
// which groups collapse; lib/games/playRegistry.js built each item from its
// game's own reader. This file draws, and every instant goes through PlayWhen
// so it is in the zone the header names.

/** The progress bar: one segment per slot up to twelve, a single fill beyond. */
function Progress({ p }) {
  if (!p || !(p.total > 0)) return null;
  const done = Math.max(0, Math.min(p.done, p.total));
  if (p.total > 12) {
    return (
      <span className="pl-bar one" role="img" aria-label={`${done} of ${p.total}`}>
        <span className="on" style={{ width: `${Math.round((done / p.total) * 100)}%` }} />
      </span>
    );
  }
  return (
    <span className="pl-bar" role="img" aria-label={`${done} of ${p.total}`}>
      {Array.from({ length: p.total }, (_, k) => <span key={k} className={k < done ? 'on' : undefined} />)}
    </span>
  );
}

/** "0 of 6 · locks Sun 10:00 AM" - the status, then the item's own time clause. */
function Status({ i, now, tz }) {
  return (
    <>
      {i.status}
      {i.at?.iso ? <>{i.status ? ' · ' : ''}{i.at.words} <PlayWhen iso={i.at.iso} now={now} serverTz={tz} /></> : null}
    </>
  );
}

/** The compact card's button: SET for a lineup, DRAFT for the room, PICK for the rest. */
const CTA_SHORT = { weekly: 'SET', six: 'SET', run: 'SET', draft: 'DRAFT' };
export const ctaShort = (i) => CTA_SHORT[i?.game] ?? 'PICK';

/**
 * ONE YOUR MOVE CARD, COMPACT (mon-2): sport · game, the title, "N of M ·
 * locks <time>", the segmented bar, a small PICK/SET. SOON inside the hour.
 */
function MoveCard({ i, now, tz, signedIn, signinHref }) {
  const p = i.progress;
  const count = p && p.total > 0 ? `${Math.max(0, Math.min(p.done, p.total))} of ${p.total}` : i.status;
  return (
    <Link className={`pl-mv${i.soon ? ' soon' : ''}`} href={signedIn ? i.href : signinHref(i.href)} data-key={i.key}>
      <span className="pl-mv-h">
        <span className="pl-mv-k">{i.kicker}</span>
        {i.soon && <span className="pl-mv-soon">SOON</span>}
      </span>
      <b className="pl-mv-t">{i.title}</b>
      <span className="pl-mv-s">
        {count}
        {i.locksAt ? <>{count ? ' · ' : ''}locks <PlayWhen iso={i.locksAt} now={now} serverTz={tz} /></> : null}
      </span>
      <Progress p={p} />
      <span className="pl-mv-b">{signedIn ? ctaShort(i) : 'SIGN IN'} <span aria-hidden="true">&rarr;</span></span>
    </Link>
  );
}

/**
 * THE GRID (mon-2): 2x2, no swiping, laid out by the count lib/games/
 * playLobby.js moveGrid() drew - 0 a line, 1 full width, 2 side by side, 3 two
 * + one full width, 4 a square - and past four, "+N more", which opens the
 * card of the soonest sport left (PlayMore, the cards' own open mechanism).
 */
function MoveGrid({ grid, total, signedIn, rowProps }) {
  const { shown = [], layout = 0, more = null } = grid ?? {};
  return (
    <section className="pl-move" aria-label="Your move">
      <div className="pl-sh">
        <h3>Your move{total > 0 ? ` · ${total}` : ''}</h3>
        {total > 0 && <span>{signedIn ? 'soonest lock first' : 'locking soonest'}</span>}
      </div>
      {layout === 0
        ? <p className="pl-mv-none">{signedIn ? 'All caught up. Nothing to set right now.' : 'Nothing open right now.'}</p>
        : (
          <div className="pl-mg" data-n={layout}>
            {shown.map((i) => <MoveCard key={i.key} i={i} {...rowProps} />)}
          </div>
        )}
      {more && (
        <PlayMore id={more.target} href={`/games?sport=${more.target}`}>
          +{more.count} more · {more.sports.map((x) => SPORT_LABEL[x] ?? x).join(', ')}
        </PlayMore>
      )}
    </section>
  );
}

/** One game row: letter mark, name, one-line status, your progress, chevron. */
function PlayRow({ r, now, tz, signedIn, signinHref }) {
  const right = r.phase === 'upcoming' && r.opensAt
    ? <PlayWhen iso={r.opensAt} kind="date" serverTz={tz} />
    : r.progress ? `${r.progress.done} / ${r.progress.total}` : (r.right ?? '—');
  return (
    <Link className="pl-row" href={signedIn ? r.href : signinHref(r.href)} data-row={r.key} data-phase={r.phase}>
      <span className="pl-mk">{r.mark}</span>
      <span className="pl-t">
        <b>{r.name}</b>
        <small>
          {r.phase === 'upcoming' && r.opensAt
            ? <>{r.status} · opens <PlayWhen iso={r.opensAt} kind="day" serverTz={tz} /></>
            : <Status i={r} now={now} tz={tz} />}
        </small>
      </span>
      <span className="pl-r">{right}</span>
      <span className="gv-chev" aria-hidden="true">&rsaquo;</span>
    </Link>
  );
}

/** "games" agrees with the count: 1 game, 3 games. */
const gamesWord = (n) => `${n} game${n === 1 ? '' : 's'}`;

/**
 * THE CARD'S SUMMARY LINE, from playLobby's cardSummary(): each row's own
 * words, then the soonest open lock. An out-of-season card says only its door.
 */
function CardSummary({ k, now, tz }) {
  if (k.dim) {
    return k.opensAt
      ? <>Opens <PlayWhen iso={k.opensAt} kind="day" serverTz={tz} /></>
      : 'Nothing open this week';
  }
  const { parts = [], nextLock = null } = k.summary ?? {};
  const bits = parts.flatMap((p) => (p.opensAt
    ? [<span key={p.key}>{p.text} <PlayWhen iso={p.opensAt} kind="day" serverTz={tz} /></span>]
    : p.closesAt
      ? [<span key={p.key}>{p.text}</span>, <span key={`${p.key}-c`}><PlayCloses iso={p.closesAt} now={now} serverTz={tz} /></span>]
      : [<span key={p.key}>{p.text}</span>]));
  if (nextLock) bits.push(<span key="__lock">next lock <PlayWhen iso={nextLock} now={now} serverTz={tz} /></span>);
  return bits.flatMap((b, n) => (n ? [' · ', b] : [b]));
}

/** One sport, collapsed by default: a header button over the rows of today. */
function SportCard({ k, now, tz, signedIn, signinHref }) {
  const head = (
    <span className="pl-sc-t">
      <span className="pl-sc-l1">
        <b className="pl-sc-name">{k.label}</b>
        <span className="pl-sc-n">{gamesWord(k.count)}</span>
        {k.move && <span className="pl-sc-move">YOUR MOVE</span>}
      </span>
      <span className="pl-sc-sum"><CardSummary k={k} now={now} tz={tz} /></span>
    </span>
  );
  return (
    <PlayCard id={k.id} dim={k.dim} head={head}>
      {k.rows.map((r) => <PlayRow key={r.key} r={r} now={now} tz={tz} signedIn={signedIn} signinHref={signinHref} />)}
    </PlayCard>
  );
}

function PlayPane({ v, signedIn, signinHref }) {
  const { chips = ['all'], yourMove = [], cards = [], open = 'all', grid = null,
    leagues = [], practice = [], now = null, tz = null } = v;
  const rowProps = { now, tz, signedIn, signinHref };
  return (
    <>
      <div className="pl-top">
        <h1>Play</h1>
        {/* THE ZONE IS NAMED ONCE, here, and every time below is in it: both
            this label and each PlayWhen start in the server's zone and settle
            on the device's after mount, together. */}
        {now && (
          <span className="pl-zone">
            <PlayWhen iso={now} kind="day" serverTz={tz} /> · <ZoneLabel initial={zoneNameOf(tz ?? 'America/New_York')} />
          </span>
        )}
      </div>

      <DailyBanner b={v.daily ?? null} signedIn={signedIn} signinHref={signinHref} now={now} tz={tz} />

      {/* THE CHIPS, THE CARDS AND "+N more" SHARE ONE OPEN STATE (sun-19).
          ?sport= names the open card, so the server paints it open; once
          hydrated a chip opens its card in place and scrolls to it, the open
          chip tapped again (or ALL) closes everything, and each change is a
          history entry. YOUR MOVE sits inside it for its "+N more". */}
      <PlayOpenProvider initial={open} ids={cards.map((k) => k.id)}>
        <MoveGrid grid={grid} total={yourMove.length} signedIn={signedIn} rowProps={rowProps} />

        <nav className="pl-chips" aria-label="Sports">
          {chips.map((c) => (
            <PlayChip key={c} id={c} href={c === 'all' ? '/games' : `/games?sport=${c}`}>
              {c === 'all' ? 'ALL' : SPORT_LABEL[c]}
            </PlayChip>
          ))}
        </nav>

        <div className="pl-cardlist">
          {cards.map((k) => <SportCard key={k.id} k={k} {...rowProps} />)}
        </div>
      </PlayOpenProvider>

      {signedIn && leagues.length > 0 && (
        <section className="pl-leagues">
          <div className="pl-sh"><h3>Your leagues</h3><Link href="/leagues">ALL &rsaquo;</Link></div>
          {leagues.map((l) => (
            <Link key={l.id} className="pl-league" href={l.href}>
              <span className="pl-t"><b>{l.name}</b><small>{l.sub}</small></span>
              {l.corner && <span className="pl-corner" style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', color: 'var(--tok-ink)', fontVariantNumeric: 'tabular-nums' }}>{l.corner}</span>}
              <span className="gv-chev" aria-hidden="true">&rsaquo;</span>
            </Link>
          ))}
        </section>
      )}

      <div className="pl-sh"><h3>Practice · unlimited</h3></div>
      <div className="pl-two">
        {practice.map((t) => (
          <Link className="pl-tile" key={t.key} href={signedIn ? t.href : signinHref(t.href)}>
            <b>{t.title}</b>
            {t.sub && <small>{t.sub}</small>}
          </Link>
        ))}
      </div>

      <p className="pl-panes">
        <Link href="/games?pane=boards">Boards</Link> · <Link href="/games?pane=results">Results</Link> · <Link href="/games?pane=alerts">Alerts</Link>
      </p>
      <p className="gv-foot">{v.foot}</p>

      {/* RELAY 6'S TWO ENTRANCES TO THE EXPLAINER SURVIVE THE MOCK, which
          draws neither. They are not layout: the launch email points at
          /games/how-it-works, relay 6 pinned the count at two on purpose, and
          the stranger lines are the free-to-play statement a first-time
          visitor is owed. */}
      {!signedIn && (
        <div className="lob-stranger">
          <p className="lob-free">Free. An email and a handle. Nothing to install.</p>
          <Link className="ghost" href="/games/how-it-works">How to play each game &rarr;</Link>
        </div>
      )}
      <p className="gv-more">
        <Link className="ghost" href="/games/how-it-works">How the games work &rarr;</Link>
      </p>

      {/* THE NOT-AFFILIATED SENTENCE IS THE SITE FOOTER'S (fri-2): /games no
          longer repeats it in the page. The data licence line stays here. */}
      <p className="gv-legal">
        One account · one handle · one leaderboard spine. nflverse data CC-BY-4.0.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// BOARDS - week boards here, season standings on Rankings
// ---------------------------------------------------------------------------

/**
 * A SEASON TABLE RANKED ON A PERCENTAGE - Pick'em, the Weekly, the Draft.
 *
 * ONE RENDERER FOR THE THREE, because the only thing that differs is the
 * sub-line's nouns: Pick'em counts correct of played, the other two count
 * weeks. v2 had two near-identical blocks for exactly this and they had
 * already drifted apart in whitespace.
 */
function PctRow({ r, pickem = false, me = false }) {
  return (
    <div className={`gv-tr${me ? ' you' : ''}`}>
      <span className="gv-rk">{r.rank ?? '-'}</span>
      <span className="gv-hn">{r.name}<HouseTag row={r} /></span>
      <span className="gv-sc n">
        {r.note ?? (pickem
          ? `${r.pct}% · ${r.correct}/${r.played}`
          : `${r.avgPct}% avg · ${r.weeksPlayed} played`)}
      </span>
    </div>
  );
}

function PctBoard({ table, pickem = false }) {
  return (
    <div className="gv-lb">
      {(table?.top ?? []).map((r) => <PctRow key={r.userId} r={r} pickem={pickem} />)}
      {table?.self && <PctRow r={table.self} pickem={pickem} me />}
    </div>
  );
}

function BoardsPane({ v, userId }) {
  const { boards = [], boardKey = null, sections = null } = v;
  const board = boards.find((b) => b.key === boardKey) ?? boards[0] ?? null;
  const tabs = boards.map((b) => (
    <Link key={b.key} href={`/games?pane=boards&b=${b.key}`}
      className={b.key === board?.key ? 'on' : undefined}>{b.label}</Link>
  ));

  // THE SEASON TAB, AND EACH BOARD IN ITS OWN SHAPE.
  //
  // THE DAILY IS THE ONLY ONE THAT IS A SeasonBoard, which is the v2 page's
  // own split and not a style choice: SeasonBoard reads points and days
  // played, and the other three tables are ranked on an AVERAGE PERCENTAGE
  // (relay 2b item 7), carrying pct / correct / played / avgPct /
  // weeksPlayed. My first cut sent all four through SeasonBoard and served
  // Pick'em and the Weekly as rows of blanks and "- pts" - caught by serving
  // the tab, not by a fixture, because every fixture I wrote had the Daily's
  // shape in it.
  //
  // A ROW UNDER THE FLOOR CARRIES ITS NOTE, NEVER A BLANK. pickemTable and
  // gameSeasonTable both write `note` in place of a figure for anyone short
  // of the minimum, and that note is the whole point of the row.
  //
  // One definition, both scopes, still: the Daily board here is the same
  // SeasonBoard component the league page renders.
  if (boardKey === 'season') {
    return (
      <>
        <div className="gv-lb"><div className="gv-lbh">{tabs}</div></div>
        {(sections ?? []).map((sec) => (
          <section className="gv-season" key={sec.key}>
            <div className="gv-sh">
              <h3>{sec.name}</h3>
              {sec.state === 'live' && sec.table?.through && <span>through {sec.table.through}</span>}
            </div>
            {sec.state !== 'live'
              ? <p className="gv-foot">{sec.populatesLabel}</p>
              : sec.key === 'overall'
                ? <SeasonBoard table={sec.table} userId={userId} />
                : <PctBoard table={sec.table} pickem={sec.key === 'pickem'} />}
          </section>
        ))}
        <p className="gv-foot">Week boards on the other four tabs</p>
      </>
    );
  }

  return (
    <>
      <div className="gv-lb">
        <div className="gv-lbh">{tabs}</div>
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
      <p className="gv-foot">
        {board?.note ? <>{board.note} · </> : null}
        Season standings on <b>Rankings</b> · week boards here
      </p>
      {/* THE WHOLE BOARD, ONE TAP AWAY (live boards, Phase 3): the Weekly and the
          Draft have an always-on page - every entry, the reader pinned, movement. */}
      {FULL_BOARD[boardKey] ? (
        <p className="gv-foot"><Link className="gv-full" href={FULL_BOARD[boardKey]}>Full board, live &#8250;</Link></p>
      ) : null}
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
        ) : dailyDays.map((d) => {
          const inner = (
            <>
              <span className="gv-rk">{d.day}</span>
            <span className="gv-hn">
              {/* THE SEASON APPEARS ONLY ON A GRADED ROW (addendum 7 / the
                  mock's own rule): before you play, the season is the thing
                  you are guessing at. */}
              {d.season != null ? `${d.season} season` : 'not played'}
              <small>{[d.matched, d.elapsed].filter(Boolean).join(' · ')}</small>
            </span>
              <span className="gv-sc n">{d.pct ?? '-'}</span>
            </>
          );
          // EACH DAY OPENS ITS OWN RESULTS SCREEN. A day with no board id - a run
          // from before the id was carried - stays a plain row rather than a link
          // to nowhere.
          return d.href
            ? <Link className={`gv-tr${d.you ? ' you' : ''}`} key={d.date} href={d.href}>{inner}</Link>
            : <div className={`gv-tr${d.you ? ' you' : ''}`} key={d.date}>{inner}</div>;
        })}
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
  // THE PLAY LOBBY IS THE DEFAULT SCREEN and draws its own top (PLAY, the
  // date, the zone) and its own sport chips. The three panes keep the v3 top
  // and the four pane chips, whose first one leads back here.
  if (chip === 'week') {
    return (
      <div className="gv pl">
        <PlayPane v={v.play ?? {}} signedIn={signedIn} signinHref={signinHref} />
      </div>
    );
  }
  return (
    <div className="gv">
      {/* NO IDENTITY CHIP HERE. The mock's avatar + @handle belongs to the screen's
          top bar - in the app, the shell's AppHeader; on the web, the global
          header - and both already draw it. */}
      <div className="gv-top">
        <h1>Games</h1>
      </div>

      <div className="gv-chips">
        {V3_CHIPS.map((c) => (
          <Link key={c} href={c === 'week' ? '/games' : `/games?pane=${c}`}
            className={`gv-chip${chip === c ? ' on' : ''}`} data-chip={c}>
            {V3_CHIP_LABEL[c]}
          </Link>
        ))}
      </div>

      {/* ONE PANE'S PAYLOAD IS ALL THE READER FETCHED (lib/games/lobbyV3.js
          reads only the selected chip), so every other key is absent by
          design rather than by failure - hence the ?? {}. */}
      {chip === 'boards' && <BoardsPane v={v.boards ?? {}} userId={userId} />}
      {chip === 'results' && <ResultsPane v={v.results ?? {}} />}
      {chip === 'alerts' && <AlertsPane v={v.alerts ?? {}} signedIn={signedIn} signinHref={signinHref} />}
    </div>
  );
}
