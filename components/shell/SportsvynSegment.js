'use client';

// components/shell/SportsvynSegment.js - LIVE SCORES / FANTASY, in the shell.
//
// CLIENT COMPONENT WITH <Link>, and both halves are the fix for the same
// device glitch:
//
//   <Link>, NOT <a>. The first version shipped plain anchors - a full document
//   navigation per tap. WKWebView tore the page down, the root layout's
//   chrome (client-gated header, tab bar, profile chip) vanished and popped
//   back at hydration, and the page shifted ~54px when the header mounted.
//   This exact bug was solved once already in /games' PaneTabs; the segment
//   shipped without inheriting the lesson. Soft nav keeps the layout mounted
//   and the outgoing page painted until the incoming one arrives.
//
//   THE PILL IS OPTIMISTIC. usePathname updates the moment navigation is
//   COMMITTED client-side, before the new page streams in - so the tapped
//   pill lights immediately rather than after the ~350ms server render, which
//   read as the tap not taking. No server `active` prop: the path is the one
//   source of truth and it cannot disagree with the route.
//
// THE SHELL GATE STAYS AT THE CALL SITE ({isShell && ...} in each page),
// server-side - web HTML carries no segment markup at all. That contract is
// unchanged and tested; this component renders wherever it is mounted.

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function SportsvynSegment() {
  const pathname = usePathname() || '';
  const active = pathname.startsWith('/nfl') ? 'fantasy' : 'scores';
  return (
    <nav className="svseg" aria-label="Sportsvyn sections">
      <Link href="/scores" className={active === 'scores' ? 'on' : ''}>Live Scores</Link>
      <Link href="/nfl/fantasy" className={active === 'fantasy' ? 'on' : ''}>Fantasy</Link>
    </nav>
  );
}
