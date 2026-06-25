'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

const PLACEHOLDERS = {
  account:  'MY SPORTSVYN — Step 4',
  read:     'READ — destination pending (no article index route yet)',
};

// Bottom nav items. Items with `href` navigate (Capacitor WebView soft-loads
// the full site page; v1 intentionally drops the /app shell on tap — we are
// NOT persisting app-chrome over site pages yet). Items without `href` stay
// as in-shell sections that toggle the local `section` state and render
// their PLACEHOLDERS string. Read currently has no clean destination
// (only /article/[slug] exists; no article-index route), so it stays in-
// shell pending a decision.
// 'sched' is now an IN-SHELL section (no href) — tapping it switches the
// stage to <ScheduleView> while the header + bottom nav persist (Strategy 1),
// instead of soft-loading the website's /schedule and dropping the shell.
// bracket/rankings stay as <Link> navigations for now (later commits).
const NAV_ITEMS = [
  { id: 'sched',    label: 'Schedules', Icon: IconSched },
  { id: 'bracket',  label: 'Bracket',   Icon: IconBracket,  href: '/world-cup-2026/bracket' },
  { id: 'rankings', label: 'Rankings',  Icon: IconRankings, href: '/world-cup-2026/rankings' },
  { id: 'read',     label: 'Read',      Icon: IconRead },
];

const DAYS_SHORT = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
const MONTHS = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];

