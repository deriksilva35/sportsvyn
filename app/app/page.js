'use client';

import { useEffect, useRef, useState } from 'react';
import {
  NEXT_UP,
  POWER_RANKINGS_TOP5,
  PLAYER_TOP5,
  WATCH_TODAY,
  READ,
  MARKET,
} from './deck-data';

const PLACEHOLDERS = {
  account:  'MY SPORTSVYN — Step 4',
  sched:    'SCHEDULES — data in a later step',
  bracket:  'BRACKET — later step',
  rankings: 'RANKINGS — later step',
  read:     'READ — later step',
};

const NAV_ITEMS = [
  { id: 'sched',    label: 'Schedules', Icon: IconSched },
  { id: 'bracket',  label: 'Bracket',   Icon: IconBracket },
  { id: 'rankings', label: 'Rankings',  Icon: IconRankings },
  { id: 'read',     label: 'Read',      Icon: IconRead },
];

const DAYS_SHORT = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
const MONTHS = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];

export default function AppShellPage() {
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
          ? <Deck />
          : <div className="sv-placeholder">{PLACEHOLDERS[section]}</div>
        }
      </main>

      <nav className="sv-nav" aria-label="Primary">
        {NAV_ITEMS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            className={`sv-nav-item ${section === id ? 'is-active' : ''}`}
            aria-label={label}
            aria-pressed={section === id}
            onClick={() => setSection(id)}
          >
            <span className="sv-nav-icon" aria-hidden="true"><Icon /></span>
            <span className="sv-nav-label">{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

// ─── DECK ────────────────────────────────────────────────────────────────

function Deck() {
  const railRef = useRef(null);
  const [activeIdx, setActiveIdx] = useState(0);

  const cards = [
    { key: 'nextup',   render: () => <CardNextUp   data={NEXT_UP} /> },
    { key: 'power',    render: () => <CardPower    rows={POWER_RANKINGS_TOP5} /> },
    { key: 'player',   render: () => <CardPlayers  rows={PLAYER_TOP5} /> },
    { key: 'watch',    render: () => <CardWatch    rows={WATCH_TODAY} /> },
    { key: 'read',     render: () => <CardRead     data={READ} /> },
    { key: 'market',   render: () => <CardMarket   data={MARKET} /> },
  ];

  // Detect which card's center is closest to the rail's viewport center.
  // More reliable than (scrollLeft / cardWidth) when gap / padding skew the math.
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
        {cards.map(({ key, render }) => (
          <article key={key} className="sv-card">
            {render()}
          </article>
        ))}
      </div>

      <div className="sv-dots" role="tablist" aria-label="Card position">
        {cards.map((_, i) => (
          <button
            key={i}
            type="button"
            className={`sv-dot ${i === activeIdx ? 'is-active' : ''}`}
            aria-label={`Card ${i + 1} of ${cards.length}`}
            onClick={() => jumpTo(i)}
          />
        ))}
      </div>

      <div className="sv-deck-hint">← swipe · scroll inside →</div>
    </div>
  );
}

// ─── CARDS ───────────────────────────────────────────────────────────────

function CardNextUp({ data }) {
  return (
    <div className="sv-card-body sv-card--accent">
      <div className="sv-kicker">Next Up</div>
      <h2 className="sv-title">
        <FlagInline emoji={data.home.emoji} />
        <span className={data.home.followed ? 'sv-followed' : undefined}>
          {data.home.followed && <span className="sv-star" aria-hidden="true">★</span>}
          {data.home.name}
        </span>
        <span className="sv-vs"> v </span>
        <FlagInline emoji={data.away.emoji} />
        {data.away.name}
      </h2>
      <div className="sv-meta">{data.meta}</div>
      <p className="sv-lede">{data.lede}</p>
      <p className="sv-body">{data.body}</p>

      <div className="sv-section-label">Win probability</div>
      <div className="sv-probbar" aria-label="Win probability">
        <span className="sv-probbar-seg sv-probbar-home" style={{ width: `${data.winProb.home}%` }} />
        <span className="sv-probbar-seg sv-probbar-draw" style={{ width: `${data.winProb.draw}%` }} />
        <span className="sv-probbar-seg sv-probbar-away" style={{ width: `${data.winProb.away}%` }} />
      </div>
      <div className="sv-prob-legend">
        <span><strong>{data.home.code}</strong> {data.winProb.home}%</span>
        <span><strong>Draw</strong> {data.winProb.draw}%</span>
        <span><strong>{data.away.code}</strong> {data.winProb.away}%</span>
      </div>

      <div className="sv-section-label">What to watch</div>
      <ul className="sv-bullets">
        {data.watch.map((b, i) => <li key={i}>{b}</li>)}
      </ul>
    </div>
  );
}

function CardPower({ rows }) {
  return (
    <div className="sv-card-body">
      <div className="sv-kicker">Power Rankings · Top 5</div>
      <h2 className="sv-title">The favorites, ranked</h2>
      <ol className="sv-ranklist">
        {rows.map((r) => (
          <li key={r.rank} className={`sv-rankrow ${r.followed ? 'is-followed' : ''}`}>
            <span className="sv-rank-num">{r.rank}</span>
            <FlagInline emoji={r.emoji} />
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
  return (
    <div className="sv-card-body">
      <div className="sv-kicker">Player of the Tournament · Top 5</div>
      <h2 className="sv-title">Who's running away with it</h2>
      <ol className="sv-ranklist sv-ranklist--players">
        {rows.map((r) => (
          <li key={r.rank} className={`sv-rankrow ${r.followed ? 'is-followed' : ''}`}>
            <span className="sv-rank-num">{r.rank}</span>
            <div className="sv-player-meta">
              <span className="sv-rank-name">
                {r.followed && <span className="sv-star" aria-hidden="true">★</span>}
                {r.name}
              </span>
              <span className="sv-rank-sub">{r.country} · {r.pos}</span>
            </div>
            <span className="sv-rank-score">{r.score.toFixed(1)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function CardWatch({ rows }) {
  return (
    <div className="sv-card-body">
      <div className="sv-kicker">Watch Scores · Today</div>
      <h2 className="sv-title">What's worth your time</h2>
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

function CardRead({ data }) {
  return (
    <div className="sv-card-body">
      <div className="sv-kicker">The Read</div>
      <h2 className="sv-title sv-title--longform">{data.title}</h2>
      <p className="sv-lede">{data.lede}</p>
      <p className="sv-body">{data.body}</p>
      <div className="sv-card-footer">{data.footer}</div>
    </div>
  );
}

function CardMarket({ data }) {
  return (
    <div className="sv-card-body sv-card--accent">
      <div className="sv-kicker">{data.kicker}</div>
      <h2 className="sv-title">{data.title}</h2>
      <p className="sv-lede">{data.lede}</p>
      <p className="sv-body">{data.body}</p>
      <div className="sv-card-footer">{data.footer}</div>
    </div>
  );
}

function FlagInline({ emoji }) {
  return <span className="sv-flag" aria-hidden="true">{emoji}</span>;
}

// ─── NAV ICONS (unchanged from Step 1) ──────────────────────────────────

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
      <path d="M5 21V11" />
      <path d="M12 21V5" />
      <path d="M19 21v-7" />
    </svg>
  );
}

function IconRead() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5h7v15H4z" />
      <path d="M13 5h7v15h-7z" />
      <path d="M4 8h7M13 8h7" />
    </svg>
  );
}
