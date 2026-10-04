'use client';
// components/games/PlayCollapse.js - the collapsed sport cards' open state (sun-19).
//
// ONE CARD OPEN AT A TIME, AND THE URL SAYS WHICH. The server renders the card
// named by ?sport= open (lib/games/playLobby.js playLobbyOpen), so the first
// paint is right with no flash; after that this provider owns the state and
// writes it back with history.pushState, so a link to ?sport=nfl opens NFL and
// Back closes it again. A popstate re-reads ?sport= from the address bar.
//
// THE ROWS ARE THE SERVER'S. Each card's header pieces and its rows are
// server-rendered children handed in here; this file only decides open or
// closed, which is why a closed card's rows are in the HTML, `hidden`.
//
// THE PATH IS WHEREVER THE LOBBY IS: /games, or / under the arcade theme
// (components/games/LobbyMain.js) - so the URL is built from location, never
// a hard-coded /games.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const Ctx = createContext(null);

function urlFor(id) {
  const u = new URL(window.location.href);
  if (id === 'all') u.searchParams.delete('sport'); else u.searchParams.set('sport', id);
  return `${u.pathname}${u.search}${u.hash}`;
}

export function PlayOpenProvider({ initial = 'all', ids = [], children }) {
  const [open, setOpen] = useState(initial);
  const scrollTo = useRef(null);
  const idsKey = ids.join(',');

  useEffect(() => {
    const known = idsKey.split(',');
    const onPop = () => {
      const s = (new URLSearchParams(window.location.search).get('sport') ?? '').toLowerCase();
      setOpen(known.includes(s) ? s : 'all');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [idsKey]);

  // THE SCROLL RUNS AFTER THE CARD HAS OPENED, so it lands on the open card's
  // final position rather than where its header sat while another was open.
  useEffect(() => {
    const want = scrollTo.current;
    scrollTo.current = null;
    if (!want) return;
    const el = document.getElementById(`pl-card-${want.id}`);
    if (!el) return;
    if (want.always) el.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    else if (el.getBoundingClientRect().top < 0) el.scrollIntoView?.({ block: 'start' });
  }, [open]);

  const go = useCallback((next, { scroll = false } = {}) => {
    setOpen(next);
    if (next !== 'all') scrollTo.current = { id: next, always: scroll };
    try { window.history.pushState(null, '', urlFor(next)); } catch { /* no history: state alone */ }
  }, []);

  // A HEADER TAP toggles its card; a CHIP TAP opens its card and scrolls to it,
  // and the open chip tapped again (or ALL) closes everything.
  const toggle = useCallback((id) => go(open === id ? 'all' : id), [go, open]);
  const chip = useCallback((id) => go(id === 'all' || open === id ? 'all' : id, { scroll: true }), [go, open]);

  return <Ctx.Provider value={{ open, toggle, chip }}>{children}</Ctx.Provider>;
}

/** A sport chip: a real link (?sport=) that, once hydrated, toggles in place. */
export function PlayChip({ id, href, children }) {
  const c = useContext(Ctx);
  const on = c ? (id === 'all' ? c.open === 'all' : c.open === id) : false;
  const act = (e) => {
    if (!c || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    c.chip(id);
  };
  return (
    <a href={href} role="button" aria-pressed={on} data-chip={id}
      className={`gv-chip pl-chip${on ? ' on' : ''}`}
      onClick={act}
      onKeyDown={(e) => { if (e.key === ' ') act(e); }}>
      {children}
    </a>
  );
}

/** One sport's card: a header button (aria-expanded) over its rows. */
export function PlayCard({ id, dim = false, head, children }) {
  const c = useContext(Ctx);
  const open = c?.open === id;
  return (
    <section id={`pl-card-${id}`} className={`pl-sc${open ? ' open' : ''}${dim ? ' dim' : ''}`} data-group={id}>
      <button type="button" className="pl-sc-h" aria-expanded={open} aria-controls={`pl-card-${id}-rows`}
        onClick={() => c?.toggle(id)}>
        {head}
        <svg className="pl-sc-chev" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
          <path d="M3.5 6l4.5 4.5L12.5 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div id={`pl-card-${id}-rows`} className="pl-sc-rows" hidden={!open}>{children}</div>
    </section>
  );
}
