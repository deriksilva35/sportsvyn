'use client';

import { useEffect, useState } from 'react';

const PLACEHOLDERS = {
  deck:     'DECK — cards land in Step 2',
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

  // Compute the dateline client-side to dodge SSR/CSR timezone mismatch.
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
          <div className="sv-dateline">{dateline || ' '}</div>
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
        <div className="sv-placeholder">{PLACEHOLDERS[section]}</div>
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