export default function AppShellClient({ cards, schedule }) {
  const [section, setSection] = useState('deck');
  const [dateline, setDateline] = useState('');

  useEffect(() => {
    const now = new Date();
    setDateline(`${DAYS_SHORT[now.getDay()]} · ${MONTHS[now.getMonth()]} ${now.getDate()}`);
  }, []);

  return (
    <div className="sv-shell">
      <header className="sv-header">
        <button
          type="button"
          className={`sv-deck-tile ${section === 'deck' ? 'is-active' : ''}`}
          aria-label="Daily card"
          aria-pressed={section === 'deck'}
          onClick={() => setSection('deck')}
        >
          <span className="sv-deck-monogram">
            <span className="sv-macron sv-macron-ink" aria-hidden="true" />
            Y
          </span>
        </button>

        <div className="sv-wordmark-stack">
          <div className="sv-wordmark">
            SPORTSV<span className="sv-y-volt">
              <span className="sv-macron sv-macron-volt" aria-hidden="true" />
              Y
            </span>N
          </div>
          <div className="sv-dateline">{dateline || ' '}</div>
        </div>

        <button
          type="button"
          className={`sv-avatar ${section === 'account' ? 'is-active' : ''}`}
          aria-label="My Sportsvyn"
          aria-pressed={section === 'account'}
          onClick={() => setSection('account')}
        >
          DS
        </button>
      </header>

      <main className="sv-stage">
        {section === 'deck'
          ? <Deck cards={cards} />
          : section === 'sched'
            ? <ScheduleView data={schedule} />
            : <div className="sv-placeholder">{PLACEHOLDERS[section]}</div>
        }
      </main>

      <nav className="sv-nav" aria-label="Primary">
        {NAV_ITEMS.map(({ id, label, Icon, href }) => {
          const isActive = section === id;
          const className = `sv-nav-item ${isActive ? 'is-active' : ''}`;
          const inner = (
            <>
              <span className="sv-nav-icon" aria-hidden="true"><Icon /></span>
              <span className="sv-nav-label">{label}</span>
            </>
          );
          if (href) {
            return (
              <Link key={id} href={href} className={className} aria-label={label}>
                {inner}
              </Link>
            );
          }
          return (
            <button
              key={id}
              type="button"
              className={className}
              aria-label={label}
              aria-pressed={isActive}
              onClick={() => setSection(id)}
            >
              {inner}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

// ─── DECK ────────────────────────────────────────────────────────────────

function Deck({ cards }) {
  const railRef = useRef(null);
  const [activeIdx, setActiveIdx] = useState(0);

  const slots = [
    { key: 'today',  render: () => <CardTodaysCard data={cards.todaysCard} /> },
    { key: 'power',  render: () => <CardPower  rows={cards.power} /> },
    { key: 'player', render: () => <CardPlayers rows={cards.playerPot} /> },
    { key: 'watch',  render: () => <CardWatch  rows={cards.watch} /> },
    { key: 'read',   render: () => <CardRead   article={cards.read} /> },
    { key: 'stats',  render: () => <CardStats  data={cards.stats} /> },
  ];

  function onScroll() {
    const el = railRef.current;
    if (!el) return;
    const center = el.scrollLeft + el.clientWidth / 2;
    let closest = 0;
    let closestDist = Infinity;
    for (let i = 0; i < el.children.length; i++) {
      const c = el.children[i];
      const cCenter = c.offsetLeft + c.offsetWidth / 2;
      const dist = Math.abs(cCenter - center);
      if (dist < closestDist) { closestDist = dist; closest = i; }
    }
    if (closest !== activeIdx) setActiveIdx(closest);
  }

  function jumpTo(i) {
    const el = railRef.current;
    if (!el) return;
    const c = el.children[i];
    if (!c) return;
    el.scrollTo({ left: c.offsetLeft - (el.clientWidth - c.offsetWidth) / 2, behavior: 'smooth' });
  }

  return (
    <div className="sv-deck-wrap">
      <div className="sv-deck" ref={railRef} onScroll={onScroll}>
        {slots.map(({ key, render }) => (
          <article key={key} className="sv-card">
            {render()}
          </article>
        ))}
      </div>

      <div className="sv-dots" role="tablist" aria-label="Card position">
        {slots.map((_, i) => (
          <button
            key={i}
            type="button"
            className={`sv-dot ${i === activeIdx ? 'is-active' : ''}`}
            aria-label={`Card ${i + 1} of ${slots.length}`}
            onClick={() => jumpTo(i)}
          />
        ))}
      </div>

      <div className="sv-deck-hint">← swipe · scroll inside →</div>
    </div>
  );
}

// ─── SCHEDULE VIEW ─────────────────────────────────────────────────────────
// In-shell Schedules screen (Commit 1): the whole WC tournament, PT-day
// grouped, vertically scrolling inside .sv-stage while the header + bottom
// nav stay pinned. All data arrives pre-shaped from readSchedule (server,
// PT-locked) — no client Date math, no KickoffTime island, no FixtureCard /
// schedule.css import. Rows are rebuilt in the deck's design language.
// Lenses / scrubber / filters / scorer pips are Commit 2.

function ScheduleView({ data }) {
  if (!data || !data.days || data.days.length === 0) {
    return (
      <div className="sv-sched">
        <div className="sv-sched-empty">No fixtures scheduled yet.</div>
      </div>
    );
  }
  return (
    <div className="sv-sched">
      <div className="sv-sched-head">
        <div className="sv-kicker">Schedule</div>
        <div className="sv-meta">
          {data.count} {data.count === 1 ? 'Match' : 'Matches'} · Full Tournament
        </div>
      </div>

      {data.days.map((day) => (
        <section key={day.ptDay} className="sv-sched-day">
          <div className={`sv-sched-dayhead ${day.isToday ? 'is-today' : ''}`}>
            <span className="sv-sched-daylabel">{day.dayLabel}</span>
            {day.isToday && <span className="sv-sched-todaytag">· Today</span>}
            <span className="sv-sched-dayrule" aria-hidden="true" />
            <span className="sv-sched-daycount">
              {day.fixtures.length} {day.fixtures.length === 1 ? 'match' : 'matches'}
            </span>
          </div>
          <div className="sv-sched-list">
            {day.fixtures.map((f) => <ScheduleMatchRow key={f.id} f={f} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

// One fixture — a stacked two-line matchup (home over away) so FULL country
// names get their own line and wrap gracefully instead of colliding on one
// row. Plain <a> (stays in-WebView via allowNavigation; NOT a Next <Link>).
function ScheduleMatchRow({ f }) {
  return (
    <a className="sv-sched-row" href={`/match/${f.slug}`}>
      <div className="sv-sched-teams">
        <div className="sv-sched-team">
          <FlagSvg path={f.home.flag_svg_path} />
          <span className={`sv-sched-name ${f.home.followed ? 'sv-followed' : ''}`}>
            {f.home.followed && <span className="sv-star" aria-hidden="true">★</span>}
            {f.home.name}
          </span>
          <span className="sv-sched-score">{scoreOrBlank(f, f.home_score)}</span>
        </div>
        <div className="sv-sched-team">
          <FlagSvg path={f.away.flag_svg_path} />
          <span className={`sv-sched-name ${f.away.followed ? 'sv-followed' : ''}`}>
            {f.away.followed && <span className="sv-star" aria-hidden="true">★</span>}
            {f.away.name}
          </span>
          <span className="sv-sched-score">{scoreOrBlank(f, f.away_score)}</span>
        </div>
      </div>
      <div className="sv-sched-meta">
        {f.isLive
          ? <span className="sv-live-tag">● LIVE</span>
          : f.isFinal
            ? <span className="sv-sched-status">Full Time</span>
            : <span className="sv-sched-time">{f.kickoffLabel}</span>}
      </div>
    </a>
  );
}

// Per-side score: shown only once a match is live or final (0 is a real
// score, so guard on null, not falsiness). Scheduled / cancelled → blank.
function scoreOrBlank(f, score) {
  if (!f.isLive && !f.isFinal) return '';
  return score == null ? '' : score;
}

// ─── CARDS ───────────────────────────────────────────────────────────────

// TODAY'S CARD — the deck's lead card. Mirrors the homepage's daily-card
// Header (kicker + dateline) + SlateSection (slate label + match rows),
// restyled in the deck's own design language. All time/date strings arrive
// pre-formatted from readTodaysCard (server, PT-locked) — no client Date math.
function CardTodaysCard({ data }) {
  // readTodaysCard never returns null (empty slate → count 0); the guard is
  // purely defensive against a data-load failure.
  if (!data) {
    return <EmptyCard kicker="Today&rsquo;s Card" message="Today&rsquo;s slate posts soon." accent />;
  }
  const { dateline, fixtures, count } = data;
  return (
    <div className="sv-card-body sv-card--accent">
      <div className="sv-kicker">Today&rsquo;s Card</div>
      <div className="sv-meta">{dateline}</div>

      <div className="sv-section-label">
        Today&rsquo;s Slate · {count} {count === 1 ? 'Match' : 'Matches'}
      </div>

      {count === 0 ? (
        <div className="sv-today-empty">No matches today</div>
      ) : (
        <div className="sv-matchlist">
          {fixtures.map((f) => <TodayMatchRow key={f.id} f={f} />)}
        </div>
      )}
    </div>
  );
}

// One slate row — plain <a> (stays in-WebView via the allowNavigation fix;
// deliberately NOT a Next <Link>, we want the real /match navigation).
function TodayMatchRow({ f }) {
  const right = f.isFinal
    ? `FT ${f.home_score ?? 0}–${f.away_score ?? 0}`
    : f.isLive
      ? `${f.home_score ?? 0}–${f.away_score ?? 0}`
      : f.kickoffLabel;
  return (
    <a className="sv-match-row" href={`/match/${f.slug}`}>
      <span className="sv-match-teams">
        <FlagSvg path={f.home.flag_svg_path} />
        <span className={f.home.followed ? 'sv-followed' : undefined}>
          {f.home.followed && <span className="sv-star" aria-hidden="true">★</span>}
          {teamShort(f.home.name, f.home.abbreviation)}
        </span>
        <span className="sv-vs"> v </span>
        <FlagSvg path={f.away.flag_svg_path} />
        <span className={f.away.followed ? 'sv-followed' : undefined}>
          {f.away.followed && <span className="sv-star" aria-hidden="true">★</span>}
          {teamShort(f.away.name, f.away.abbreviation)}
        </span>
        {f.isLive && <span className="sv-live-tag">· LIVE</span>}
      </span>
      <span className="sv-match-right">{right}</span>
      <span className="sv-match-ws">
        {f.watchScore != null ? f.watchScore.toFixed(1) : ''}
      </span>
    </a>
  );
}

function CardPower({ rows }) {
  if (!rows || rows.length === 0) {
    return <EmptyCard kicker="Power Rankings · Top 5" message="Rankings publish before the opener." />;
  }
  return (
    <div className="sv-card-body">
      <div className="sv-kicker">Power Rankings · Top 5</div>
      <h2 className="sv-title">The favorites, ranked</h2>
      <ol className="sv-ranklist">
        {rows.map((r) => (
          <li key={r.rank} className={`sv-rankrow ${r.followed ? 'is-followed' : ''}`}>
            <span className="sv-rank-num">{r.rank}</span>
            <FlagSvg path={r.flag_svg_path} />
            <span className="sv-rank-name">
              {r.followed && <span className="sv-star" aria-hidden="true">★</span>}
              {r.name}
            </span>
            <span className="sv-rank-score">{r.score.toFixed(1)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function CardPlayers({ rows }) {
  if (!rows || rows.length === 0) {
    return (
      <EmptyCard
        kicker="Player of the Tournament · Top 5"
        message="Player of the Tournament — rankings begin once matches kick off."
      />
    );
  }
  return (
    <div className="sv-card-body">
      <div className="sv-kicker">Player of the Tournament · Top 5</div>
      <h2 className="sv-title">Who&rsquo;s running away with it</h2>
      <ol className="sv-ranklist sv-ranklist--players">
        {rows.map((r) => (
          <li key={r.rank} className={`sv-rankrow ${r.followed ? 'is-followed' : ''}`}>
            <span className="sv-rank-num">{r.rank}</span>
            <div className="sv-player-meta">
              <span className="sv-rank-name">
                {r.followed && <span className="sv-star" aria-hidden="true">★</span>}
                {r.name}
              </span>
              <span className="sv-rank-sub">
                {[r.country, r.pos].filter(Boolean).join(' · ')}
              </span>
            </div>
            <span className="sv-rank-score">{r.score.toFixed(1)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function CardWatch({ rows }) {
  if (!rows || rows.length === 0) {
    return (
      <EmptyCard
        kicker="Watch Scores · Today"
        message="No matches scored yet today — back when kickoffs land."
      />
    );
  }
  return (
    <div className="sv-card-body">
      <div className="sv-kicker">Watch Scores · Today</div>
      <h2 className="sv-title">What&rsquo;s worth your time</h2>
      <ol className="sv-ranklist sv-ranklist--matches">
        {rows.map((r, i) => (
          <li key={i} className={`sv-rankrow ${r.followed ? 'is-followed' : ''}`}>
            <span className="sv-rank-num">{i + 1}</span>
            <span className="sv-rank-name">
              {r.followed && <span className="sv-star" aria-hidden="true">★</span>}
              {r.home} v {r.away}
            </span>
            <span className="sv-rank-score">{r.score.toFixed(1)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function CardRead({ article }) {
  if (!article) {
    return <EmptyCard kicker="The Read" message="First longform lands soon." />;
  }
  const footerBits = [
    'Sportsvyn',
    `${article.words.toLocaleString()} words`,
    `${article.read_time_min} min`,
  ];
  return (
    <div className="sv-card-body">
      <div className="sv-kicker">{article.kicker}</div>
      <h2 className="sv-title sv-title--longform">{article.title}</h2>
      {article.excerpt && <p className="sv-lede">{article.excerpt}</p>}
      <div className="sv-card-footer">{footerBits.join(' · ')}</div>
    </div>
  );
}

function CardStats({ data }) {
  if (!data || !data.scorers || data.scorers.length === 0) {
    return <EmptyCard kicker="Golden Boot · Top 5" message="Scorers populate as matches play." />;
  }
  const { scorers, matches_played, total_goals, avg_goals_per_match } = data;
  const footerBits = [
    `${matches_played} ${matches_played === 1 ? 'match' : 'matches'}`,
    `${total_goals} goals`,
    `${avg_goals_per_match} per game`,
  ];
  return (
    <div className="sv-card-body">
      <div className="sv-kicker">Golden Boot · Top 5</div>
      <h2 className="sv-title">The race for the Golden Boot</h2>
      <ol className="sv-ranklist">
        {scorers.map((r, i) => (
          <li key={`${r.name}-${i}`} className={`sv-rankrow ${r.followed ? 'is-followed' : ''}`}>
            <span className="sv-rank-num">{i + 1}</span>
            <FlagSvg path={r.flag_svg_path} />
            <span className="sv-rank-name">
              {r.followed && <span className="sv-star" aria-hidden="true">★</span>}
              {r.name}
            </span>
            <span className="sv-rank-score">{r.goals}</span>
          </li>
        ))}
      </ol>
      <div className="sv-card-footer">{footerBits.join(' · ')}</div>
    </div>
  );
}

// ─── PRIMITIVES ──────────────────────────────────────────────────────────

// Short team label for slate rows: abbreviation when present, else the
// first three letters of the name, upper-cased. Mirrors the homepage's
// teamShort intent (abbr-first) but with the deck's compact 3-char fallback
// so a row never widens out to a full country name.
function teamShort(name, abbr) {
  if (abbr && abbr.length > 0) return abbr;
  if (!name) return '—';
  return name.slice(0, 3).toUpperCase();
}

function EmptyCard({ kicker, message, accent = false }) {
  return (
    <div className={`sv-card-body ${accent ? 'sv-card--accent' : ''}`}>
      <div className="sv-kicker">{kicker}</div>
      <div className="sv-empty">{message}</div>
    </div>
  );
}

function FlagSvg({ path }) {
  if (!path) return <span className="sv-flag-svg sv-flag-svg--empty" aria-hidden="true" />;
  return (
    <span
      className="sv-flag-svg"
      aria-hidden="true"
      style={{ backgroundImage: `url(${path})` }}
    />
  );
}

// ─── NAV ICONS ──────────────────────────────────────────────────────────

function IconSched() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
    </svg>
  );
}
function IconBracket() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h3l2 6-2 6H3" />
      <path d="M21 6h-3l-2 6 2 6h3" />
      <path d="M9 12h6" />
    </svg>
  );
}
function IconRankings() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 21V11" /><path d="M12 21V5" /><path d="M19 21v-7" />
    </svg>
  );
}
function IconRead() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5h7v15H4z" /><path d="M13 5h7v15h-7z" />
      <path d="M4 8h7M13 8h7" />
    </svg>
  );
}
